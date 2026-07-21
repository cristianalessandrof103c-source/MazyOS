// deno-lint-ignore-file no-explicit-any
// Fase 9 — worker do disparo em massa, chamado por pg_cron (via pg_net) a cada 1min,
// mesmo padrão de follow-up-dispatcher/prospeccao-worker. Processa campanhas
// status='sending': reivindica um lote de destinatários pendentes (RPC
// claim_broadcast_recipients, atômico via FOR UPDATE SKIP LOCKED), manda Template um a
// um com um pequeno intervalo entre envios, classifica falha permanente vs. transiente,
// e fecha a campanha quando não sobrar destinatário.
//
// Arquivo autocontido de propósito (sem import de _shared/) — mesmo motivo de
// prospeccao-worker/prospeccao-buscar: o editor web do Supabase deploya uma function por
// vez, sem suporte a pasta compartilhada entre functions diferentes.
//
// Protegido por header secreto (não JWT — quem chama é pg_net, não um usuário
// autenticado), reaproveitando o mesmo secret já usado por follow-up-dispatcher/
// prospeccao-worker (Vault: dispatcher_secret).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DISPATCHER_SECRET = Deno.env.get('DISPATCHER_SECRET') ?? ''
const WHATSAPP_TEST_ACCESS_TOKEN = Deno.env.get('WHATSAPP_TEST_ACCESS_TOKEN') ?? ''
const WHATSAPP_LIVE_ACCESS_TOKEN = Deno.env.get('WHATSAPP_LIVE_ACCESS_TOKEN') ?? ''
const GRAPH_VERSION = 'v21.0'

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const TIME_BUDGET_MS = 45_000
const BATCH_PER_TICK = 20
const SEND_DELAY_MS = 400
const MAX_ATTEMPTS = 3
const CAMPAIGNS_PER_TICK = 5

// Códigos de erro da Cloud API que nunca vão passar numa retentativa (número inválido,
// template inexistente/pausado, parâmetro errado etc.) — best-effort, baseado na doc
// pública da Meta. Sem Template aprovado ainda pra validar empiricamente; ajustar
// conforme os erros reais aparecerem em produção.
const PERMANENT_FAILURE_CODES = new Set([100, 131026, 131047, 132000, 132001, 132005, 132007, 131008, 131009])

function tokenParaConexao(status: string): string {
  return status === 'live' ? WHATSAPP_LIVE_ACCESS_TOKEN : WHATSAPP_TEST_ACCESS_TOKEN
}

async function enviarMensagemTemplate(args: {
  phoneNumberId: string
  token: string
  to: string
  templateName: string
  templateLanguage: string
  bodyParameters: string[]
}): Promise<string> {
  const { phoneNumberId, token, to, templateName, templateLanguage, bodyParameters } = args
  const template: Record<string, unknown> = { name: templateName, language: { code: templateLanguage } }
  if (bodyParameters.length > 0) {
    template.components = [
      { type: 'body', parameters: bodyParameters.map((text) => ({ type: 'text', text })) },
    ]
  }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const code = data.error?.code as number | undefined
    const msg = data.error ? `${data.error.message} (code ${code})` : `HTTP ${res.status}`
    const err = new Error(`WhatsApp template send falhou: ${msg}`) as Error & { metaCode?: number }
    err.metaCode = code
    throw err
  }
  return data.messages?.[0]?.id ?? ''
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function processarCampanha(campaign: any, startedAt: number) {
  const { data: connection } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('*')
    .eq('id', campaign.whatsapp_connection_id)
    .maybeSingle()

  if (!connection) {
    return { id: campaign.id, kind: 'skip_no_connection' }
  }

  const token = tokenParaConexao(connection.status)
  if (!token) {
    // Falha de config não é falha de contato — pula a campanha inteira nesse tick sem
    // tocar em nenhum recipient, tenta de novo no próximo minuto.
    return { id: campaign.id, kind: 'skip_missing_token' }
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count: sentLast24h } = await supabaseAdmin
    .from('broadcast_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('whatsapp_connection_id', connection.id)
    .eq('status', 'sent')
    .gte('sent_at', since)

  const remaining = Math.max(0, (connection.daily_send_cap ?? 200) - (sentLast24h ?? 0))
  if (remaining === 0) {
    return { id: campaign.id, kind: 'skip_daily_cap' }
  }

  const { data: claimed, error: claimError } = await supabaseAdmin.rpc('claim_broadcast_recipients', {
    p_campaign_id: campaign.id,
    p_limit: Math.min(BATCH_PER_TICK, remaining),
  })

  if (claimError) {
    return { id: campaign.id, kind: 'error_claim', message: claimError.message }
  }

  let sent = 0
  let failed = 0
  for (const recipient of claimed ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break

    try {
      const variableMapping = (campaign.variable_mapping as string[]) ?? []
      const bodyParameters = variableMapping.map((key) =>
        key === 'full_name' ? recipient.full_name : String(recipient.extra_fields?.[key] ?? ''),
      )
      const waMessageId = await enviarMensagemTemplate({
        phoneNumberId: connection.phone_number_id,
        token,
        to: recipient.phone_number,
        templateName: campaign.template_name,
        templateLanguage: campaign.template_language,
        bodyParameters,
      })
      await supabaseAdmin
        .from('broadcast_campaign_recipients')
        .update({ status: 'sent', whatsapp_message_id: waMessageId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', recipient.id)
      sent++
    } catch (err) {
      const metaCode = (err as any).metaCode as number | undefined
      const attempts = (recipient.attempts ?? 0) + 1
      const giveUp = (metaCode !== undefined && PERMANENT_FAILURE_CODES.has(metaCode)) || attempts >= MAX_ATTEMPTS
      await supabaseAdmin
        .from('broadcast_campaign_recipients')
        .update({
          status: giveUp ? 'failed' : 'pending',
          attempts,
          error_message: (err as Error).message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipient.id)
      failed++
    }
    await sleep(SEND_DELAY_MS)
  }

  const { count: pendingLeft } = await supabaseAdmin
    .from('broadcast_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .in('status', ['pending', 'sending'])

  if ((pendingLeft ?? 0) === 0) {
    await supabaseAdmin
      .from('broadcast_campaigns')
      .update({ status: 'done', finished_at: new Date().toISOString() })
      .eq('id', campaign.id)
      .eq('status', 'sending')
  }

  return { id: campaign.id, kind: 'processed', sent, failed }
}

Deno.serve(async (req: Request) => {
  if (!DISPATCHER_SECRET || req.headers.get('x-dispatcher-secret') !== DISPATCHER_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  const startedAt = Date.now()

  const { data: campaigns, error } = await supabaseAdmin
    .from('broadcast_campaigns')
    .select('*')
    .eq('status', 'sending')
    .limit(CAMPAIGNS_PER_TICK)

  if (error) {
    console.error('Erro buscando campanhas em andamento:', error)
    return new Response('Error', { status: 500 })
  }

  const results: any[] = []
  for (const campaign of campaigns ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break
    try {
      results.push(await processarCampanha(campaign, startedAt))
    } catch (err) {
      console.error('Erro processando campanha', campaign.id, err)
      results.push({ id: campaign.id, kind: 'error', message: (err as Error).message })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
