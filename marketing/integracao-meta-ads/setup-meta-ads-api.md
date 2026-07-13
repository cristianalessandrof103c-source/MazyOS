# Setup — Marketing API da Meta (Ads)

Guia de uma vez só, separado do `automacao-instagram/setup-meta.md` (aquele é só
pra publicar conteúdo — este aqui dá acesso pra **criar campanhas e gastar
orçamento de verdade**). Token errado aqui tem impacto financeiro direto.

## Pré-requisitos

- Business Manager (business.facebook.com) com a conta de anúncio da BK já
  criada e um cartão/método de pagamento ativo.
- Você precisa ser **admin** do Business Manager.
- A Página do Facebook da BK já conectada ao Business Manager.
- Se o objetivo for WhatsApp: número de WhatsApp Business conectado à Página
  (Configurações da Página → WhatsApp).

## Passo 1 — Criar o app no Meta for Developers

1. developers.facebook.com → "Meus Apps" → "Criar app" → tipo **"Empresa"**
2. Nome: "BK Solutions — Ads" (separado do app de conteúdo, pra não misturar
   permissão de publicar post com permissão de gastar dinheiro)
3. No painel do app, adicione o produto **"Marketing API"**

## Passo 2 — Criar um System User (recomendado em vez de token pessoal)

Token de usuário pessoal expira e trava se você trocar de senha ou perder
acesso. Pra automação, o certo é System User:

1. business.facebook.com → Configurações do Negócio → Usuários → **Usuários
   do sistema** → "Adicionar"
2. Nome: "automacao-ads-bk", papel: **Admin** (precisa pra criar campanha)
3. "Adicionar ativos" → selecione a conta de anúncio da BK e a Página → dê
   permissão total (gerenciar)
4. Com o System User criado, clique em **"Gerar novo token"**
5. Selecione o app criado no Passo 1
6. Marque as permissões:
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_read_engagement` (necessário pra ler a Página no creative)
7. Gere o token. **Esse token de System User não expira** por tempo (só se
   revogado manualmente) — guarde com cuidado, ele vale dinheiro.

## Passo 3 — Pegar o Ad Account ID

- business.facebook.com → Configurações do Negócio → Contas → Contas de
  anúncio → clique na conta da BK → o ID aparece como `act_XXXXXXXXXXXXX`
- Guardar só o número (sem o prefixo `act_` — o script adiciona sozinho)

## Passo 4 — Pegar Page ID e número de WhatsApp

- **Page ID:** já deve estar em `.env` como `META_PAGE_ID` (do setup de
  conteúdo). Reaproveitar o mesmo.
- **WhatsApp:** Configurações da Página → WhatsApp → número conectado. Formato
  internacional sem símbolos: `5511999999999`.

## Passo 5 — Preencher `.env` e `config.json`

No `.env` (nunca commitar — já está no `.gitignore`):

```bash
META_ADS_ACCESS_TOKEN=EAAxxxxxxxxxxxx   # token do System User (Passo 2)
META_AD_ACCOUNT_ID=1234567890123        # sem o "act_" (Passo 3)
```

Em `marketing/integracao-meta-ads/config.json`, preencher o bloco `conta`:

```json
"conta": {
  "ad_account_id": "1234567890123",
  "page_id": "SEU_PAGE_ID",
  "whatsapp_phone_number": "5511999999999",
  "moeda": "BRL"
}
```

## Passo 6 — Testar antes de confiar

```bash
node --env-file=.env scripts/lib/meta-ads-api.js --teste
```

Isso só faz uma chamada de leitura (`GET /act_{id}?fields=name,account_status`)
pra confirmar que o token e o ID estão certos, sem criar nada. Se retornar o
nome da conta, está pronto pra usar `/anuncio-meta`.

## Regra de ouro antes de ativar qualquer campanha de verdade

1. Rodar `/anuncio-meta` — ele sempre cria tudo com status `PAUSED`.
2. **Revisar manualmente no Ads Manager** — conferir segmentação, criativo,
   orçamento, se o pixel/WhatsApp está certo.
3. Só então ativar (manual, pelo Ads Manager, ou pedindo pra eu ativar depois
   que você confirmar que revisou).
4. Rodar `/otimizar-meta-ads` em modo `--dry-run` (padrão) por alguns dias
   antes de destravar a escala automática de verdade (`--aplicar`).

## O que avisar se algo mudar

- Trocou de conta de anúncio ou de Página → refazer Passo 2 e 3
- Token do System User parou de funcionar → conferir em Configurações do
  Negócio → Usuários do sistema se o token não foi revogado
- Mudou o número de WhatsApp → refazer Passo 4 e atualizar `config.json`
