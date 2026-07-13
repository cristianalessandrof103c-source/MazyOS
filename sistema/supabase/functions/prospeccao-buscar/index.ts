// deno-lint-ignore-file no-explicit-any
// Prospecção (Fase 8) — busca prospects por nicho+região via Google Places API (New) e,
// pra quem tiver site, tenta extrair Instagram/LinkedIn do próprio HTML público do
// prospect (best-effort, nunca bloqueia o resultado da busca).
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

const MAX_RESULTS = 20
const SITE_FETCH_TIMEOUT_MS = 6000
const SITE_FETCH_MAX_CHARS = 500_000

const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.location',
  'places.businessStatus',
].join(',')

const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?!explore\/|accounts\/|p\/|reel\/|stories\/)[a-zA-Z0-9_.]+/i
const LINKEDIN_REGEX = /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-_%]+/i

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

type PlaceResult = {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  location?: { latitude?: number; longitude?: number }
}

async function buscarPlaces(textQuery: string, maxResultCount: number): Promise<PlaceResult[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, languageCode: 'pt-BR', maxResultCount }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Places API respondeu ${res.status}`)
  }
  return (data.places ?? []) as PlaceResult[]
}

async function extrairRedesSociais(websiteUri: string): Promise<{ instagram_url: string | null; linkedin_url: string | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SITE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(websiteUri, { signal: controller.signal })
    const html = (await res.text()).slice(0, SITE_FETCH_MAX_CHARS)
    return {
      instagram_url: html.match(INSTAGRAM_REGEX)?.[0] ?? null,
      linkedin_url: html.match(LINKEDIN_REGEX)?.[0] ?? null,
    }
  } catch {
    // site fora do ar, timeout, HTML sem match etc — enriquecimento é best-effort
    return { instagram_url: null, linkedin_url: null }
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
  const maxResults = Math.min(Number(body.max_results) || MAX_RESULTS, MAX_RESULTS)

  if (!tenantId || !niche || !region) {
    return jsonResponse({ error: 'Esperado { tenant_id, niche, region }' }, 400)
  }

  // Client com o JWT de quem chamou: só pra checar que o usuário pertence ao tenant. A
  // escrita em si sempre passa por supabaseAdmin (service role), já que prospects não
  // tem policy de insert liberada pro client.
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

  let places: PlaceResult[]
  try {
    places = await buscarPlaces(`${niche} em ${region}`, maxResults)
  } catch (err) {
    return jsonResponse({ error: `Falha ao consultar a Google Places API: ${(err as Error).message}` }, 502)
  }

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
    return jsonResponse({ ok: true, count: 0, prospects: [] })
  }

  const { data: prospects, error: upsertError } = await supabaseAdmin
    .from('prospects')
    .upsert(rows, { onConflict: 'tenant_id,place_id' })
    .select()

  if (upsertError) {
    return jsonResponse({ error: `Falha ao salvar prospects: ${upsertError.message}` }, 500)
  }

  return jsonResponse({ ok: true, count: prospects?.length ?? 0, prospects })
})
