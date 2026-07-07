// deno-lint-ignore-file no-explicit-any
// Webhook do WhatsApp Cloud API (Fase 2 — número de teste).
//
// GET  = handshake de verificação (Meta chama isso ao registrar a URL do webhook).
// POST = mensagem recebida: resolve tenant via phone_number_id, salva no CRM,
//        roda o agente de IA (Claude + tools) e responde no WhatsApp.
//
// Responde 200 o mais rápido possível — o processamento pesado roda em
// background via EdgeRuntime.waitUntil, pra não estourar o timeout de
// entrega de webhook da Meta e disparar reentregas duplicadas.

import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { enviarMensagemTexto } from './whatsapp-api.ts'
import { resolveConversation, resolveLead } from './crm.ts'
import { runAgentLoop } from './agent.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? ''
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') ?? ''
const WHATSAPP_ACCESS_TOKEN = Deno.env.get('WHATSAPP_TEST_ACCESS_TOKEN') ?? ''
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !APP_SECRET) return false
  const expected = signatureHeader.replace('sha256=', '')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

async function processInboundMessage(value: any) {
  let debugTenantId: string | undefined
  let debugConversationId: string | undefined
  try {
    const phoneNumberId = value.metadata?.phone_number_id
    const { data: connection } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('id, tenant_id')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle()

    if (!connection) {
      console.error('Nenhuma whatsapp_connections encontrada pra phone_number_id', phoneNumberId)
      return
    }
    const tenantId = connection.tenant_id as string
    debugTenantId = tenantId

    const waMessage = value.messages[0]
    if (waMessage.type !== 'text') {
      console.log('Mensagem nao-texto ignorada:', waMessage.type)
      return
    }

    const from = waMessage.from as string
    const text = waMessage.text.body as string
    const profileName = value.contacts?.[0]?.profile?.name as string | undefined

    const lead = await resolveLead(supabaseAdmin, tenantId, from, profileName)
    const conversation = await resolveConversation(supabaseAdmin, tenantId, lead.id)
    debugConversationId = conversation.id

    await supabaseAdmin.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: 'inbound',
      sender_type: 'lead',
      content_text: text,
      whatsapp_message_id: waMessage.id,
    })

    await supabaseAdmin
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        window_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      })
      .eq('id', conversation.id)

    if (conversation.status === 'needs_human') {
      console.log('Conversa em needs_human — agente nao responde automaticamente.')
      return
    }

    const [{ data: agentConfig }, { data: company }, { data: history }] = await Promise.all([
      supabaseAdmin.from('agent_configs').select('*').eq('tenant_id', tenantId).maybeSingle(),
      supabaseAdmin.from('companies').select('name').eq('id', tenantId).single(),
      supabaseAdmin
        .from('messages')
        .select('direction, content_text')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(20),
    ])

    const { finalText, toolCalls } = await runAgentLoop({
      anthropic,
      supabaseAdmin,
      tenantId,
      leadId: lead.id,
      conversationId: conversation.id,
      companyName: company?.name ?? 'a empresa',
      agentConfig,
      history: history ?? [],
      incomingText: text,
    })

    const outboundText = finalText || 'Certo!'
    const waMessageId = await enviarMensagemTexto({
      phoneNumberId,
      token: WHATSAPP_ACCESS_TOKEN,
      to: from,
      body: outboundText,
    })

    await supabaseAdmin.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: 'outbound',
      sender_type: 'agent',
      content_text: outboundText,
      whatsapp_message_id: waMessageId,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
    })
  } catch (err) {
    console.error('Erro processando mensagem inbound:', err)
    if (debugTenantId && debugConversationId) {
      await supabaseAdmin.from('messages').insert({
        tenant_id: debugTenantId,
        conversation_id: debugConversationId,
        direction: 'outbound',
        sender_type: 'agent',
        content_text: `[erro interno] ${(err as Error).message}`,
      })
    }
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return new Response(challenge ?? '', { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  if (req.method === 'POST') {
    const rawBody = await req.text()
    const signature = req.headers.get('x-hub-signature-256')
    const valid = await verifySignature(rawBody, signature)
    if (!valid) {
      return new Response('Invalid signature', { status: 401 })
    }

    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value
    if (!value?.messages?.length) {
      // Webhook de status (entregue/lido) ou outro evento sem mensagem — nada a fazer.
      return new Response('OK', { status: 200 })
    }

    const task = processInboundMessage(value)
    const edgeRuntime = (globalThis as any).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(task)
    } else {
      await task
    }

    return new Response('OK', { status: 200 })
  }

  return new Response('Method not allowed', { status: 405 })
})
