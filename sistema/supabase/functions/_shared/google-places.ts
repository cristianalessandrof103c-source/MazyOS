// Cliente compartilhado da Google Places API (New) + Geocoding API, usado tanto pela
// busca síncrona (prospeccao-buscar) quanto pelo worker de extração em massa
// (prospeccao-worker). Também tem o gerador de grade de círculos usado pra subdividir
// uma região grande em várias sub-buscas (a Places API só devolve ~60 resultados por
// busca de texto simples).

export const MAX_PER_PAGE = 20
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

export type PlaceResult = {
  id: string
  displayName?: { text?: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  location?: { latitude?: number; longitude?: number }
}

export type GridCell = { lat: number; lng: number; radius_m: number }

export type LocationBias = { lat: number; lng: number; radius_m: number }

async function chamarSearchText(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ places: PlaceResult[]; nextPageToken?: string }> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
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

/** Busca até `targetCount` resultados (paginando em blocos de 20, até 3 páginas — teto real da API). */
export async function buscarPlaces(
  apiKey: string,
  textQuery: string,
  targetCount: number,
  locationBias?: LocationBias,
): Promise<PlaceResult[]> {
  const results: PlaceResult[] = []
  let pageToken: string | undefined
  const maxPages = 3

  for (let page = 0; page < maxPages && results.length < targetCount; page++) {
    const body: Record<string, unknown> = {
      textQuery,
      languageCode: 'pt-BR',
      maxResultCount: MAX_PER_PAGE,
    }
    if (locationBias) {
      body.locationBias = {
        circle: {
          center: { latitude: locationBias.lat, longitude: locationBias.lng },
          radius: locationBias.radius_m,
        },
      }
    }
    if (pageToken) body.pageToken = pageToken

    const { places, nextPageToken } = await chamarSearchText(apiKey, body)
    results.push(...places)

    if (!nextPageToken) break
    pageToken = nextPageToken
    // o token só fica válido depois de um pequeno delay — exigência conhecida do Google
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  return results.slice(0, targetCount)
}

export async function extrairRedesSociais(
  websiteUri: string,
  timeoutMs = 6000,
  maxChars = 500_000,
): Promise<{ instagram_url: string | null; linkedin_url: string | null }> {
  const INSTAGRAM_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(?!explore\/|accounts\/|p\/|reel\/|stories\/)[a-zA-Z0-9_.]+/i
  const LINKEDIN_REGEX = /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9\-_%]+/i

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(websiteUri, { signal: controller.signal })
    const html = (await res.text()).slice(0, maxChars)
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

/** Geocodifica um texto livre de região (ex: "Curitiba") pro bounding box (viewport) dela. */
export async function geocodificarRegiao(
  apiKey: string,
  region: string,
): Promise<{ north: number; south: number; east: number; west: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(region)}&key=${apiKey}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.[0]) {
    return null
  }
  const viewport = data.results[0].geometry?.viewport
  if (!viewport) return null
  return {
    north: viewport.northeast.lat,
    south: viewport.southwest.lat,
    east: viewport.northeast.lng,
    west: viewport.southwest.lng,
  }
}

/** Gera uma grade de círculos cobrindo o bounding box, com no máximo `maxCells` células. */
export function gerarGrade(
  viewport: { north: number; south: number; east: number; west: number },
  maxCells: number,
): GridCell[] {
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
