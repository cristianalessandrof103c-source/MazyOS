// deno-lint-ignore-file no-explicit-any
// Desativar/reativar um membro do tenant (ex: SDR/Closer que saiu da empresa). Sem policy
// de UPDATE genérica em memberships pra isso de propósito (Fase 0/7 só liberam
// memberships_accept_self, o próprio convidado aceitando o convite) — qualquer outra
// escrita em memberships passa por aqui, com service_role, mesmo padrão de invite-member.
//
// Desativar em vez de deletar: perde a claim tenant_roles no próximo refresh/login (ver
// custom_access_token_hook, 0012_role_write_restrictions.sql), cortando o acesso igual a
// uma remoção — mas fica reversível se a pessoa voltar, e não quebra FKs (leads/deals
// atribuídos a ela continuam íntegros).

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
  const membershipId = body.membership_id as string | undefined
  const action = body.action as string | undefined

  if (!tenantId || !membershipId || !action) {
    return jsonResponse({ error: 'Esperado { tenant_id, membership_id, action }' }, 400)
  }
  if (!['disable', 'reactivate'].includes(action)) {
    return jsonResponse({ error: 'action precisa ser disable ou reactivate' }, 400)
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
      return jsonResponse({ error: 'Só tenant_admin pode gerenciar membros desse tenant.' }, 403)
    }
  }

  const { data: target, error: targetError } = await supabaseAdmin
    .from('memberships')
    .select('*')
    .eq('id', membershipId)
    .maybeSingle()

  if (targetError || !target || target.tenant_id !== tenantId) {
    return jsonResponse({ error: 'Membro não encontrado nesse tenant.' }, 404)
  }

  if (action === 'disable') {
    if (target.user_id === caller.id) {
      return jsonResponse({ error: 'Você não pode remover a si mesmo.' }, 400)
    }

    if (target.role === 'tenant_admin') {
      const { count } = await supabaseAdmin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('role', 'tenant_admin')
        .eq('status', 'active')

      if ((count ?? 0) <= 1) {
        return jsonResponse({ error: 'Esse é o único admin ativo do tenant — promova outro admin antes de remover este.' }, 400)
      }
    }

    const { error } = await supabaseAdmin.from('memberships').update({ status: 'disabled' }).eq('id', membershipId)
    if (error) return jsonResponse({ error: `Falha ao remover: ${error.message}` }, 500)
    return jsonResponse({ ok: true })
  }

  // action === 'reactivate'
  const { error } = await supabaseAdmin.from('memberships').update({ status: 'active' }).eq('id', membershipId)
  if (error) return jsonResponse({ error: `Falha ao reativar: ${error.message}` }, 500)
  return jsonResponse({ ok: true })
})
