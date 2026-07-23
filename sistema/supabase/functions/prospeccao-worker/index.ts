// deno-lint-ignore-file no-explicit-any
// Worker da extração em massa da Prospecção (Fase 8, extensão) — chamado por pg_cron
// (via pg_net) a cada 1min, igual follow-up-dispatcher. Processa um job de
// prospeccao_jobs por vez: consome células da grade a partir de next_cell_index, dentro
// de um orçamento de tempo por execução, até atingir target_count ou esgotar a grade.
//
// Arquivo autocontido de propósito (sem import de _shared/) — mesmo motivo de
// prospeccao-buscar/index.ts: o editor web do Supabase deploya uma function por vez,
// sem suporte a pasta compartilhada entre functions diferentes.
//
// Protegido por header secreto (não JWT — quem chama é pg_net, não um usuário
// autenticado), reaproveitando o mesmo secret já usado por follow-up-dispatcher/
// sync-ad-spend (Vault: dispatcher_secret).

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''
const DISPATCHER_SECRET = Deno.env.get('DISPATCHER_SECRET') ?? ''

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const TIME_BUDGET_MS = 100_000
const MAX_PER_PAGE = 20

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function buscarPlacesNaCelula(textQuery: string, cell: GridCell): Promise<PlaceResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'pt-BR',
      maxResultCount: MAX_PER_PAGE,
      locationBias: {
        circle: { center: { latitude: cell.lat, longitude: cell.lng }, radius: cell.radius_m },
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Places API respondeu ${res.status}`)
  }
  return (data.places ?? []) as PlaceResult[]
}

// Fase 10b: mesma extensão de prospeccao-buscar/index.ts (arquivo duplicado de propósito,
// ver comentário no topo) — aproveita o fetch já feito pra Instagram/LinkedIn pra também
// medir a "nota de qualidade" do site (prospects.quality_score, migration 0017).
type AnaliseSite = {
  instagram_url: string | null
  linkedin_url: string | null
  reachable: boolean
  https: boolean
  mobile_friendly: boolean
}

async function analisarSite(websiteUri: string): Promise<AnaliseSite> {
  const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?!explore\/|accounts\/|p\/|reel\/|stories\/)[a-zA-Z0-9_.]+/i
  const LINKEDIN_REGEX = /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-_%]+/i
  const VIEWPORT_REGEX = /<meta[^>]+name=["']viewport["'][^>]*>/i

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(websiteUri, { signal: controller.signal })
    const html = (await res.text()).slice(0, 500_000)
    return {
      instagram_url: html.match(INSTAGRAM_REGEX)?.[0] ?? null,
      linkedin_url: html.match(LINKEDIN_REGEX)?.[0] ?? null,
      reachable: res.ok,
      https: res.url.startsWith('https://'),
      mobile_friendly: VIEWPORT_REGEX.test(html),
    }
  } catch {
    return { instagram_url: null, linkedin_url: null, reachable: false, https: false, mobile_friendly: false }
  } finally {
    clearTimeout(timeout)
  }
}

async function processarCelula(job: any, cell: GridCell) {
  const places = await buscarPlacesNaCelula(`${job.niche} em ${job.region}`, cell)

  const enriquecidos = await Promise.allSettled(
    places.map(async (place) => {
      const analise = place.websiteUri
        ? await analisarSite(place.websiteUri)
        : { instagram_url: null, linkedin_url: null, reachable: false, https: false, mobile_friendly: false }

      return {
        tenant_id: job.tenant_id,
        job_id: job.id,
        place_id: place.id,
        name: place.displayName?.text ?? '(sem nome)',
        formatted_address: place.formattedAddress ?? null,
        phone_number: place.internationalPhoneNumber ?? null,
        website: place.websiteUri ?? null,
        instagram_url: analise.instagram_url,
        linkedin_url: analise.linkedin_url,
        site_reachable: place.websiteUri ? analise.reachable : null,
        site_https: place.websiteUri ? analise.https : null,
        site_mobile_friendly: place.websiteUri ? analise.mobile_friendly : null,
        google_maps_url: place.googleMapsUri ?? null,
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
        search_niche: job.niche,
        search_region: job.region,
      }
    }),
  )

  const rows = enriquecidos
    .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled')
    .map((r) => r.value)

  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from('prospects').upsert(rows, { onConflict: 'tenant_id,place_id' })
    if (error) throw new Error(`upsert prospects: ${error.message}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  if (!DISPATCHER_SECRET || req.headers.get('x-dispatcher-secret') !== DISPATCHER_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  if (!GOOGLE_PLACES_API_KEY) {
    return jsonResponse({ error: 'Faltando GOOGLE_PLACES_API_KEY nos secrets do projeto.' }, 500)
  }

  const { data: job } = await supabaseAdmin
    .from('prospeccao_jobs')
    .select('*')
    .eq('status', 'processing')
    .order('created_at')
    .limit(1)
    .maybeSingle()

  if (!job) {
    return jsonResponse({ ok: true, message: 'nenhum job pendente' })
  }

  const startedAt = Date.now()
  const cells = (job.grid_cells ?? []) as GridCell[]
  let cellIndex = job.next_cell_index as number
  let foundCount = job.found_count as number

  try {
    while (cellIndex < cells.length && foundCount < job.target_count && Date.now() - startedAt < TIME_BUDGET_MS) {
      await processarCelula(job, cells[cellIndex])
      cellIndex++

      const { count } = await supabaseAdmin
        .from('prospects')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', job.id)
      foundCount = count ?? foundCount

      await supabaseAdmin
        .from('prospeccao_jobs')
        .update({ next_cell_index: cellIndex, found_count: foundCount, updated_at: new Date().toISOString() })
        .eq('id', job.id)
    }

    const done = cellIndex >= cells.length || foundCount >= job.target_count
    if (done) {
      await supabaseAdmin.from('prospeccao_jobs').update({ status: 'done' }).eq('id', job.id)
    }

    return jsonResponse({ ok: true, job_id: job.id, cells_processed: cellIndex, found_count: foundCount, done })
  } catch (err) {
    const message = (err as Error).message
    await supabaseAdmin.from('prospeccao_jobs').update({ status: 'failed', error: message }).eq('id', job.id)
    return jsonResponse({ ok: false, job_id: job.id, error: message }, 500)
  }
})
