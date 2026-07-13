# Setup — repositório separado só pra hospedar as imagens

O Instagram e o Facebook só aceitam publicar foto a partir de uma URL
pública. Como o site `saidas/site/` não pode ser usado pra isso, as
imagens dos carrosséis moram num repositório GitHub à parte — separado
também do `mazzeoia/MazyOS` (que é o template que seus clientes clonam).

Esse repo não tem nada além de PNG. Não é o site, não é o produto
MazyOS, não tem segredo nenhum dentro dele.

## Passo 1 — Criar o repositório no GitHub

1. Acesse github.com/new
2. Nome sugerido: `bk-instagram-media`
3. Visibilidade: **Público** (precisa ser público pra
   `raw.githubusercontent.com` servir as imagens sem autenticação)
4. Não adicionar README/gitignore — deixar vazio

## Passo 2 — Clonar localmente

```bash
git clone https://github.com/<seu-usuario>/bk-instagram-media.git
```

Anote o caminho onde isso foi clonado — vai virar `MEDIA_REPO_PATH`.

## Passo 3 — Preencher o `.env` (mesmo arquivo do setup do Meta)

```bash
MEDIA_REPO_PATH=/caminho/completo/pra/bk-instagram-media
MEDIA_REPO_GITHUB=<seu-usuario>/bk-instagram-media
MEDIA_REPO_BRANCH=main
```

## Como funciona na prática

Quando `scripts/publicar-fila.js` roda:

1. Copia os PNGs do post aprovado pra dentro desse repo clonado
   (`<MEDIA_REPO_PATH>/<id-do-post>/instagram/slide-XX.png`)
2. Faz `git add` + `commit` + `push` — nesse repo separado, nunca no
   MazyOS nem no site
3. Monta a URL pública de cada imagem via
   `raw.githubusercontent.com/<usuario>/bk-instagram-media/main/...`
4. Usa essas URLs pra publicar no Instagram e no Facebook

O histórico desse repo vira, sem querer, um arquivo de tudo que já foi
postado — o que é útil, mas se algum dia quiser limpar, dá pra
`git filter-repo` ou simplesmente recriar o repo do zero.
