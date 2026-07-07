# Estratégia

> O que importa agora. Prioridades, metas, prazos.
> O Claude usa isso pra decidir o que sugerir primeiro e o que adiar.
> Atualize sempre que as prioridades mudarem.

## Fase

## Prioridade principal

Construção do site institucional da própria BK Solutions: landing page única, estilo dark tech, com animações, em `saidas/site/` (index.html, styles.css, script.js). Identidade visual ainda em ajuste.

Em paralelo, automação de tráfego pago no Meta Ads: estrutura pronta em `marketing/integracao-meta-ads/` (skills `/anuncio-meta` e `/otimizar-meta-ads`, regras de escalonamento e kill-switch travadas em `config.json`). Setup de credenciais concluído (2026-07-07): App, System User `bkads`, WABA conectada e `CONNECTED`, campanha + conjunto de anúncios já criados via API (`120246235146860014` / `120246255003310014`, ambos PAUSED, R$50/dia) e o criativo (imagem + copy) já pronto em `marketing/conteudo/post-anuncio-meta-bk-2026-07-07/`.

**Bloqueado (2026-07-07):** app da Meta em modo de desenvolvimento não pode criar o objeto final do anúncio — exige **verificação da empresa** (`business.facebook.com/settings/security`), que a Meta costuma levar de 4 dias a 2 semanas pra analisar. Assim que aprovar, é só rodar o upload da imagem → criativo → anúncio de novo (script já testado, falta só esse passo).

Também em construção: sistema web único (`sistema/`) — CRM + agente de IA no WhatsApp + financeiro, plano completo em `C:\Users\topher7\.claude\plans\um-sistema-que-crispy-pie.md`. Progresso (2026-07-07): Fase 0 (auth multi-tenant), Fase 1 (CRM manual, board Kanban), Fase 3 (follow-up automático + dashboard financeiro) e Fase 4 (cérebro coletivo/RAG compartilhado entre tenants) prontas e validadas. Fase 2 (WhatsApp sandbox + agente de IA) com código completo e deployado — Edge Function `whatsapp-webhook` recebe mensagem, resolve tenant, roda o agente com as 5 tools e responde; testada ponta a ponta via simulação (só falta crédito na Anthropic pra gerar a resposta real, ver abaixo). Número de teste do WhatsApp já registrado: `120219489644135` (`whatsapp_connections` no banco). Detalhes de cada fase em `sistema/README.md`.

## O que pode esperar

- **Crédito na conta da Anthropic** (console.anthropic.com → Plans & Billing) — necessário pra o agente de WhatsApp (Fase 2) e a extração de insights (Fase 4) funcionarem de verdade. Decisão do dono (2026-07-07): deixar pra fazer só no final, quando o resto do sistema estiver pronto, junto com a configuração de pagamento.
- **Token permanente do WhatsApp** — o temporário usado na Fase 2 expirou em 24h (achado ao testar a Fase 3). Precisa gerar um permanente via System User `bkads` antes de qualquer envio real (agente ou follow-up) funcionar.
- **Chave da Voyage AI** (voyageai.com) — necessária pra Fase 4 gerar embeddings de verdade (retrieval do cérebro coletivo). Sem ela o resto do pipeline funciona (extrai insight, grava rascunho), só não embeda.
- **Template pré-aprovado pela Meta** — sem isso, o follow-up de "lead sem resposta" (Fase 3) quase sempre encontra a janela de 24h já fechada quando tenta enviar (limitação real da Cloud API, não bug).

## Contexto com prazo

- Verificação da empresa na Meta em andamento (iniciada 2026-07-07) — bloqueia a publicação do primeiro anúncio de Meta Ads até aprovar (prazo estimado: até 2026-07-21).
