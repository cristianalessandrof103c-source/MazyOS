// deno-lint-ignore-file no-explicit-any
// Fase 9 — controle de campanhas de disparo em massa: start/pause/resume/test numa
// função só (em vez de 4 deploys manuais separados, cada um com fricção real nesse
// ambiente sem CLI linkado). Todas as 4 ações exigem tenant_admin — inclusive pause, que
// é o freio de segurança da feature.
//
// Arquivo autocontido de propósito (sem import de _shared/) — deployada pelo editor web
// do Supabase (mesmo padrão de prospeccao-buscar/prospeccao-worker).
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke): mantém
// verificação de JWT padrão (deploy sem --no-verify-jwt).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHATSAPP_TEST_ACCESS_TOKEN = Deno.env.get('WHATSAPP_TEST_ACCESS_TOKEN') ?? ''
const WHATSAPP_LIVE_ACCESS_TOKEN = Deno.env.get('WHATSAPP_LIVE_ACCESS_TOKEN') ?? ''
const MAX_RECIPIENTS_PER_CAMPAIGN = Number(Deno.env.get('BROADCAST_MAX_RECIPIENTS_PER_CAMPAIGN')) || 20000
const GRAPH_VERSION = 'v21.0'

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Cópia local de _shared/whatsapp-tokens.ts (deploy autocontido, sem import cross-function).
function tokenParaConexao(status: string): string {
  return status === 'live' ? WHATSAPP_LIVE_ACCESS_TOKEN : WHATSAPP_TEST_ACCESS_TOKEN
}

// Cópia local de _shared/whatsapp-api.ts enviarMensagemTemplate.
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
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`
    throw new Error(`WhatsApp template send falhou: ${msg}`)
  }
  return data.messages?.[0]?.id ?? ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const tenantId = body.tenant_id as string | undefined
  const campaignId = body.campaign_id as string | undefined
  const action = body.action as string | undefined
  const testPhoneNumber = body.test_phone_number as string | undefined

  if (!tenantId || !campaignId || !action) {
    return jsonResponse({ error: 'Esperado { tenant_id, campaign_id, action }' }, 400)
  }
  if (!['start', 'pause', 'resume', 'test'].includes(action)) {
    return jsonResponse({ error: 'action precisa ser start, pause, resume ou test' }, 400)
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser()
  if (!caller) {
    return jsonResponse({ error: 'Não autenticado.' }, 401)
  }

  const { data: platformAdminRow } = await supabaseUser
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!platformAdminRow) {
    const { data: callerMembership } = await supabaseUser
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()

    if (callerMembership?.role !== 'tenant_admin') {
      return jsonResponse({ error: 'Só tenant_admin pode controlar disparo em massa.' }, 403)
    }
  }

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('broadcast_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignError) {
    return jsonResponse({ error: `Falha ao carregar campanha: ${campaignError.message}` }, 500)
  }
  if (!campaign || campaign.tenant_id !== tenantId) {
    return jsonResponse({ error: 'Campanha não encontrada pra esse tenant.' }, 404)
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('*')
    .eq('id', campaign.whatsapp_connection_id)
    .maybeSingle()

  if (connectionError || !connection) {
    return jsonResponse({ error: 'Conexão de WhatsApp da campanha não encontrada.' }, 500)
  }

  if (action === 'start') {
    if (campaign.status !== 'draft') {
      return jsonResponse({ error: `Campanha só pode iniciar a partir de draft (status atual: ${campaign.status}).` }, 409)
    }
    if (!campaign.template_name) {
      return jsonResponse({ error: 'Campanha sem template_name configurado.' }, 400)
    }

    const { count, error: countError } = await supabaseAdmin
      .from('broadcast_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', campaign.list_id)
      .eq('opted_out', false)

    if (countError) {
      return jsonResponse({ error: `Falha ao contar contatos: ${countError.message}` }, 500)
    }
    if (!count || count === 0) {
      return jsonResponse({ error: 'Lista sem contatos válidos.' }, 400)
    }
    if (count > MAX_RECIPIENTS_PER_CAMPAIGN) {
      return jsonResponse(
        { error: `Lista tem ${count} contatos, acima do limite de ${MAX_RECIPIENTS_PER_CAMPAIGN} por campanha — divida em listas menores.` },
        400,
      )
    }

    const token = tokenParaConexao(connection.status)
    if (!token) {
      return jsonResponse({ error: 'Token da conexão de WhatsApp não configurado nos secrets.' }, 500)
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('start_broadcast_campaign', {
      p_campaign_id: campaignId,
    })

    if (rpcError) {
      if ((rpcError as any).code === '23505') {
        return jsonResponse({ error: 'Já existe uma campanha em andamento nessa conexão de WhatsApp.' }, 409)
      }
      return jsonResponse({ error: `Falha ao iniciar campanha: ${rpcError.message}` }, 500)
    }

    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
    return jsonResponse({ ok: true, total_recipients: result?.recipients_created ?? 0 })
  }

  if (action === 'pause') {
    const { data, error } = await supabaseAdmin
      .from('broadcast_campaigns')
      .update({ status: 'paused' })
      .eq('id', campaignId)
      .eq('status', 'sending')
      .select('id')

    if (error) return jsonResponse({ error: `Falha ao pausar: ${error.message}` }, 500)
    if (!data || data.length === 0) {
      return jsonResponse({ error: 'Campanha não está em andamento.' }, 409)
    }
    return jsonResponse({ ok: true })
  }

  if (action === 'resume') {
    const { data, error } = await supabaseAdmin
      .from('broadcast_campaigns')
      .update({ status: 'sending' })
      .eq('id', campaignId)
      .eq('status', 'paused')
      .select('id')

    if (error) {
      if ((error as any).code === '23505') {
        return jsonResponse({ error: 'Já existe outra campanha em andamento nessa conexão de WhatsApp.' }, 409)
      }
      return jsonResponse({ error: `Falha ao retomar: ${error.message}` }, 500)
    }
    if (!data || data.length === 0) {
      return jsonResponse({ error: 'Campanha não está pausada.' }, 409)
    }
    return jsonResponse({ ok: true })
  }

  // action === 'test': manda 1 mensagem de Template pro número informado, sem tocar em
  // recipients/contadores — jeito barato de validar template_name/quantidade de
  // variáveis antes de disparar pra lista real (ainda não há Template aprovado pra
  // testar com antecedência de outra forma).
  if (!testPhoneNumber) {
    return jsonResponse({ error: 'Esperado test_phone_number pra action "test".' }, 400)
  }

  const token = tokenParaConexao(connection.status)
  if (!token) {
    return jsonResponse({ error: 'Token da conexão de WhatsApp não configurado nos secrets.' }, 500)
  }

  const variableMapping = (campaign.variable_mapping as string[]) ?? []
  const bodyParameters = variableMapping.map((key) => (key === 'full_name' ? 'Teste' : `[${key}]`))

  try {
    const whatsappMessageId = await enviarMensagemTemplate({
      phoneNumberId: connection.phone_number_id,
      token,
      to: testPhoneNumber.replace(/\D/g, ''),
      templateName: campaign.template_name,
      templateLanguage: campaign.template_language,
      bodyParameters,
    })
    return jsonResponse({ ok: true, whatsapp_message_id: whatsappMessageId })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 502)
  }
})
