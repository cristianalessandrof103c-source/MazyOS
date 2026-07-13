const fetch = require('node-fetch');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphPost(path, params) {
  const url = `${GRAPH_BASE}/${path}`;
  const body = new URLSearchParams(params);
  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code}, subcode ${data.error.error_subcode || '-'})` : `HTTP ${res.status}`;
    throw new Error(`Marketing API ${path} falhou: ${msg}`);
  }
  return data;
}

async function graphGet(path, params) {
  const url = `${GRAPH_BASE}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code}, subcode ${data.error.error_subcode || '-'})` : `HTTP ${res.status}`;
    throw new Error(`Marketing API ${path} falhou: ${msg}`);
  }
  return data;
}

const reaisParaCentavos = (reais) => Math.round(reais * 100);
const centavosParaReais = (centavos) => Number(centavos) / 100;

/** Testa se o token + ad account ID estão válidos. Só leitura. */
async function testarConexao({ adAccountId, token }) {
  return graphGet(`act_${adAccountId}`, {
    fields: 'name,account_status,currency,timezone_name',
    access_token: token,
  });
}

/**
 * Cria uma campanha. Objective para click-to-WhatsApp é OUTCOME_ENGAGEMENT.
 * Sempre cria PAUSED — nunca deixar essa função ativar campanha direto.
 */
async function criarCampanha({ adAccountId, token, nome, objective, specialAdCategories = [] }) {
  const data = await graphPost(`act_${adAccountId}/campaigns`, {
    name: nome,
    objective,
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(specialAdCategories),
    // Orçamento fica no conjunto de anúncios (ad set), não na campanha — por isso false aqui.
    is_adset_budget_sharing_enabled: 'false',
    access_token: token,
  });
  return data.id;
}

/**
 * Cria um conjunto de anúncios (ad set) pra clique-no-WhatsApp.
 * orcamentoDiarioReais é convertido pra centavos automaticamente.
 * Sempre cria PAUSED.
 */
async function criarConjuntoAnuncios({
  adAccountId,
  token,
  nome,
  campaignId,
  orcamentoDiarioReais,
  optimizationGoal,
  pageId,
  whatsappPhoneNumber,
  targeting,
  billingEvent = 'IMPRESSIONS',
  bidStrategy = 'LOWEST_COST_WITHOUT_CAP',
}) {
  const promotedObject = { page_id: pageId };
  if (whatsappPhoneNumber) promotedObject.whatsapp_phone_number = whatsappPhoneNumber;

  const data = await graphPost(`act_${adAccountId}/adsets`, {
    name: nome,
    campaign_id: campaignId,
    daily_budget: String(reaisParaCentavos(orcamentoDiarioReais)),
    billing_event: billingEvent,
    optimization_goal: optimizationGoal,
    bid_strategy: bidStrategy,
    destination_type: 'WHATSAPP',
    promoted_object: JSON.stringify(promotedObject),
    targeting: JSON.stringify(targeting),
    status: 'PAUSED',
    access_token: token,
  });
  return data.id;
}

/**
 * Cria o criativo do anúncio de clique-no-WhatsApp.
 * link deve ser sempre "https://api.whatsapp.com/send" (fixo, exigido pela Meta).
 */
async function criarCreative({
  adAccountId,
  token,
  pageId,
  headline,
  mensagem,
  descricao,
  imageHash,
  mensagemBoasVindas,
}) {
  const linkData = {
    name: headline,
    message: mensagem,
    description: descricao,
    link: 'https://api.whatsapp.com/send',
    call_to_action: {
      type: 'WHATSAPP_MESSAGE',
      value: { app_destination: 'WHATSAPP' },
    },
  };
  if (imageHash) linkData.image_hash = imageHash;

  const objectStorySpec = { page_id: pageId, link_data: linkData };
  if (mensagemBoasVindas) objectStorySpec.page_welcome_message = mensagemBoasVindas;

  const data = await graphPost(`act_${adAccountId}/adcreatives`, {
    object_story_spec: JSON.stringify(objectStorySpec),
    access_token: token,
  });
  return data.id;
}

/** Sobe uma imagem hospedada (por URL) pra conta de anúncio e devolve o image_hash. */
async function uploadImagemPorUrl({ adAccountId, token, imageUrl }) {
  const data = await graphPost(`act_${adAccountId}/adimages`, {
    url: imageUrl,
    access_token: token,
  });
  const key = Object.keys(data.images)[0];
  return data.images[key].hash;
}

/** Sobe uma imagem local (PNG/JPG gerado pelo /carrossel, por exemplo) e devolve o image_hash. */
async function uploadImagemPorArquivo({ adAccountId, token, filePath }) {
  const fs = require('fs');
  const nodePath = require('path');
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('access_token', token);
  form.append('source', new Blob([buffer]), nodePath.basename(filePath));

  // node-fetch v2 (importado no topo do arquivo) não lida com FormData/Blob nativos —
  // usa o fetch nativo do Node (18+) só aqui, pra multipart funcionar direito.
  const res = await globalThis.fetch(`${GRAPH_BASE}/act_${adAccountId}/adimages`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Marketing API act_${adAccountId}/adimages falhou: ${msg}`);
  }
  const key = Object.keys(data.images)[0];
  return data.images[key].hash;
}

/** Cria o anúncio final ligando conjunto + criativo. Sempre PAUSED. */
async function criarAnuncio({ adAccountId, token, nome, adsetId, creativeId }) {
  const data = await graphPost(`act_${adAccountId}/ads`, {
    name: nome,
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED',
    access_token: token,
  });
  return data.id;
}

async function ativarConjunto({ adsetId, token }) {
  return graphPost(adsetId, { status: 'ACTIVE', access_token: token });
}

async function pausarConjunto({ adsetId, token }) {
  return graphPost(adsetId, { status: 'PAUSED', access_token: token });
}

async function atualizarOrcamentoConjunto({ adsetId, token, novoOrcamentoReais }) {
  return graphPost(adsetId, {
    daily_budget: String(reaisParaCentavos(novoOrcamentoReais)),
    access_token: token,
  });
}

/** Lista os ad sets (id, nome, status, orçamento) de uma campanha. */
async function listarConjuntosDaCampanha({ campaignId, token }) {
  const data = await graphGet(`${campaignId}/adsets`, {
    fields: 'id,name,status,daily_budget,effective_status',
    access_token: token,
  });
  return data.data.map((c) => ({ ...c, daily_budget: centavosParaReais(c.daily_budget) }));
}

/**
 * Busca insights (spend, resultados, cpa, frequência) de um ad set num período.
 * datePreset: 'today' | 'yesterday' | 'last_3d' | 'last_7d' etc.
 */
async function buscarInsights({ objectId, token, datePreset = 'today' }) {
  const data = await graphGet(`${objectId}/insights`, {
    fields: 'spend,actions,cost_per_action_type,frequency,reach,impressions',
    date_preset: datePreset,
    access_token: token,
  });
  return data.data[0] || null;
}

/** Busca insights dia a dia dos últimos `dias`, mais recente por último. */
async function buscarInsightsDiarios({ objectId, token, dias = 7 }) {
  const data = await graphGet(`${objectId}/insights`, {
    fields: 'spend,actions,cost_per_action_type,frequency',
    date_preset: `last_${dias}d`,
    time_increment: '1',
    access_token: token,
  });
  return data.data || [];
}

/** Extrai a contagem de um action_type específico do retorno de buscarInsights. */
function extrairResultado(insights, actionType) {
  if (!insights || !insights.actions) return 0;
  const item = insights.actions.find((a) => a.action_type === actionType);
  return item ? Number(item.value) : 0;
}

/** Extrai o custo por resultado de um action_type específico. */
function extrairCustoPorResultado(insights, actionType) {
  if (!insights || !insights.cost_per_action_type) return null;
  const item = insights.cost_per_action_type.find((a) => a.action_type === actionType);
  return item ? Number(item.value) : null;
}

module.exports = {
  graphGet,
  graphPost,
  reaisParaCentavos,
  centavosParaReais,
  testarConexao,
  criarCampanha,
  criarConjuntoAnuncios,
  criarCreative,
  uploadImagemPorUrl,
  uploadImagemPorArquivo,
  criarAnuncio,
  ativarConjunto,
  pausarConjunto,
  atualizarOrcamentoConjunto,
  listarConjuntosDaCampanha,
  buscarInsights,
  buscarInsightsDiarios,
  extrairResultado,
  extrairCustoPorResultado,
};

// Uso direto: node --env-file=.env scripts/lib/meta-ads-api.js --teste
if (require.main === module) {
  if (process.argv.includes('--teste')) {
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const token = process.env.META_ADS_ACCESS_TOKEN;
    if (!adAccountId || !token) {
      console.error('Faltam META_AD_ACCOUNT_ID ou META_ADS_ACCESS_TOKEN no .env');
      process.exit(1);
    }
    testarConexao({ adAccountId, token })
      .then((data) => console.log('Conexão OK:', data))
      .catch((err) => {
        console.error('Falha na conexão:', err.message);
        process.exit(1);
      });
  }
}
