// deno-lint-ignore-file no-explicit-any
// Fase 10b — reavalia o site de UM prospect já existente (capturado antes da migration
// 0017, sem site_reachable/https/mobile_friendly ainda) sob demanda, pelo botão
// "Reavaliar site" da linha na Prospecção. Sem backfill automático em massa de propósito
// — o dono revisita manualmente os prospects que importam.
//
// Arquivo autocontido de propósito (mesmo padrão de prospeccao-buscar/prospeccao-worker):
// duplica a função analisarSite em vez de importar de _shared/.

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

async function analisarSite(websiteUri: string) {
  const VIEWPORT_REGEX = /<meta[^>]+name=["']viewport["'][^>]*>/i
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(websiteUri, { signal: controller.signal })
    const html = (await res.text()).slice(0, 500_000)
    return { reachable: res.ok, https: res.url.startsWith('https://'), mobile_friendly: VIEWPORT_REGEX.test(html) }
  } catch {
    return { reachable: false, https: false, mobile_friendly: false }
  } finally {
    clearTimeout(timeout)
  }
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

  const prospectId = body.prospect_id as string | undefined
  if (!prospectId) {
    return jsonResponse({ error: 'Esperado { prospect_id }' }, 400)
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

  const { data: prospect, error: prospectError } = await supabaseAdmin
    .from('prospects')
    .select('id, tenant_id, website')
    .eq('id', prospectId)
    .maybeSingle()

  if (prospectError || !prospect) {
    return jsonResponse({ error: 'Prospect não encontrado.' }, 404)
  }

  const { data: platformAdminRow } = await supabaseUser
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!platformAdminRow) {
    const { data: membership } = await supabaseUser
      .from('memberships')
      .select('id')
      .eq('tenant_id', prospect.tenant_id)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership) {
      return jsonResponse({ error: 'Sem permissão pra esse tenant.' }, 403)
    }
  }

  if (!prospect.website) {
    return jsonResponse({ error: 'Esse prospect não tem site cadastrado.' }, 400)
  }

  const analise = await analisarSite(prospect.website)

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('prospects')
    .update({
      site_reachable: analise.reachable,
      site_https: analise.https,
      site_mobile_friendly: analise.mobile_friendly,
    })
    .eq('id', prospectId)
    .select('quality_score')
    .single()

  if (updateError) {
    return jsonResponse({ error: `Falha ao salvar: ${updateError.message}` }, 500)
  }

  return jsonResponse({ ok: true, quality_score: updated.quality_score })
})
