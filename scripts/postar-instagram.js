// Publica um carrossel (ou foto única) no Instagram via Meta Graph API.
//
// Uso:
//   node --env-file=.env scripts/postar-instagram.js <pasta-do-post>
//
// A <pasta-do-post> precisa conter:
//   - urls.json   → { "images": ["https://.../slide-01.png", ...] } (URLs públicas)
//   - legenda.md  → texto da legenda (opcional)

const fs = require('fs');
const path = require('path');
const {
  criarContainerImagem,
  criarContainerCarrossel,
  publicarContainer,
  graphGet,
} = require('./lib/meta-graph');

async function main() {
  const pasta = process.argv[2];
  if (!pasta) {
    console.error('Uso: node scripts/postar-instagram.js <pasta-do-post>');
    process.exit(1);
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_USER_ID;
  if (!token || !igUserId) {
    console.error('Faltando META_PAGE_ACCESS_TOKEN ou META_IG_USER_ID no .env');
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
  const caption = fs.existsSync(legendaPath) ? fs.readFileSync(legendaPath, 'utf-8').trim() : '';

  console.log(`Publicando ${images.length} imagem(ns) no Instagram...`);

  let creationId;
  if (images.length === 1) {
    creationId = await criarContainerImagem({ igUserId, token, imageUrl: images[0], caption });
  } else {
    const childIds = [];
    for (const imageUrl of images) {
      const childId = await criarContainerImagem({ igUserId, token, imageUrl, isCarouselItem: true });
      childIds.push(childId);
    }
    creationId = await criarContainerCarrossel({ igUserId, token, childIds, caption });
  }

  const postId = await publicarContainer({ igUserId, token, creationId });
  let permalink = null;
  try {
    const info = await graphGet(postId, { fields: 'permalink', access_token: token });
    permalink = info.permalink;
  } catch (err) {
    console.warn('Publicado, mas não consegui buscar o permalink:', err.message);
  }
  console.log(`Publicado no Instagram. post id: ${postId}`);
  if (permalink) console.log(permalink);
}

main().catch((err) => {
  console.error('Falhou:', err.message);
  process.exit(1);
});
