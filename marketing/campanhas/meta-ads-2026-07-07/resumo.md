# Campanha Meta Ads — 2026-07-07

**Campanha:** BK Solutions — IA + Tráfego Pago — WhatsApp (`120246235146860014`)
**Conjunto:** BK — Nacional — Amplo — R$50/dia (`120246255003310014`)
**Objetivo:** Clique-no-WhatsApp (OUTCOME_ENGAGEMENT / CONVERSATIONS)
**Segmentação:** Brasil, 25-65 anos, sem recorte de interesse (público amplo de propósito)
**Orçamento:** R$50/dia · bid strategy: menor custo, sem teto
**Status:** PAUSED — falta o criativo (imagem) pra criar os anúncios

## Pendente: criativo visual

A skill não cria anúncio sem imagem (regra de segurança — anúncio de link sem mídia tem entrega
ruim/pode ser rejeitado). Assim que tiver uma arte pronta (ou pedir pra gerar via `/carrossel`),
volta aqui e roda `/anuncio-meta` de novo, ou peço pra subir direto com `uploadImagemPorUrl` +
`criarCreative` + `criarAnuncio` usando os IDs de campanha/conjunto acima.

## Copy rascunhada (3 variações pra revisar antes de subir)

**Variação 1 — direto no resultado**
- Headline: "Sua clínica lota a agenda sozinha"
- Texto: "Implementamos IA nos processos da sua clínica e ligamos isso a tráfego pago de verdade. Sem prometer milagre, só sistema rodando."
- Descrição: "IA + tráfego pago pra clínicas"

**Variação 2 — prova de mercado**
- Headline: "5 anos fazendo clínica vender mais"
- Texto: "IA no atendimento, site que converte, anúncio que não queima verba. Fala com a gente no WhatsApp."
- Descrição: "Squad único, dado compartilhado"

**Variação 3 — pergunta/curiosidade**
- Headline: "Quanto sua clínica perde sem IA?"
- Texto: "Cada lead sem resposta rápida é agenda vazia. A BK conecta IA + marketing pra isso não acontecer mais."
- Descrição: "Fala com a BK no WhatsApp"

**Mensagem de boas-vindas do WhatsApp (todas as variações):**
"Oi! Vi que você chegou pelo anúncio da BK Solutions. Me conta rapidinho: sua clínica já usa alguma automação de atendimento hoje, ou seria a primeira vez?"

> Copy é rascunho — revisar tom antes de subir. Não testado com o público real ainda.

## Pra ativar (depois de completar o criativo)

1. Abrir Ads Manager e conferir segmentação, criativo e orçamento
2. Confirmar que o WhatsApp conectado (`+55 63 7604-2989`) é o certo
3. Ativar manualmente (ou pedir pra eu ativar, depois que você confirmar a revisão)
4. Depois de ativar, rodar `/otimizar-meta-ads` (em dry-run nos primeiros dias) pra acompanhar

## Observações do setup (fica registrado pra próxima campanha)

- O número de WhatsApp certo na API é `556376042989` (sem o "9" — é o formato que a Meta verificou de verdade, mesmo o discador mostrando "+55 63 7604-2989").
- Criação de campanha exige `is_adset_budget_sharing_enabled` (usamos `false`, orçamento fica no conjunto).
- Criação de conjunto exige `bid_strategy` explícito (usamos `LOWEST_COST_WITHOUT_CAP`).
- O WhatsApp Business Account precisa: (a) forma de pagamento cadastrada no WhatsApp Manager, (b) System User com permissão `whatsapp_business_management` no token, (c) número com status `CONNECTED` (não só "vinculado" na Página).
