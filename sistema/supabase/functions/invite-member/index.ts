// deno-lint-ignore-file no-explicit-any
// Convite self-service (Fase 7) — tenant_admin convida um usuário por email pro próprio
// tenant. Chamada direto pelo dashboard autenticado (supabase.functions.invoke), mesmo padrão
// de hub-instagram-publish: mantém verificação de JWT padrão (deploy sem --no-verify-jwt).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const ALLOWED_ROLES = ['tenant_admin', 'tenant_manager', 'tenant_agent', 'tenant_viewer']

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
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

  const { tenant_id: tenantId, email, role, redirect_to: redirectTo } = body
  if (!tenantId || !email || !role) {
    return jsonResponse({ error: 'Esperado { tenant_id, email, role }' }, 400)
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return jsonResponse({ error: `role precisa ser um de: ${ALLOWED_ROLES.join(', ')}` }, 400)
  }

  // Client com o JWT de quem chamou: usado só pra checar autorização (RLS enxerga a própria
  // membership do caller). A escrita em si sempre passa por supabaseAdmin.
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
      return jsonResponse({ error: 'Só tenant_admin pode convidar membros pra esse tenant.' }, 403)
    }
  }

  const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  })
  if (inviteError || !invited?.user) {
    return jsonResponse({ error: inviteError?.message ?? 'Falha ao convidar — email já pode ter conta na plataforma.' }, 502)
  }

  const { error: membershipError } = await supabaseAdmin.from('memberships').insert({
    tenant_id: tenantId,
    user_id: invited.user.id,
    role,
    status: 'invited',
    invited_at: new Date().toISOString(),
    invited_email: email,
  })
  if (membershipError) {
    return jsonResponse({ error: `Convite enviado, mas falhou ao vincular ao tenant: ${membershipError.message}` }, 500)
  }

  return jsonResponse({ ok: true })
})
