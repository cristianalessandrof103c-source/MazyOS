const fetch = require('node-fetch');

const GRAPH_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphPost(path, params) {
  const url = `${GRAPH_BASE}/${path}`;
  const body = new URLSearchParams(params);
  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Graph API ${path} falhou: ${msg}`);
  }
  return data;
}

async function graphGet(path, params) {
  const url = `${GRAPH_BASE}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Graph API ${path} falhou: ${msg}`);
  }
  return data;
}

/** Cria um container de mídia (item avulso ou item de carrossel). Retorna o creation_id. */
async function criarContainerImagem({ igUserId, token, imageUrl, isCarouselItem, caption }) {
  const params = { image_url: imageUrl, access_token: token };
  if (isCarouselItem) params.is_carousel_item = 'true';
  if (caption) params.caption = caption;
  const data = await graphPost(`${igUserId}/media`, params);
  return data.id;
}

/** Cria o container pai de carrossel a partir dos creation_ids dos filhos. */
async function criarContainerCarrossel({ igUserId, token, childIds, caption }) {
  const data = await graphPost(`${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: caption || '',
    access_token: token,
  });
  return data.id;
}

/** Publica um container já criado (avulso ou carrossel). Retorna o post id publicado. */
async function publicarContainer({ igUserId, token, creationId }) {
  const data = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  return data.id;
}

/** Sobe uma foto pra Página do Facebook sem publicar ainda (published=false), pra usar em multi-foto. */
async function uploadFotoFacebook({ pageId, token, imageUrl }) {
  const data = await graphPost(`${pageId}/photos`, {
    url: imageUrl,
    published: 'false',
    access_token: token,
  });
  return data.id; // este id vira o media_fbid do post
}

/** Publica o post na Página com 1+ fotos já enviadas (attached_media). */
async function publicarPostFacebook({ pageId, token, message, mediaFbids }) {
  const params = { message: message || '', access_token: token };
  mediaFbids.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const data = await graphPost(`${pageId}/feed`, params);
  return data.id;
}

module.exports = {
  graphGet,
  graphPost,
  criarContainerImagem,
  criarContainerCarrossel,
  publicarContainer,
  uploadFotoFacebook,
  publicarPostFacebook,
};
