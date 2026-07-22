// deno-lint-ignore-file no-explicit-any
// Fase 10 — status ao vivo da conexão de WhatsApp (número, nome verificado, qualidade),
// pra tela de "Agente" mostrar um card de saúde da conexão (mesmo espírito de card de
// conexão do n8n). Só leitura na Graph API.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WHATSAPP_TEST_ACCESS_TOKEN = Deno.env.get('WHATSAPP_TEST_ACCESS_TOKEN') ?? ''
const WHATSAPP_LIVE_ACCESS_TOKEN = Deno.env.get('WHATSAPP_LIVE_ACCESS_TOKEN') ?? ''
const GRAPH_VERSION = 'v21.0'

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function tokenParaConexao(status: string): string {
  return status === 'live' ? WHATSAPP_LIVE_ACCESS_TOKEN : WHATSAPP_TEST_ACCESS_TOKEN
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const tenantId = body.tenant_id as string | undefined
  if (!tenantId) return jsonResponse({ error: 'Esperado { tenant_id }' }, 400)

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user: caller },
  } = await supabaseUser.auth.getUser()
  if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

  const { data: platformAdminRow } = await supabaseUser.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle()
  if (!platformAdminRow) {
    const { data: callerMembership } = await supabaseUser
      .from('memberships')
      .select('role')
      .eq('tenant_id', tenantId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()
    if (!callerMembership) return jsonResponse({ error: 'Você não é membro desse tenant.' }, 403)
  }

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from('whatsapp_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (connectionError || !connection) return jsonResponse({ ok: true, connection: null })

  const token = tokenParaConexao(connection.status)
  if (!token) {
    return jsonResponse({ ok: true, connection: { ...connection, graph: null, graph_error: 'Token não configurado nos secrets.' } })
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${connection.phone_number_id}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const graphData = await res.json()

  return jsonResponse({
    ok: true,
    connection: { ...connection, graph: res.ok ? graphData : null, graph_error: res.ok ? null : graphData.error?.message ?? `HTTP ${res.status}` },
  })
})
