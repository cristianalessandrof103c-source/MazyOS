// deno-lint-ignore-file no-explicit-any
// Fase 10a/10b — API que o agente local (whatsapp-local-agent/, fora deste repo de infra,
// roda no PC do usuário) chama pra: (10a) reportar o estado da sessão do WhatsApp Web (QR
// gerado, conectado, desconectado, heartbeat); (10b) drenar a fila de mensagens de saída e
// reportar mensagens recebidas, pro chat dentro do dashboard.
//
// Protegida por header x-device-token (não JWT — quem chama é um processo Node local, não
// um usuário logado no dashboard), mesmo espírito do x-dispatcher-secret do
// broadcast-dispatcher, só que por conexão em vez de um secret global (cada tenant tem o
// seu, gerado em whatsapp-web-connection?action=create). O banco só guarda o hash SHA-256
// do token (ver comment na migration 0016) — aqui a gente hasheia o que chegou e compara.
// tenant_id/connection_id SEMPRE vêm do lookup pelo token, nunca do body (mesmo princípio
// de whatsapp-webhook: nunca confiar em tenant_id cru mandado por quem chama).
//
// Arquivo autocontido de propósito (sem import de _shared/), deployada com --no-verify-jwt
// (like broadcast-dispatcher) porque a autenticação é o token de dispositivo, não um JWT.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const ACTIONS = [
  'heartbeat',
  'push-qr',
  'push-connected',
  'push-disconnected',
  'pull-outbound',
  'push-outbound-result',
  'push-inbound',
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Duplica resolveLead/resolveConversation de whatsapp-webhook/crm.ts e
// whatsapp-web-send/index.ts (mesmo motivo de sempre: function autocontida).
async function resolveLead(tenantId: string, phoneNumber: string, profileName: string | undefined) {
  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('phone_number', phoneNumber)
    .maybeSingle()
  if (existing) return existing

  const { data: newStage } = await supabaseAdmin
    .from('pipeline_stages')
    .select('id')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('category', 'new')
    .order('tenant_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const { data: channel } = await supabaseAdmin
    .from('acquisition_channels')
    .select('id')
    .is('tenant_id', null)
    .eq('code', 'direct_contact')
    .maybeSingle()

  const { data: created, error } = await supabaseAdmin
    .from('leads')
    .insert({
      tenant_id: tenantId,
      full_name: profileName || phoneNumber,
      phone_number: phoneNumber,
      acquisition_channel_id: channel?.id ?? null,
      stage_id: newStage?.id,
    })
    .select()
    .single()
  if (error) throw error
  return created
}

async function resolveConversation(tenantId: string, leadId: string, connectionId: string) {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId)
    .in('status', ['active', 'needs_human'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return existing

  const { data: created, error } = await supabaseAdmin
    .from('conversations')
    .insert({ tenant_id: tenantId, lead_id: leadId, whatsapp_connection_id: connectionId })
    .select()
    .single()
  if (error) throw error
  return created
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const deviceToken = req.headers.get('x-device-token')
  if (!deviceToken) {
    return jsonResponse({ error: 'Header x-device-token obrigatório.' }, 401)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const action = body.action as string | undefined
  if (!action || !ACTIONS.includes(action)) {
    return jsonResponse({ error: `action precisa ser uma de: ${ACTIONS.join(', ')}` }, 400)
  }

  const tokenHash = await sha256Hex(deviceToken)

  const { data: connection, error: lookupError } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('id, tenant_id')
    .eq('connection_type', 'qr_web')
    .eq('web_device_token_hash', tokenHash)
    .maybeSingle()

  if (lookupError) {
    return jsonResponse({ error: `Falha ao validar dispositivo: ${lookupError.message}` }, 500)
  }
  if (!connection) {
    return jsonResponse({ error: 'Token de dispositivo inválido ou revogado.' }, 401)
  }

  // --- Fase 10a: status da sessão ---
  if (['heartbeat', 'push-qr', 'push-connected', 'push-disconnected'].includes(action)) {
    const now = new Date().toISOString()
    let update: Record<string, unknown> = { last_seen_at: now }

    if (action === 'push-qr') {
      const qr = body.qr as string | undefined
      if (!qr) return jsonResponse({ error: 'Esperado { qr } pra action "push-qr".' }, 400)
      update = { ...update, qr_pairing_code: qr, qr_updated_at: now, web_status: 'qr_pending' }
    } else if (action === 'push-connected') {
      const phoneNumber = body.phone_number as string | undefined
      if (!phoneNumber) return jsonResponse({ error: 'Esperado { phone_number } pra action "push-connected".' }, 400)
      update = { ...update, connected_phone_number: phoneNumber, web_status: 'connected', qr_pairing_code: null, qr_updated_at: null }
    } else if (action === 'push-disconnected') {
      update = { ...update, web_status: 'disconnected', qr_pairing_code: null, qr_updated_at: null }
    }

    const { error: updateError } = await supabaseAdmin.from('whatsapp_connections').update(update).eq('id', connection.id)
    if (updateError) return jsonResponse({ error: `Falha ao atualizar conexão: ${updateError.message}` }, 500)
    return jsonResponse({ ok: true })
  }

  // --- Fase 10b: chat (fila de saída + mensagens recebidas) ---

  if (action === 'pull-outbound') {
    // Sem FOR UPDATE SKIP LOCKED/RPC aqui de propósito: só existe UM agente local por
    // conexão fazendo polling sequencial (não concorrente, diferente do
    // broadcast-dispatcher que roda em cron com múltiplos ticks podendo sobrepor) — o
    // risco de duplo-envio não existe na prática.
    const { data: queued, error } = await supabaseAdmin
      .from('messages')
      .select('id, content_text, conversations!inner(whatsapp_connection_id, leads!inner(phone_number))')
      .eq('status', 'queued')
      .eq('conversations.whatsapp_connection_id', connection.id)
      .order('created_at', { ascending: true })
      .limit(5)

    if (error) return jsonResponse({ error: `Falha ao buscar fila: ${error.message}` }, 500)

    const items = (queued ?? []).map((row: any) => ({
      id: row.id,
      text: row.content_text,
      phone_number: row.conversations?.leads?.phone_number ?? null,
    }))

    return jsonResponse({ ok: true, messages: items })
  }

  if (action === 'push-outbound-result') {
    const messageId = body.message_id as string | undefined
    const status = body.status as string | undefined
    if (!messageId || !status || !['sent', 'failed'].includes(status)) {
      return jsonResponse({ error: 'Esperado { message_id, status: "sent"|"failed" }' }, 400)
    }

    // Confere que a mensagem pertence mesmo a essa conexão antes de deixar o dispositivo
    // marcar status (evita um device token mexer em mensagem de outra conexão).
    const { data: owned } = await supabaseAdmin
      .from('messages')
      .select('id, conversations!inner(whatsapp_connection_id)')
      .eq('id', messageId)
      .eq('conversations.whatsapp_connection_id', connection.id)
      .maybeSingle()

    if (!owned) return jsonResponse({ error: 'Mensagem não encontrada pra essa conexão.' }, 404)

    const { error: updateError } = await supabaseAdmin
      .from('messages')
      .update({
        status,
        whatsapp_message_id: (body.whatsapp_message_id as string | undefined) ?? null,
      })
      .eq('id', messageId)

    if (updateError) return jsonResponse({ error: `Falha ao atualizar mensagem: ${updateError.message}` }, 500)
    return jsonResponse({ ok: true })
  }

  // action === 'push-inbound'
  const phoneNumber = (body.phone_number as string | undefined)?.replace(/\D/g, '')
  const text = body.text as string | undefined
  if (!phoneNumber || !text) {
    return jsonResponse({ error: 'Esperado { phone_number, text } pra action "push-inbound".' }, 400)
  }

  try {
    const lead = await resolveLead(connection.tenant_id, phoneNumber, body.profile_name as string | undefined)
    const conversation = await resolveConversation(connection.tenant_id, lead.id, connection.id)

    const { error: insertError } = await supabaseAdmin.from('messages').insert({
      tenant_id: connection.tenant_id,
      conversation_id: conversation.id,
      direction: 'inbound',
      sender_type: 'lead',
      content_text: text,
      status: 'sent',
    })
    if (insertError) throw insertError

    await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ error: `Falha ao registrar mensagem recebida: ${(err as Error).message}` }, 500)
  }
})
