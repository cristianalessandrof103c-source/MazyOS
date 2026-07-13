// Publica o mesmo conteúdo (foto única ou múltiplas fotos) na Página do Facebook.
//
// Uso:
//   node --env-file=.env scripts/postar-facebook.js <pasta-do-post>
//
// A <pasta-do-post> precisa conter:
//   - urls.json   → { "images": ["https://.../slide-01.png", ...] } (URLs públicas)
//   - legenda.md  → texto da legenda (opcional)

const fs = require('fs');
const path = require('path');
const { uploadFotoFacebook, publicarPostFacebook } = require('./lib/meta-graph');

async function main() {
  const pasta = process.argv[2];
  if (!pasta) {
    console.error('Uso: node scripts/postar-facebook.js <pasta-do-post>');
    process.exit(1);
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  if (!token || !pageId) {
    console.error('Faltando META_PAGE_ACCESS_TOKEN ou META_PAGE_ID no .env');
    process.exit(1);
  }

  const urlsPath = path.join(pasta, 'urls.json');
  if (!fs.existsSync(urlsPath)) {
    console.error(`Não encontrei ${urlsPath}. Rode a publicação das imagens primeiro (publicar-fila.js).`);
    process.exit(1);
  }
  const { images } = JSON.parse(fs.readFileSync(urlsPath, 'utf-8'));
  if (!images || images.length === 0) {
    console.error('urls.json não tem nenhuma imagem.');
    process.exit(1);
  }

  const legendaPath = path.join(pasta, 'legenda.md');
  const message = fs.existsSync(legendaPath) ? fs.readFileSync(legendaPath, 'utf-8').trim() : '';

  console.log(`Enviando ${images.length} foto(s) pra Página do Facebook...`);

  const mediaFbids = [];
  for (const imageUrl of images) {
    const id = await uploadFotoFacebook({ pageId, token, imageUrl });
    mediaFbids.push(id);
  }

  const postId = await publicarPostFacebook({ pageId, token, message, mediaFbids });
  console.log(`Publicado no Facebook. post id: ${postId}`);
  console.log(`https://www.facebook.com/${postId}`);
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
