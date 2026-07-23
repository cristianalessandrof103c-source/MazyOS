// deno-lint-ignore-file no-explicit-any
// Dispatcher do motor de follow-up (Fase 3) — chamado por pg_cron (via pg_net)
// a cada ~2min. Processa follow_up_jobs vencidos:
//
// - Job com sequence_id: renderiza o template do passo e manda via WhatsApp
//   (só dentro da janela de 24h — fora dela precisaria de Template
//   pré-aprovado pela Meta, que ainda não temos; o job fica pendente e tenta
//   de novo no próximo ciclo). Ao enviar, encadeia o próximo passo da mesma
//   sequência, se existir.
// - Job ad-hoc (sem sequence_id, da tool agendar_followup): não manda nada
//   sozinho — escala a conversa pra needs_human, igual a tool
//   escalar_para_humano. É um lembrete pro humano, não uma mensagem roteirizada.
//
// Protegido por um header secreto (não JWT, porque quem chama é pg_net, não
// um usuário autenticado) — valor vem do Vault, nunca commitado no git.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { enviarMensagemTexto } from '../_shared/whatsapp-api.ts'
import { tokenParaConexao } from '../_shared/whatsapp-tokens.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DISPATCHER_SECRET = Deno.env.get('DISPATCHER_SECRET') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

async function processJob(job: any) {
  if (!job.sequence_id) {
    if (job.conversation_id) {
      await supabaseAdmin.from('conversations').update({ status: 'needs_human' }).eq('id', job.conversation_id)
    }
    await supabaseAdmin.from('follow_up_jobs').update({ status: 'sent' }).eq('id', job.id)
    return { id: job.id, kind: 'adhoc_escalated' }
  }

  const { data: step } = await supabaseAdmin
    .from('follow_up_sequence_steps')
    .select('*')
    .eq('id', job.step_id)
    .single()
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', job.lead_id).single()
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('id', job.conversation_id)
    .single()
  const { data: company } = await supabaseAdmin.from('companies').select('name').eq('id', job.tenant_id).single()
  const { data: connections } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('phone_number_id, status')
    .eq('tenant_id', job.tenant_id)
    // Fase 10a: exclui conexões qr_web (phone_number_id sempre null nelas) — esse follow-up
    // é especificamente da Cloud API, não teria como mandar por WhatsApp Web mesmo.
    .eq('connection_type', 'cloud_api')
  // Se o tenant tiver as duas conexões (test + live, durante o corte da Fase 6),
  // prioriza a live — é a que de fato conversa com leads reais.
  const connection = connections?.find((c) => c.status === 'live') ?? connections?.[0]

  if (!step || !lead?.phone_number || !conversation || !connection) {
    await supabaseAdmin
      .from('follow_up_jobs')
      .update({ status: 'canceled', note: 'faltou lead/telefone/conversa/conexao pra enviar' })
      .eq('id', job.id)
    return { id: job.id, kind: 'canceled_missing_data' }
  }

  const windowOpen = conversation.window_expires_at && new Date(conversation.window_expires_at) > new Date()
  if (!windowOpen) {
    // Fora da janela de 24h a Cloud API exige Template pré-aprovado pela Meta — ainda não
    // configurado. Deixa pendente: se o lead mandar mensagem de novo a janela reabre e o
    // próximo ciclo do dispatcher entrega.
    return { id: job.id, kind: 'skipped_window_closed' }
  }

  const text = renderTemplate(step.message_template, {
    lead_name: lead.full_name,
    company_name: company?.name ?? '',
  })

  const waMessageId = await enviarMensagemTexto({
    phoneNumberId: connection.phone_number_id,
    token: tokenParaConexao(connection.status),
    to: lead.phone_number,
    body: text,
  })

  await supabaseAdmin.from('messages').insert({
    tenant_id: job.tenant_id,
    conversation_id: job.conversation_id,
    direction: 'outbound',
    sender_type: 'agent',
    content_text: text,
    whatsapp_message_id: waMessageId,
    tool_calls: [{ name: 'follow_up_sequence', input: { sequence_id: job.sequence_id, step_order: step.step_order } }],
  })

  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', job.conversation_id)

  await supabaseAdmin.from('follow_up_jobs').update({ status: 'sent' }).eq('id', job.id)

  const { data: nextStep } = await supabaseAdmin
    .from('follow_up_sequence_steps')
    .select('*')
    .eq('sequence_id', job.sequence_id)
    .eq('step_order', step.step_order + 1)
    .maybeSingle()

  if (nextStep) {
    await supabaseAdmin.from('follow_up_jobs').insert({
      tenant_id: job.tenant_id,
      lead_id: job.lead_id,
      conversation_id: job.conversation_id,
      sequence_id: job.sequence_id,
      step_id: nextStep.id,
      scheduled_for: new Date(Date.now() + nextStep.delay_hours * 3600 * 1000).toISOString(),
    })
  }

  return { id: job.id, kind: 'sent' }
}

Deno.serve(async (req: Request) => {
  if (!DISPATCHER_SECRET || req.headers.get('x-dispatcher-secret') !== DISPATCHER_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  const { data: dueJobs, error } = await supabaseAdmin
    .from('follow_up_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(25)

  if (error) {
    console.error('Erro buscando jobs vencidos:', error)
    return new Response('Error', { status: 500 })
  }

  const results: any[] = []
  for (const job of dueJobs ?? []) {
    try {
      results.push(await processJob(job))
    } catch (err) {
      console.error('Erro processando job', job.id, err)
      results.push({ id: job.id, kind: 'error', message: (err as Error).message })
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
