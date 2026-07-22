// deno-lint-ignore-file no-explicit-any
// Fase 10a — cria/desconecta a conexão de WhatsApp Web (QR Code) de um tenant. Exige
// tenant_admin (mesmo critério de broadcast-campaign-control) porque isso gera um segredo
// (token de dispositivo) que dá acesso de leitura/escrita de mensagens em nome do número.
//
// Arquivo autocontido de propósito (sem import de _shared/) — mesmo padrão das outras
// functions de disparo, resiliente a deploy manual pelo editor web se o CLI cair de novo.
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke): mantém
// verificação de JWT padrão (deploy sem --no-verify-jwt).

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

// Token de dispositivo: 32 bytes aleatórios em base64url. Só existe em texto puro aqui,
// na resposta de "create" — o banco guarda só o hash (ver comment na migration 0016).
function gerarTokenDispositivo(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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
  const connectionId = body.connection_id as string | undefined

  if (!tenantId || !action) {
    return jsonResponse({ error: 'Esperado { tenant_id, action }' }, 400)
  }
  if (!['create', 'disconnect'].includes(action)) {
    return jsonResponse({ error: 'action precisa ser create ou disconnect' }, 400)
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

    if (!callerMembership || !['tenant_admin', 'tenant_manager'].includes(callerMembership.role)) {
      return jsonResponse({ error: 'Só tenant_admin/tenant_manager pode gerenciar a conexão de WhatsApp Web.' }, 403)
    }
  }

  if (action === 'create') {
    const rawToken = gerarTokenDispositivo()
    const tokenHash = await sha256Hex(rawToken)

    const { data: connection, error } = await supabaseAdmin
      .from('whatsapp_connections')
      .insert({
        tenant_id: tenantId,
        connection_type: 'qr_web',
        web_status: 'disconnected',
        web_device_token_hash: tokenHash,
      })
      .select('id')
      .single()

    if (error) {
      return jsonResponse({ error: `Falha ao criar conexão: ${error.message}` }, 500)
    }

    return jsonResponse({ ok: true, connection_id: connection.id, device_token: rawToken })
  }

  // action === 'disconnect'
  if (!connectionId) {
    return jsonResponse({ error: 'Esperado connection_id pra action "disconnect".' }, 400)
  }

  const { data: existing } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('id, tenant_id, connection_type')
    .eq('id', connectionId)
    .maybeSingle()

  if (!existing || existing.tenant_id !== tenantId || existing.connection_type !== 'qr_web') {
    return jsonResponse({ error: 'Conexão de WhatsApp Web não encontrada pra esse tenant.' }, 404)
  }

  // Zera o hash do token: o agente local antigo perde acesso na próxima chamada
  // (whatsapp-web-device não vai mais achar o token dele) e precisa de um token novo
  // pra reconectar — evita um dispositivo "esquecido" continuar mandando/recebendo.
  const { error: disconnectError } = await supabaseAdmin
    .from('whatsapp_connections')
    .update({
      web_status: 'disconnected',
      web_device_token_hash: null,
      qr_pairing_code: null,
      qr_updated_at: null,
    })
    .eq('id', connectionId)

  if (disconnectError) {
    return jsonResponse({ error: `Falha ao desconectar: ${disconnectError.message}` }, 500)
  }

  return jsonResponse({ ok: true })
})
