// deno-lint-ignore-file no-explicit-any
// Sincroniza gasto/resultado diário do Meta Ads pro dashboard financeiro
// (Fase 3). Porte de scripts/lib/meta-ads-api.js (buscarInsightsDiarios) pra
// Deno — mesmo padrão de fetch puro, só troca node-fetch por fetch nativo.
// Chamado 1x/dia por pg_cron (ver migration 0006_ad_spend.sql). Protegido
// pelo mesmo header secreto do follow-up-dispatcher.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DISPATCHER_SECRET = Deno.env.get('DISPATCHER_SECRET') ?? ''
const META_ADS_ACCESS_TOKEN = Deno.env.get('META_ADS_ACCESS_TOKEN') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const GRAPH_VERSION = 'v21.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
const RESULTADO_ACTION_TYPE = 'onsite_conversion.messaging_conversation_started_7d'

async function graphGet(path: string, params: Record<string, string>) {
  const url = `${GRAPH_BASE}/${path}?${new URLSearchParams(params)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) {
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
  if (!DISPATCHER_SECRET || req.headers.get('x-dispatcher-secret') !== DISPATCHER_SECRET) {
    return new Response('Forbidden', { status: 403 })
  }

  const { data: connections, error } = await supabaseAdmin.from('ad_account_connections').select('*')
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const results: any[] = []
  for (const connection of connections ?? []) {
    for (const campaignId of connection.campaign_ids as string[]) {
      try {
        const insights = await buscarInsightsDiarios(campaignId)
        for (const insight of insights) {
          const spendCents = Math.round(Number(insight.spend ?? 0) * 100)
          await supabaseAdmin.from('ad_spend_snapshots').upsert(
            {
              tenant_id: connection.tenant_id,
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
        console.error('Erro sincronizando campanha', campaignId, err)
        results.push({ campaignId, kind: 'error', message: (err as Error).message })
      }
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
