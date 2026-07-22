// deno-lint-ignore-file no-explicit-any
// Fase 10a — API que o agente local (whatsapp-local-agent/, fora deste repo de infra, roda
// no PC do usuário) chama pra reportar o estado da sessão do WhatsApp Web: QR gerado,
// conectado, desconectado, heartbeat. Fases 10b/10c adicionam pull-outbound/
// push-outbound-result/push-inbound aqui mesmo (mesma function, ações novas).
//
// Protegida por header x-device-token (não JWT — quem chama é um processo Node local, não
// um usuário logado no dashboard), mesmo espírito do x-dispatcher-secret do
// broadcast-dispatcher, só que por conexão em vez de um secret global (cada tenant tem o
// seu, gerado em whatsapp-web-connection?action=create). O banco só guarda o hash SHA-256
// do token (ver comment na migration 0016) — aqui a gente hasheia o que chegou e compara.
//
// Arquivo autocontido de propósito (sem import de _shared/), deployada com --no-verify-jwt
// (like broadcast-dispatcher) porque a autenticação é o token de dispositivo, não um JWT.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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
  if (!action || !['heartbeat', 'push-qr', 'push-connected', 'push-disconnected'].includes(action)) {
    return jsonResponse({ error: 'action precisa ser heartbeat, push-qr, push-connected ou push-disconnected' }, 400)
  }

  const tokenHash = await sha256Hex(deviceToken)

  const { data: connection, error: lookupError } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('id')
    .eq('connection_type', 'qr_web')
    .eq('web_device_token_hash', tokenHash)
    .maybeSingle()

  if (lookupError) {
    return jsonResponse({ error: `Falha ao validar dispositivo: ${lookupError.message}` }, 500)
  }
  if (!connection) {
    return jsonResponse({ error: 'Token de dispositivo inválido ou revogado.' }, 401)
  }

  const now = new Date().toISOString()
  let update: Record<string, unknown> = { last_seen_at: now }

  if (action === 'heartbeat') {
    // só o heartbeat mesmo, já setado acima
  } else if (action === 'push-qr') {
    const qr = body.qr as string | undefined
    if (!qr) return jsonResponse({ error: 'Esperado { qr } pra action "push-qr".' }, 400)
    update = { ...update, qr_pairing_code: qr, qr_updated_at: now, web_status: 'qr_pending' }
  } else if (action === 'push-connected') {
    const phoneNumber = body.phone_number as string | undefined
    if (!phoneNumber) return jsonResponse({ error: 'Esperado { phone_number } pra action "push-connected".' }, 400)
    update = { ...update, connected_phone_number: phoneNumber, web_status: 'connected', qr_pairing_code: null, qr_updated_at: null }
  } else {
    // push-disconnected
    update = { ...update, web_status: 'disconnected', qr_pairing_code: null, qr_updated_at: null }
  }

  const { error: updateError } = await supabaseAdmin
    .from('whatsapp_connections')
    .update(update)
    .eq('id', connection.id)

  if (updateError) {
    return jsonResponse({ error: `Falha ao atualizar conexão: ${updateError.message}` }, 500)
  }

  return jsonResponse({ ok: true })
})
