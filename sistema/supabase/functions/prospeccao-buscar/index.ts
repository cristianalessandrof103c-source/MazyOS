// deno-lint-ignore-file no-explicit-any
// Prospecção (Fase 8) — busca prospects por nicho+região via Google Places API (New) e,
// pra quem tiver site, tenta extrair Instagram/LinkedIn do próprio HTML público do
// prospect (best-effort, nunca bloqueia o resultado da busca).
//
// target_count <= SYNC_MAX_RESULTS: busca síncrona (com paginação), responde na hora.
// target_count > SYNC_MAX_RESULTS: a Places API não devolve tanto resultado numa busca
// só — geocodifica a região, gera uma grade de sub-áreas e cria um job em
// prospeccao_jobs, processado aos poucos pelo prospeccao-worker (chamado por pg_cron).
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke), mesmo padrão de
// hub-instagram-publish/invite-member: mantém verificação de JWT padrão (deploy sem
// --no-verify-jwt).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { buscarPlaces, extrairRedesSociais, geocodificarRegiao, gerarGrade } from '../_shared/google-places.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const SYNC_MAX_RESULTS = 60
const MAX_GRID_CELLS = 60
const RESULTS_PER_CELL_ESTIMATE = 15 // estimativa conservadora de resultados únicos por célula, pra dimensionar a grade

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

async function buscaSincrona(tenantId: string, niche: string, region: string, targetCount: number) {
  const places = await buscarPlaces(GOOGLE_PLACES_API_KEY, `${niche} em ${region}`, targetCount)

  const enriquecidos = await Promise.allSettled(
    places.map(async (place) => {
      const redes = place.websiteUri
        ? await extrairRedesSociais(place.websiteUri)
        : { instagram_url: null, linkedin_url: null }

      return {
        tenant_id: tenantId,
        place_id: place.id,
        name: place.displayName?.text ?? '(sem nome)',
        formatted_address: place.formattedAddress ?? null,
        phone_number: place.internationalPhoneNumber ?? null,
        website: place.websiteUri ?? null,
        instagram_url: redes.instagram_url,
        linkedin_url: redes.linkedin_url,
        google_maps_url: place.googleMapsUri ?? null,
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
        search_niche: niche,
        search_region: region,
      }
    }),
  )

  const rows = enriquecidos
    .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled')
    .map((r) => r.value)

  if (rows.length === 0) {
    return jsonResponse({ ok: true, mode: 'sync', count: 0, prospects: [] })
  }

  const { data: prospects, error: upsertError } = await supabaseAdmin
    .from('prospects')
    .upsert(rows, { onConflict: 'tenant_id,place_id' })
    .select()

  if (upsertError) {
    return jsonResponse({ error: `Falha ao salvar prospects: ${upsertError.message}` }, 500)
  }

  return jsonResponse({ ok: true, mode: 'sync', count: prospects?.length ?? 0, prospects })
}

async function criarJobDeLote(tenantId: string, niche: string, region: string, targetCount: number) {
  const viewport = await geocodificarRegiao(GOOGLE_PLACES_API_KEY, region)
  if (!viewport) {
    return jsonResponse({ error: `Não consegui geocodificar a região "${region}".` }, 400)
  }

  const cellCount = Math.min(MAX_GRID_CELLS, Math.max(1, Math.ceil(targetCount / RESULTS_PER_CELL_ESTIMATE)))
  const gridCells = gerarGrade(viewport, cellCount)

  const { data: job, error: insertError } = await supabaseAdmin
    .from('prospeccao_jobs')
    .insert({
      tenant_id: tenantId,
      niche,
      region,
      target_count: targetCount,
      grid_cells: gridCells,
      status: 'processing',
    })
    .select()
    .single()

  if (insertError) {
    return jsonResponse({ error: `Falha ao criar job de extração: ${insertError.message}` }, 500)
  }

  return jsonResponse({ ok: true, mode: 'job', job_id: job.id })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!GOOGLE_PLACES_API_KEY) {
    return jsonResponse(
      { error: 'Faltando GOOGLE_PLACES_API_KEY nos secrets da função (npx supabase secrets set).' },
      500,
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido' }, 400)
  }

  const tenantId = body.tenant_id as string | undefined
  const niche = (body.niche as string | undefined)?.trim()
  const region = (body.region as string | undefined)?.trim()
  const targetCount = Math.min(1000, Math.max(1, Number(body.target_count) || 20))

  if (!tenantId || !niche || !region) {
    return jsonResponse({ error: 'Esperado { tenant_id, niche, region }' }, 400)
  }

  // Client com o JWT de quem chamou: só pra checar que o usuário pertence ao tenant. A
  // escrita em si sempre passa por supabaseAdmin (service role), já que prospects/
  // prospeccao_jobs não têm policy de insert liberada pro client.
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
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', caller.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!membership) {
      return jsonResponse({ error: 'Sem permissão pra esse tenant.' }, 403)
    }
  }

  try {
    if (targetCount <= SYNC_MAX_RESULTS) {
      return await buscaSincrona(tenantId, niche, region, targetCount)
    }
    return await criarJobDeLote(tenantId, niche, region, targetCount)
  } catch (err) {
    return jsonResponse({ error: `Falha ao consultar a Google Places API: ${(err as Error).message}` }, 502)
  }
})
