// Worker local do hub de integrações (Fase 5). Processa os jobs "carrossel" pendentes
// em integration_hub_jobs: roda o render.js da pasta (Playwright, sem alteração), sobe
// os PNGs pro bucket hub-media do Supabase Storage e marca o job como concluído.
//
// Rodado manualmente, sempre que quiser processar a fila (não é um daemon):
//   node --env-file=.env scripts/hub-worker.js
//
// Requer no .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ver scripts/README.md).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const ROOT_NODE_MODULES = path.resolve(__dirname, '..', 'node_modules');

async function marcarStatus(jobId, fields) {
  const { error } = await supabase.from('integration_hub_jobs').update(fields).eq('id', jobId);
  if (error) throw new Error(`Falha ao atualizar job ${jobId}: ${error.message}`);
}

async function rodarRender(pastaAbsoluta) {
  const renderPath = path.join(pastaAbsoluta, 'render.js');
  if (!fs.existsSync(renderPath) || !fs.existsSync(path.join(pastaAbsoluta, 'carrossel.html'))) {
    throw new Error(`Pasta ${pastaAbsoluta} não tem carrossel.html + render.js`);
  }
  execFileSync('node', [renderPath], {
    env: { ...process.env, NODE_PATH: ROOT_NODE_MODULES },
    stdio: 'pipe',
  });
}

async function subirImagens(jobId, pastaAbsoluta) {
  const outDir = path.join(pastaAbsoluta, 'instagram');
  const arquivos = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith('.png'))
    .sort();
  if (arquivos.length === 0) {
    throw new Error(`Nenhum PNG encontrado em ${outDir} depois do render`);
  }

  const urls = [];
  for (const arquivo of arquivos) {
    const objectPath = `${jobId}/${arquivo}`;
    const conteudo = fs.readFileSync(path.join(outDir, arquivo));
    const { error } = await supabase.storage
      .from('hub-media')
      .upload(objectPath, conteudo, { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`Falha subindo ${arquivo}: ${error.message}`);
    const { data } = supabase.storage.from('hub-media').getPublicUrl(objectPath);
    urls.push(data.publicUrl);
  }
  return urls;
}

function lerLegenda(pastaAbsoluta) {
  const legendaPath = path.join(pastaAbsoluta, 'legenda.md');
  return fs.existsSync(legendaPath) ? fs.readFileSync(legendaPath, 'utf-8').trim() : '';
}

async function processarJob(job) {
  const pasta = job.params?.pasta;
  if (!pasta) throw new Error('Job sem params.pasta');
  const pastaAbsoluta = path.resolve(__dirname, '..', pasta);

  console.log(`[${job.id}] renderizando ${pasta}...`);
  await rodarRender(pastaAbsoluta);

  console.log(`[${job.id}] subindo imagens pro Storage...`);
  const images = await subirImagens(job.id, pastaAbsoluta);
  const caption = lerLegenda(pastaAbsoluta);

  await marcarStatus(job.id, { status: 'done', result: { images, caption } });
  console.log(`[${job.id}] concluído — ${images.length} imagem(ns).`);
}

async function main() {
  const { data: jobs, error } = await supabase
    .from('integration_hub_jobs')
    .select('*')
    .eq('tool', 'carrossel')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Falha buscando jobs pendentes:', error.message);
    process.exit(1);
  }

  if (!jobs || jobs.length === 0) {
    console.log('Nenhum job de carrossel pendente.');
    return;
  }

  for (const job of jobs) {
    await marcarStatus(job.id, { status: 'processing' });
    try {
      await processarJob(job);
    } catch (err) {
      console.error(`[${job.id}] falhou:`, err.message);
      await marcarStatus(job.id, { status: 'failed', error: err.message });
    }
  }
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
