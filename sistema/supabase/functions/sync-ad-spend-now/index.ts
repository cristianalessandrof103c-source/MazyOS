// deno-lint-ignore-file no-explicit-any
// Fase 3 — botão "Sincronizar agora" do Financeiro. sync-ad-spend (cron diário, 6h)
// sincroniza TODOS os tenants de uma vez e não tem como o dashboard chamar ele direto
// (protegido só pelo dispatcher secret, não por JWT — não dá pra expor esse segredo pro
// browser). Esta function é a mesma lógica (porte de scripts/lib/meta-ads-api.js), mas
// autenticada por usuário e escopada a UM tenant só, chamável direto do Financeiro.
//
// Autocontida (sem _shared/), mesmo padrão de prospeccao-buscar/worker — deploy manual
// "Via Editor" não suporta pasta compartilhada entre functions.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const META_ADS_ACCESS_TOKEN = Deno.env.get('META_ADS_ACCESS_TOKEN') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const GRAPH_VERSION = 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
const RESULTADO_ACTION_TYPE = 'onsite_conversion.messaging_conversation_started_7d'

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

class TokenExpiradoError extends Error {}

async function graphGet(path: string, params: Record<string, string>) {
  const url = `${GRAPH_BASE}/${path}?${new URLSearchParams(params)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) {
    if (data.error?.type === 'OAuthException' || data.error?.code === 190) {
      throw new TokenExpiradoError('Token de acesso do Meta Ads expirado ou inválido.')
    }
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`
    throw new Error(`Marketing API ${path} falhou: ${msg}`)
  }
  return data
}

async function buscarInsightsDiarios(campaignId: string, dias = 7) {
  const data = await graphGet(`${campaignId}/insights`, {
    fields: 'spend,actions,cost_per_action_type,impressions,clicks',
    date_preset: `last_${dias}d`,
    time_increment: '1',
    access_token: META_ADS_ACCESS_TOKEN,
  })
  return data.data ?? []
}

function extrairResultado(insight: any): number {
  const item = insight.actions?.find((a: any) => a.action_type === RESULTADO_ACTION_TYPE)
  return item ? Number(item.value) : 0
}

function extrairCpa(insight: any): number | null {
  const item = insight.cost_per_action_type?.find((a: any) => a.action_type === RESULTADO_ACTION_TYPE)
  return item ? Math.round(Number(item.value) * 100) : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  if (!META_ADS_ACCESS_TOKEN) {
    return jsonResponse({ error: 'Faltando META_ADS_ACCESS_TOKEN nos secrets do projeto.' }, 500)
  }

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
      return jsonResponse({ error: 'Sem permissão pra sincronizar esse tenant.' }, 403)
    }
  }

  const { data: connections, error: connError } = await supabaseAdmin
    .from('ad_account_connections')
    .select('*')
    .eq('tenant_id', tenantId)
  if (connError) return jsonResponse({ error: connError.message }, 500)
  if (!connections || connections.length === 0) {
    return jsonResponse({ error: 'Nenhuma conta de anúncios do Meta conectada pra esse tenant ainda.' }, 400)
  }

  const results: any[] = []
  for (const connection of connections) {
    for (const campaignId of connection.campaign_ids as string[]) {
      try {
        const insights = await buscarInsightsDiarios(campaignId)
        for (const insight of insights) {
          const spendCents = Math.round(Number(insight.spend ?? 0) * 100)
          await supabaseAdmin.from('ad_spend_snapshots').upsert(
            {
              tenant_id: tenantId,
              campaign_id: campaignId,
              date: insight.date_start,
              spend_cents: spendCents,
              impressions: Number(insight.impressions ?? 0),
              clicks: Number(insight.clicks ?? 0),
              results_count: extrairResultado(insight),
              cpa_cents: extrairCpa(insight),
            },
            { onConflict: 'tenant_id,campaign_id,date' },
          )
        }
        results.push({ campaignId, days: insights.length, kind: 'synced' })
      } catch (err) {
        const tokenExpirado = err instanceof TokenExpiradoError
        results.push({
          campaignId,
          kind: tokenExpirado ? 'token_expirado' : 'error',
          message: (err as Error).message,
        })
      }
    }
  }

  const algumTokenExpirado = results.some((r) => r.kind === 'token_expirado')
  const algumSucesso = results.some((r) => r.kind === 'synced')

  if (!algumSucesso && algumTokenExpirado) {
    return jsonResponse(
      { ok: false, error: 'Token de acesso do Meta Ads expirado ou inválido. Gere um novo em Business Settings → System Users.', results },
      502,
    )
  }
  if (!algumSucesso) {
    return jsonResponse({ ok: false, error: results[0]?.message ?? 'Falha ao sincronizar.', results }, 502)
  }

  return jsonResponse({ ok: true, results })
})
