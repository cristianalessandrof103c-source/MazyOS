# Estratégia

> O que importa agora. Prioridades, metas, prazos.
> O Claude usa isso pra decidir o que sugerir primeiro e o que adiar.
> Atualize sempre que as prioridades mudarem.

## Fase

## Prioridade principal

Construção do site institucional da própria BK Solutions: landing page única, estilo dark tech, com animações, em `saidas/site/` (index.html, styles.css, script.js). Identidade visual ainda em ajuste.

Em paralelo, automação de tráfego pago no Meta Ads: estrutura pronta em `marketing/integracao-meta-ads/` (skills `/anuncio-meta` e `/otimizar-meta-ads`, regras de escalonamento e kill-switch travadas em `config.json`). Setup de credenciais concluído (2026-07-07): App, System User `bkads`, WABA conectada e `CONNECTED`, campanha + conjunto de anúncios já criados via API (`120246235146860014` / `120246255003310014`, ambos PAUSED, R$50/dia) e o criativo (imagem + copy) já pronto em `marketing/conteudo/post-anuncio-meta-bk-2026-07-07/`.

**Bloqueado (2026-07-07):** app da Meta em modo de desenvolvimento não pode criar o objeto final do anúncio — exige **verificação da empresa** (`business.facebook.com/settings/security`), que a Meta costuma levar de 4 dias a 2 semanas pra analisar. Assim que aprovar, é só rodar o upload da imagem → criativo → anúncio de novo (script já testado, falta só esse passo).

Também ativa: prospecção por telefone, com roteiro completo em `comercial/roteiro-prospeccao-telefone.md` (abertura, qualificação, tratamento de objeções, foco em agendar call de vendas — não vender na ligação).

Também em construção: sistema web único (`sistema/`) — CRM + agente de IA no WhatsApp + financeiro, plano completo em `C:\Users\topher7\.claude\plans\um-sistema-que-crispy-pie.md`. Progresso (2026-07-07): Fase 0 (auth multi-tenant), Fase 1 (CRM manual, board Kanban), Fase 3 (follow-up automático + dashboard financeiro), Fase 4 (cérebro coletivo/RAG compartilhado entre tenants) e Fase 5 (hub de integrações — carrossel → Instagram pelo dashboard) prontas e validadas. Fase 2 (WhatsApp sandbox + agente de IA) com código completo e deployado — Edge Function `whatsapp-webhook` recebe mensagem, resolve tenant, roda o agente com as 5 tools e responde; testada ponta a ponta via simulação (só falta crédito na Anthropic pra gerar a resposta real, ver abaixo). Número de teste do WhatsApp já registrado: `120219489644135` (`whatsapp_connections` no banco). Fase 6 (corte pro WhatsApp real) **bloqueada** aguardando a verificação de empresa da Meta (ver "Contexto com prazo" abaixo) — o único adiantamento possível sem essa aprovação (webhook e follow-up-dispatcher escolherem o token certo por conexão test/live) já foi feito. Fase 7 (parte 1 — convite self-service + branding por tenant) pronta e validada; o resto da Fase 7 (Embedded Signup do WhatsApp por cliente, OAuth de ads por tenant, billing de verdade) segue fora de escopo: Embedded Signup ainda nem foi solicitado à Meta, e billing só tem a decisão de modelo tomada — mensalidade fixa de **R$97,00/mês** por plano (decisão do dono, 2026-07-08) —, sem integração ainda. Depois da Fase 7, o dono pediu (2026-07-08) uma reestruturação de UI: a
navegação (CRM/Financeiro/Hub/Configurações) virou uma sidebar fixa à esquerda, e a tela inicial
deixou de ser a lista nua de empresas — agora é uma "Visão Geral" com KPIs e gráficos (leads/dia,
receita × gasto/dia, leads por canal), pronta e validada. Fase 8 (Prospecção, pedida
2026-07-13 inspirada no concorrente Kaptar) implementada: aba nova no dashboard
(`/prospeccao/:tenantId`) que busca prospects por nicho+região via Google Places API
(New) — nome, endereço, telefone, site, e Instagram/LinkedIn extraídos do site do
próprio prospect (best-effort). Fica num funil separado do CRM (`prospects`, tabela
nova); só quando qualificado manualmente vira lead de verdade via RPC
`convert_prospect_to_lead`. **Testada ponta a ponta em produção (2026-07-13) e
funcionando**: migration aplicada via SQL Editor do Supabase, Edge Function deployada
pelo painel web (sem CLI, sem Node.js local), frontend publicado no Netlify
(`exquisite-babka-18957a.netlify.app`). Detalhes de cada fase em `sistema/README.md`.

## O que pode esperar

- **Crédito na conta da Anthropic** (console.anthropic.com → Plans & Billing) — necessário pra o agente de WhatsApp (Fase 2) e a extração de insights (Fase 4) funcionarem de verdade. Decisão do dono (2026-07-07): deixar pra fazer só no final, quando o resto do sistema estiver pronto, junto com a configuração de pagamento.
- **Token permanente do WhatsApp** — o temporário usado na Fase 2 expirou em 24h (achado ao testar a Fase 3). Precisa gerar um permanente via System User `bkads` antes de qualquer envio real (agente ou follow-up) funcionar.
- **Chave da Voyage AI** (voyageai.com) — necessária pra Fase 4 gerar embeddings de verdade (retrieval do cérebro coletivo). Sem ela o resto do pipeline funciona (extrai insight, grava rascunho), só não embeda.
- **Template pré-aprovado pela Meta** — sem isso, o follow-up de "lead sem resposta" (Fase 3) quase sempre encontra a janela de 24h já fechada quando tenta enviar (limitação real da Cloud API, não bug).
- **Node.js instalado neste ambiente** — não há `node`/`npm`/`npx` disponível aqui (verificado 2026-07-13), então não dá pra rodar typecheck/build/deploy do `sistema/` direto por essa via. Na prática isso não bloqueou nada: migrations e Edge Functions dão pra aplicar 100% pelo painel web do Supabase (SQL Editor + Edge Functions → Via Editor), e o frontend builda sozinho no Netlify a partir do push no GitHub — só rodar `npm run dev` local que fica indisponível aqui.

## Contexto com prazo

- Verificação da empresa na Meta em andamento (iniciada 2026-07-07) — bloqueia a publicação do primeiro anúncio de Meta Ads até aprovar (prazo estimado: até 2026-07-21).
