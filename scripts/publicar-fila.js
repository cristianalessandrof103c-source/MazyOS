// Orquestrador da fila de posts do Instagram/Facebook.
//
// 1. Lê marketing/conteudo/fila/fila.json
// 2. Acha o próximo post com status "aprovado" cujo horário previsto já chegou
// 3. Copia os PNGs pra um repo Git separado (só de hospedagem de imagem,
//    nunca o site da BK) e dá push, pra gerar URLs públicas via
//    raw.githubusercontent.com
// 4. Chama postar-instagram.js e postar-facebook.js com essas URLs
// 5. Marca o post como "publicado" no fila.json
//
// Uso:
//   node --env-file=.env scripts/publicar-fila.js
//
// Variáveis de ambiente extras (além das do Meta, ver scripts/README.md):
//   MEDIA_REPO_PATH    → caminho local do clone do repo de imagens (ex: bk-instagram-media)
//   MEDIA_REPO_GITHUB  → "usuario/bk-instagram-media" (pra montar a URL raw)
//   MEDIA_REPO_BRANCH  → branch do repo de imagens (default: main)

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILA_PATH = path.join('marketing', 'conteudo', 'fila', 'fila.json');

function lerFila() {
  if (!fs.existsSync(FILA_PATH)) {
    throw new Error(`Não encontrei ${FILA_PATH}. Rode a skill /fila-instagram primeiro.`);
  }
  return JSON.parse(fs.readFileSync(FILA_PATH, 'utf-8'));
}

function salvarFila(fila) {
  fs.writeFileSync(FILA_PATH, JSON.stringify(fila, null, 2));
}

function proximoPostElegivel(fila) {
  const agora = new Date();
  return fila.posts
    .filter((p) => p.status === 'aprovado')
    .filter((p) => new Date(p.horario_previsto) <= agora)
    .sort((a, b) => new Date(a.horario_previsto) - new Date(b.horario_previsto))[0];
}

function publicarImagensNoRepoDeMidia(post) {
  const mediaRepoPath = process.env.MEDIA_REPO_PATH;
  const mediaRepoGithub = process.env.MEDIA_REPO_GITHUB;
  const branch = process.env.MEDIA_REPO_BRANCH || 'main';
  if (!mediaRepoPath || !mediaRepoGithub) {
    throw new Error('Faltando MEDIA_REPO_PATH ou MEDIA_REPO_GITHUB no .env — ver automacao-instagram/setup-repo-imagens.md');
  }

  const origemInstagram = path.join(post.pasta, 'instagram');
  const arquivos = fs.readdirSync(origemInstagram).filter((f) => f.endsWith('.png')).sort();
  if (arquivos.length === 0) {
    throw new Error(`Nenhum PNG encontrado em ${origemInstagram}`);
  }

  const destinoRelativo = path.posix.join(post.id, path.basename(origemInstagram));
  const destinoAbsoluto = path.join(mediaRepoPath, post.id);
  fs.mkdirSync(destinoAbsoluto, { recursive: true });

  const urls = [];
  for (const arquivo of arquivos) {
    fs.copyFileSync(path.join(origemInstagram, arquivo), path.join(destinoAbsoluto, arquivo));
    urls.push(`https://raw.githubusercontent.com/${mediaRepoGithub}/${branch}/${destinoRelativo}/${arquivo}`);
  }

  execFileSync('git', ['add', '.'], { cwd: mediaRepoPath });
  execFileSync('git', ['commit', '-m', `post: ${post.id} — ${post.tema}`], { cwd: mediaRepoPath });
  execFileSync('git', ['push', 'origin', branch], { cwd: mediaRepoPath });

  fs.writeFileSync(path.join(post.pasta, 'urls.json'), JSON.stringify({ images: urls }, null, 2));
}

function rodarScript(nomeScript, pasta) {
  const saida = execFileSync('node', [path.join('scripts', nomeScript), pasta], {
    env: process.env,
    encoding: 'utf-8',
  });
  console.log(saida);
  return saida;
}

async function main() {
  const fila = lerFila();
  const post = proximoPostElegivel(fila);

  if (!post) {
    console.log('Nenhum post aprovado com horário já vencido. Nada pra publicar agora.');
    return;
  }

  console.log(`Publicando ${post.id} — "${post.tema}" (previsto: ${post.horario_previsto})`);

  publicarImagensNoRepoDeMidia(post);
  rodarScript('postar-instagram.js', post.pasta);
  rodarScript('postar-facebook.js', post.pasta);

  post.status = 'publicado';
  post.publicado_em = new Date().toISOString();
  salvarFila(fila);

  console.log(`${post.id} marcado como publicado.`);
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
