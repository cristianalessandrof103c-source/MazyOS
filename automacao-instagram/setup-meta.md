# Setup — conectar o Instagram da BK ao Meta Graph API

Guia de uma vez só. Depois de feito, a automação usa essas credenciais
sozinha — você não precisa repetir isso.

## Pré-requisitos

- A conta do Instagram da clínica precisa ser **conta Business** (ou
  Creator). Se ainda for pessoal: Instagram → Configurações → Conta →
  "Mudar para conta profissional" → Business.
- Essa conta Instagram precisa estar **conectada a uma Página do
  Facebook** (não a um perfil pessoal). Se não tiver Página: crie uma
  em facebook.com/pages/create, depois vá em Instagram → Configurações →
  Conta → "Contas vinculadas" → Facebook → conecte a essa Página.

## Passo 1 — Criar o app no Meta for Developers

1. Acesse developers.facebook.com → "Meus Apps" → "Criar app"
2. Tipo de app: **"Empresa"**
3. Nome: algo como "BK Solutions — Automação"
4. No painel do app, adicione o produto **"Instagram Graph API"** (ou
   "Instagram" dentro de "Casos de Uso")

## Passo 2 — Pegar os IDs

Com o app criado e a Página conectada à conta Instagram Business:

- **META_PAGE_ID**: em business.facebook.com → Configurações do
  Negócio → Páginas → clique na Página → o ID aparece lá (ou via
  Graph API Explorer: `GET /me/accounts`)
- **META_IG_USER_ID**: via Graph API Explorer, com a Página selecionada:
  `GET /{META_PAGE_ID}?fields=instagram_business_account` — o número
  retornado em `instagram_business_account.id` é o `META_IG_USER_ID`

## Passo 3 — Gerar o token de longa duração

1. No Graph API Explorer (developers.facebook.com/tools/explorer),
   selecione o app criado, selecione a Página, e gere um **token de
   usuário** com as permissões:
   - `pages_show_list`
   - `pages_read_engagement`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management`
2. Esse token de usuário dura ~1-2h. Troque por um de longa duração
   (~60 dias) chamando:
   ```
   GET https://graph.facebook.com/v19.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id=<APP_ID>
     &client_secret=<APP_SECRET>
     &fb_exchange_token=<TOKEN_CURTO>
   ```
3. O token retornado é o `META_PAGE_ACCESS_TOKEN`. **Guardar a data** —
   expira em ~60 dias, precisa renovar (vou te avisar quando estiver
   perto de vencer, se a automação estiver rodando).

## Passo 4 — Preencher o `.env`

Na raiz do projeto, criar um arquivo `.env` (nunca commitar — já está
no `.gitignore`):

```bash
META_PAGE_ACCESS_TOKEN=EAAxxxxxxxxxxxx
META_PAGE_ID=123456789012345
META_IG_USER_ID=123456789012345
```

## Passo 5 — Testar

Depois que os scripts (`scripts/postar-instagram.js`) estiverem
criados, rodar um teste com 1 imagem antes de confiar a automação:

```bash
node --env-file=.env scripts/postar-instagram.js <pasta-de-teste>
```

Se retornar um `post id` real, está pronto pra virar automação.

## O que avisar se algo mudar

- Trocou de Página do Facebook ou de conta Instagram → refazer Passo 2
- Token expirou (~60 dias) → refazer Passo 3
- Perdeu acesso ao Business Manager → checar permissões em
  business.facebook.com → Configurações do Negócio → Pessoas
