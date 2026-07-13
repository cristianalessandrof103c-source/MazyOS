---
name: anuncio-meta
description: >
  Cria estrutura completa de campanha do Meta Ads (Facebook/Instagram) direto pela Marketing API —
  campanha, conjunto de anúncios e anúncio com criativo, sempre em PAUSED pra revisão humana antes
  de ativar. Hoje configurado pra objetivo de clique-no-WhatsApp. Lê o briefing de _memoria/empresa.md.
  Use quando o usuário pedir "criar campanha meta ads", "anúncio no facebook/instagram", "meta ads",
  "campanha de whatsapp", ou /anuncio-meta.
---

# /anuncio-meta — Estrutura de campanha Meta Ads via API

Skill que cria a campanha inteira (campanha → conjunto de anúncios → criativo → anúncio) direto na
conta via Marketing API, sempre pausada. Diferente do `/anuncio-google` (que gera CSV pra importar),
aqui a criação já é na conta real — por isso a régua de segurança é mais rígida.

## Dependências

- **Setup obrigatório antes da primeira vez:** `marketing/integracao-meta-ads/setup-meta-ads-api.md`
  — se `config.json` não tiver `conta.ad_account_id` preenchido, parar e pedir pro usuário rodar o
  setup primeiro. Não inventar ID de conta.
- **Contexto do negócio:** `_memoria/empresa.md` (produto/serviço, público, diferenciais)
- **Tom de voz:** `_memoria/preferencias.md`
- **Config de regras:** `marketing/integracao-meta-ads/config.json`
- **Biblioteca:** `scripts/lib/meta-ads-api.js`
- **Outputs (resumo da campanha criada) vão em:** `marketing/campanhas/meta-ads-<YYYY-MM-DD>/`

## Antes de tudo

1. Ler `marketing/integracao-meta-ads/config.json`. Se `conta.ad_account_id`, `conta.page_id` ou
   `conta.whatsapp_phone_number` estiverem vazios, parar e apontar pro setup.
2. Rodar `node --env-file=.env scripts/lib/meta-ads-api.js --teste` pra confirmar que a conexão
   funciona antes de criar qualquer coisa.

## Workflow

### Passo 1 — Briefing

Se o usuário não passou briefing, perguntar:

1. **Produto/serviço a anunciar?** (1-3 linhas)
2. **Quem é o público?** (perfil, dor, faixa etária, localização)
3. **Região:** cidade/raio em km, ou nacional?
4. **Orçamento diário?** Se não souber, usar `orcamento.orcamento_diario_inicial_reais` do config.
5. **Imagem/vídeo já existe ou preciso sugerir referência?** (essa skill não gera imagem — se
   precisar, usar o fluxo do `/carrossel` ou pedir a arte pronta)

### Passo 2 — Copy do criativo

Gerar, seguindo `_memoria/preferencias.md`:

- **Headline** (até 40 caracteres)
- **Texto principal** (até 125 caracteres pra não cortar no feed)
- **Descrição** (opcional, até 30 caracteres)
- **Mensagem de boas-vindas do WhatsApp** (o que a pessoa vê ao abrir a conversa — já preenchido,
  reduz fricção)

Gerar 2-3 variações de criativo por conjunto (pra teste A/B), não só uma.

### Passo 3 — Segmentação

Montar o objeto `targeting` (idade, gênero, localização, interesses) com base no briefing. Manter
simples no início — segmentação muito estreita soma com orçamento baixo e trava o aprendizado do
algoritmo. Preferir público mais amplo + deixar a otimização da Meta trabalhar, a menos que o
briefing peça nicho específico.

### Passo 4 — Criar via API (sempre pausado)

Usando `scripts/lib/meta-ads-api.js`:

1. `criarCampanha` — objective de `config.objetivo.campaign_objective`
2. Se tiver imagem: `uploadImagemPorUrl` pra pegar o `image_hash`
3. `criarCreative` — uma por variação de copy
4. `criarConjuntoAnuncios` — orçamento do briefing (ou do config), `optimization_goal` de
   `config.objetivo.optimization_goal`, `promoted_object` com `page_id` e `whatsapp_phone_number`
   do config
5. `criarAnuncio` — um por criativo, ligado ao mesmo conjunto

**Nunca passar `status: 'ACTIVE'` em nenhuma chamada.** As funções da lib já forçam `PAUSED` — não
sobrescrever isso.

### Passo 5 — Resumo e próximos passos

Salvar resumo em `marketing/campanhas/meta-ads-<YYYY-MM-DD>/resumo.md`:

```markdown
# Campanha Meta Ads — <data>

**Campanha:** <nome> (<campaign_id>)
**Conjunto:** <nome> (<adset_id>) — orçamento R$<X>/dia
**Anúncios:** <N> variações de criativo
**Status:** PAUSED — revisar antes de ativar

## Pra ativar
1. Abrir Ads Manager e conferir segmentação, criativo e orçamento
2. Confirmar que o WhatsApp conectado é o certo
3. Ativar manualmente (ou pedir pra eu ativar, depois que você confirmar a revisão)
4. Depois de ativar, rodar `/otimizar-meta-ads` (em dry-run nos primeiros dias) pra acompanhar
```

Mostrar esse resumo no chat também.

---

## Regras

- **Sempre PAUSED.** Nunca ativar campanha sozinho, nem se o usuário disser "pode subir" — pedir
  confirmação explícita de que ele revisou no Ads Manager antes de qualquer `ativarConjunto`.
- **Nunca inventar `ad_account_id`, `page_id` ou `whatsapp_phone_number`.** Vêm só do `config.json`
  preenchido pelo setup. Se estiver vazio, parar.
- **Sem imagem, sem anúncio.** Anúncio de imagem/vídeo precisa de criativo visual — não criar
  anúncio só com texto se o formato exigir mídia.
- **Segmentação ampla por padrão.** Só estreitar se o briefing pedir nicho específico e o
  orçamento suportar (orçamento baixo + público estreito = aprendizado travado).
- Copies seguem `_memoria/preferencias.md` estritamente — sem clichê de "revolucione seu negócio".
