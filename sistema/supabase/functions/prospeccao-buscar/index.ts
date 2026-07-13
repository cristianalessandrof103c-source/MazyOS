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
// Arquivo autocontido de propósito (sem import de _shared/) — deployada pelo editor web
// do Supabase, que lida com uma function por vez, não com pastas compartilhadas entre
// functions. prospeccao-worker/index.ts duplica esse mesmo bloco da Places API.
//
// Chamada direto pelo dashboard autenticado (supabase.functions.invoke), mesmo padrão de
// hub-instagram-publish/invite-member: mantém verificação de JWT padrão (deploy sem
// --no-verify-jwt).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const SYNC_MAX_RESULTS = 60
const MAX_GRID_CELLS = 60
const RESULTS_PER_CELL_ESTIMATE = 15 // estimativa conservadora de resultados únicos por célula, pra dimensionar a grade
const MAX_PER_PAGE = 20
const EARTH_METERS_PER_DEGREE_LAT = 111_320

const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.location',
  'places.businessStatus',
  'nextPageToken',
].join(',')

type PlaceResult = {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  location?: { latitude?: number; longitude?: number }
}

type GridCell = { lat: number; lng: number; radius_m: number }
type Viewport = { north: number; south: number; east: number; west: number }

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

async function chamarSearchText(body: Record<string, unknown>): Promise<{ places: PlaceResult[]; nextPageToken?: string }> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Places API respondeu ${res.status}`)
  }
  return { places: (data.places ?? []) as PlaceResult[], nextPageToken: data.nextPageToken }
}

async function buscarPlaces(textQuery: string, targetCount: number): Promise<PlaceResult[]> {
  const results: PlaceResult[] = []
  let pageToken: string | undefined
  const maxPages = 3

  for (let page = 0; page < maxPages && results.length < targetCount; page++) {
    const body: Record<string, unknown> = { textQuery, languageCode: 'pt-BR', maxResultCount: MAX_PER_PAGE }
    if (pageToken) body.pageToken = pageToken

    const { places, nextPageToken } = await chamarSearchText(body)
    results.push(...places)

    if (!nextPageToken) break
    pageToken = nextPageToken
    // o token só fica válido depois de um pequeno delay — exigência conhecida do Google
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  return results.slice(0, targetCount)
}

async function extrairRedesSociais(websiteUri: string): Promise<{ instagram_url: string | null; linkedin_url: string | null }> {
  const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?!explore\/|accounts\/|p\/|reel\/|stories\/)[a-zA-Z0-9_.]+/i
  const LINKEDIN_REGEX = /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-_%]+/i

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(websiteUri, { signal: controller.signal })
    const html = (await res.text()).slice(0, 500_000)
    return {
      instagram_url: html.match(INSTAGRAM_REGEX)?.[0] ?? null,
      linkedin_url: html.match(LINKEDIN_REGEX)?.[0] ?? null,
    }
  } catch {
    return { instagram_url: null, linkedin_url: null }
  } finally {
    clearTimeout(timeout)
  }
}

async function geocodificarRegiao(region: string): Promise<Viewport | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(region)}&key=${GOOGLE_PLACES_API_KEY}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.[0]) return null
  const viewport = data.results[0].geometry?.viewport
  if (!viewport) return null
  return {
    north: viewport.northeast.lat,
    south: viewport.southwest.lat,
    east: viewport.northeast.lng,
    west: viewport.southwest.lng,
  }
}

function gerarGrade(viewport: Viewport, maxCells: number): GridCell[] {
  const centerLat = (viewport.north + viewport.south) / 2
  const heightMeters = Math.max(1, (viewport.north - viewport.south) * EARTH_METERS_PER_DEGREE_LAT)
  const metersPerDegreeLng = EARTH_METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180)
  const widthMeters = Math.max(1, (viewport.east - viewport.west) * metersPerDegreeLng)

  const aspectRatio = widthMeters / heightMeters
  let rows = Math.max(1, Math.round(Math.sqrt(maxCells / aspectRatio)))
  let cols = Math.max(1, Math.round(maxCells / rows))
  while (rows * cols > maxCells && (rows > 1 || cols > 1)) {
    if (rows >= cols && rows > 1) rows--
    else if (cols > 1) cols--
    else break
  }

  const cellHeightMeters = heightMeters / rows
  const cellWidthMeters = widthMeters / cols
  const radiusM = Math.max(1000, Math.min(50_000, Math.ceil((Math.max(cellWidthMeters, cellHeightMeters) / 2) * 1.2)))

  const cells: GridCell[] = []
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const lat = viewport.south + ((i + 0.5) * heightMeters) / rows / EARTH_METERS_PER_DEGREE_LAT
      const lng = viewport.west + ((j + 0.5) * widthMeters) / cols / metersPerDegreeLng
      cells.push({ lat, lng, radius_m: radiusM })
    }
  }
  return cells
}

async function buscaSincrona(tenantId: string, niche: string, region: string, targetCount: number) {
  const places = await buscarPlaces(`${niche} em ${region}`, targetCount)

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
  const viewport = await geocodificarRegiao(region)
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
