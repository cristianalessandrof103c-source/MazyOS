// Porte 1:1 de scripts/lib/meta-graph.js pra Deno (fetch nativo em vez de node-fetch).
// Usado pelo hub-instagram-publish (Fase 5) pra publicar carrossel/imagem única no Instagram.

const GRAPH_VERSION = 'v19.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

async function graphPost(path: string, params: Record<string, string>) {
  const url = `${GRAPH_BASE}/${path}`
  const body = new URLSearchParams(params)
  const res = await fetch(url, { method: 'POST', body })
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`
    throw new Error(`Graph API ${path} falhou: ${msg}`)
  }
  return data
}

export async function graphGet(path: string, params: Record<string, string>) {
  const url = `${GRAPH_BASE}/${path}?${new URLSearchParams(params)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`
    throw new Error(`Graph API ${path} falhou: ${msg}`)
  }
  return data
}

/** Cria um container de mídia (item avulso ou item de carrossel). Retorna o creation_id. */
export async function criarContainerImagem(args: {
  igUserId: string
  token: string
  imageUrl: string
  isCarouselItem?: boolean
  caption?: string
}): Promise<string> {
  const { igUserId, token, imageUrl, isCarouselItem, caption } = args
  const params: Record<string, string> = { image_url: imageUrl, access_token: token }
  if (isCarouselItem) params.is_carousel_item = 'true'
  if (caption) params.caption = caption
  const data = await graphPost(`${igUserId}/media`, params)
  return data.id
}

/** Cria o container pai de carrossel a partir dos creation_ids dos filhos. */
export async function criarContainerCarrossel(args: {
  igUserId: string
  token: string
  childIds: string[]
  caption?: string
}): Promise<string> {
  const { igUserId, token, childIds, caption } = args
  const data = await graphPost(`${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption || '',
    access_token: token,
  })
  return data.id
}

/** Publica um container já criado (avulso ou carrossel). Retorna o post id publicado. */
export async function publicarContainer(args: {
  igUserId: string
  token: string
  creationId: string
}): Promise<string> {
  const { igUserId, token, creationId } = args
  const data = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  })
  return data.id
}
