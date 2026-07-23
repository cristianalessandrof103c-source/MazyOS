// deno-lint-ignore-file no-explicit-any
// Fase 10b — chat via WhatsApp Web (QR) direto do dashboard: abrir uma conversa com um
// lead/prospect (resolvendo-ou-criando o lead + a conversa) e mandar mensagens. Reaproveita
// os mesmos `conversations`/`messages` do agente de IA (Fase 2/3) — uma conversa via QR fica
// indistinguível de uma via Cloud API pro resto do app (CRM, ConversationDialog).
//
// A mensagem entra "queued" -- quem efetivamente manda pro WhatsApp é o agente local
// (whatsapp-local-agent/), que drena a fila via whatsapp-web-device?action=pull-outbound.
// Essa function não fala com o Baileys, só grava no banco.
//
// Arquivo autocontido de propósito (sem import de _shared/) — mesmo padrão das outras
// functions de disparo/prospecção.
//
// Chamada direto pelo dashboard autenticado: mantém verificação de JWT padrão.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

// Duplica resolveLead/resolveConversation de whatsapp-webhook/crm.ts (mesmo motivo de
// sempre: cada function é autocontida, sem import cross-function).
async function resolveLead(tenantId: string, phoneNumber: string, fullName: string) {
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
      full_name: fullName || phoneNumber,
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
  const action = body.action as string | undefined

  if (!tenantId || !action) {
    return jsonResponse({ error: 'Esperado { tenant_id, action }' }, 400)
  }
  if (!['open', 'send'].includes(action)) {
    return jsonResponse({ error: 'action precisa ser open ou send' }, 400)
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
    const { data: membership } = await supabaseUser
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership || membership.role === 'tenant_viewer') {
      return jsonResponse({ error: 'Sem permissão pra mandar mensagem nesse tenant.' }, 403)
    }
  }

  if (action === 'open') {
    const phoneNumber = (body.phone_number as string | undefined)?.replace(/\D/g, '')
    const fullName = body.full_name as string | undefined
    if (!phoneNumber) {
      return jsonResponse({ error: 'Esperado { phone_number }' }, 400)
    }

    const { data: connection } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('connection_type', 'qr_web')
      .eq('web_status', 'connected')
      .maybeSingle()

    if (!connection) {
      return jsonResponse({ error: 'Nenhum WhatsApp conectado pra esse tenant — conecte em Disparos → WhatsApp.' }, 409)
    }

    try {
      const lead = await resolveLead(tenantId, phoneNumber, fullName ?? phoneNumber)
      const conversation = await resolveConversation(tenantId, lead.id, connection.id)
      return jsonResponse({ ok: true, lead_id: lead.id, conversation_id: conversation.id })
    } catch (err) {
      return jsonResponse({ error: `Falha ao abrir conversa: ${(err as Error).message}` }, 500)
    }
  }

  // action === 'send'
  const conversationId = body.conversation_id as string | undefined
  const text = (body.text as string | undefined)?.trim()
  if (!conversationId || !text) {
    return jsonResponse({ error: 'Esperado { conversation_id, text }' }, 400)
  }

  const { data: conversation, error: conversationError } = await supabaseAdmin
    .from('conversations')
    .select('id, tenant_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (conversationError || !conversation || conversation.tenant_id !== tenantId) {
    return jsonResponse({ error: 'Conversa não encontrada pra esse tenant.' }, 404)
  }

  const { data: message, error: messageError } = await supabaseAdmin
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: 'human',
      content_text: text,
      status: 'queued',
    })
    .select('id')
    .single()

  if (messageError) {
    return jsonResponse({ error: `Falha ao enfileirar mensagem: ${messageError.message}` }, 500)
  }

  await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

  return jsonResponse({ ok: true, message_id: message.id })
})
