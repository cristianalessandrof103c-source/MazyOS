# sistema/ — plataforma BK Solutions

Aplicação web (SPA autenticada) que centraliza CRM, agentes de IA no WhatsApp, dashboard
financeiro e o hub de automações do MazyOS. Arquitetura completa em
`C:\Users\topher7\.claude\plans\um-sistema-que-crispy-pie.md`.

Stack: Vite + React + TypeScript + Tailwind CSS (tema portado de `saidas/site/styles.css`) +
Supabase (Postgres + Auth + RLS multi-tenant) + TanStack Query + React Router.

## Fase 0 — o que já está pronto

- Scaffold do app (`src/`), tema Tailwind com a identidade dark-tech da BK.
- `supabase/migrations/0001_init_schema.sql` — tabelas `companies`, `profiles`, `memberships`,
  `platform_admins`, `pipeline_stages` (com seed do template padrão de estágios).
- `supabase/migrations/0002_auth_claims_and_rls.sql` — Auth Hook que injeta `tenant_ids` e
  `is_platform_admin` no JWT, mais as políticas de RLS que isolam cada tenant.
- `supabase/seed.sql` — cria a empresa "BK Solutions" (slug `bk-solutions`).
- Login (`/login`) e dashboard protegido (`/`) já ligados ao Supabase Auth e à lista de
  `companies` visível via RLS.

## O que falta você fazer (precisa de conta/Docker — não dá pra automatizar)

### 1. Escolher onde rodar o Supabase

**Opção A — projeto hospedado (mais simples pra começar):**
1. Crie um projeto em [supabase.com/dashboard](https://supabase.com/dashboard) (região São Paulo,
   se disponível — relevante pra LGPD mais adiante).
2. Em Project Settings → API, copie a `Project URL` e a `anon public key`.
3. Copie `sistema/.env.example` para `sistema/.env.local` e cole os dois valores.
4. Rode as migrations contra o projeto: `npx supabase login` (abre o navegador pra
   autenticar), depois `npx supabase link --project-ref <ref-do-projeto>` e
   `npx supabase db push`.
5. Habilite o Auth Hook manualmente: Authentication → Hooks → "Customize Access Token (Auth)
   Hook" → selecione a função `public.custom_access_token_hook`.
6. Rode `supabase/seed.sql` uma vez (SQL Editor do dashboard ou
   `npx supabase db execute -f supabase/seed.sql`).

**Opção B — tudo local (Docker):**
1. Abra o Docker Desktop (instalado, mas não estava rodando quando isso foi escrito).
2. `npx supabase start` dentro de `sistema/` — sobe Postgres/Auth/Studio local e já aplica
   migrations + seed + o Auth Hook (já habilitado em `supabase/config.toml`).
3. O comando imprime a `API URL` e a `anon key` locais — cole em `sistema/.env.local`.

### 2. Criar sua conta de dono e virar tenant_admin + platform_admin

1. Rode o app (`npm run dev`) e cadastre-se pela tela de login — ou crie o usuário direto no
   Supabase Studio (Authentication → Users → Add user).
2. Com o `user_id` gerado, rode (SQL Editor ou `psql`):

```sql
insert into public.memberships (user_id, tenant_id, role, status, accepted_at)
select u.id, c.id, 'tenant_admin', 'active', now()
from auth.users u, public.companies c
where u.email = 'SEU_EMAIL_AQUI' and c.slug = 'bk-solutions';

insert into public.platform_admins (user_id)
select id from auth.users where email = 'SEU_EMAIL_AQUI';
```

3. Faça logout/login de novo (o JWT só ganha os claims novos num token reemitido) e confirme
   que "BK Solutions" aparece no dashboard com a etiqueta "super admin".

## Fase 1 — CRM manual (pronto)

Board Kanban em `/crm/:tenantId` (pipeline, leads, canais, deals, payments — migration
`0003_crm_core.sql`). Validado ponta a ponta: criar lead → mover pelo pipeline → fechar venda →
ver refletido no board.

## Fase 2 — WhatsApp sandbox + agente de IA (código pronto e deployado, testado ponta a ponta)

- `supabase/migrations/0004_whatsapp_agent.sql` — `whatsapp_connections`, `conversations`,
  `messages`, `agent_configs`, `follow_up_jobs` (fila simples; o dispatcher automático é Fase 3).
  Já aplicada no banco hospedado.
- `supabase/functions/whatsapp-webhook/` — Edge Function (Deno) que recebe a mensagem do
  WhatsApp, resolve o tenant pelo `phone_number_id`, roda o agente (Claude + 5 tools:
  `atualizar_estagio_lead`, `registrar_venda`, `agendar_followup`, `marcar_conversa_perdida`,
  `escalar_para_humano`) e responde pelo WhatsApp. `escalar_para_humano` pausa o agente pra
  aquela conversa até alguém da equipe assumir.
- No dashboard: botão "Ver conversa" em cada lead do CRM abre o histórico da conversa
  (`sistema/src/pages/crm/ConversationDialog.tsx`), atualizando a cada poucos segundos.

### Status (2026-07-07) — feito

- Número de teste do WhatsApp Cloud API registrado: Phone Number ID `120219489644135`, WABA ID
  `2096893477927650`, linha em `whatsapp_connections` já no banco.
- Secrets configurados e função deployada (`npx supabase functions deploy whatsapp-webhook`):
  `WHATSAPP_APP_SECRET`, `WHATSAPP_TEST_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`,
  `ANTHROPIC_API_KEY`. Callback URL: `https://tblumyuozhysncscktrk.supabase.co/functions/v1/whatsapp-webhook`.
- Handshake de verificação do webhook testado (GET com `hub.challenge`) — OK.
- Fluxo completo testado com uma mensagem simulada (POST assinado com o App Secret): lead criado,
  conversa criada, mensagem inbound salva. Só parou no passo de chamar o Claude.

### Pendente — decisão do dono, não bug

O agente parou aqui: **"Your credit balance is too low to access the Anthropic API"**. A conta em
[console.anthropic.com](https://console.anthropic.com) usada pra gerar a `ANTHROPIC_API_KEY`
precisa de crédito (Plans & Billing) pra ele conseguir responder de verdade. Decisão registrada em
`_memoria/estrategia.md` (2026-07-07): deixar esse passo pro final, junto com a configuração de
pagamento do sistema como um todo.

Quando for a hora: adiciona crédito na Anthropic, manda uma mensagem de teste pelo WhatsApp real
pro número de teste, e confirma que a resposta chega e a conversa aparece no botão "Ver conversa"
do lead no CRM. Se der outro erro, ele fica gravado como mensagem `[erro interno] ...` na própria
conversa (não precisa de acesso a log do Supabase pra depurar).

## Fase 3 — follow-up automático + dashboard financeiro (pronto)

### Motor de follow-up

- `supabase/migrations/0005_follow_up_engine.sql` — `follow_up_sequences` +
  `follow_up_sequence_steps` (tenant_id nulo = sequência padrão da plataforma, mesmo padrão de
  `pipeline_stages`), `follow_up_jobs` estendida com `sequence_id`/`step_id`/`conversation_id`.
  Sequências seedadas: **lead sem resposta** (24h → 72h) e **pós-venda** (7 dias).
- Gatilhos automáticos (triggers Postgres): venda ganha/perdida cancela o follow-up de
  "sem resposta" pendente e enfileira o próximo evento (`deal_won`/`deal_lost`); mensagem inbound
  do lead cancela follow-up de "sem resposta" pendente daquela conversa.
- `enqueue_lead_no_response_jobs()` — scan via `pg_cron` a cada 15min, enfileira o passo 1 de
  conversas ativas, em estágio "in_progress", paradas há mais tempo que o delay do passo.
- `supabase/functions/follow-up-dispatcher/` — chamada por `pg_cron`/`pg_net` a cada 2min. Job de
  sequência: renderiza o template (`{{lead_name}}`, `{{company_name}}`) e manda via WhatsApp *só
  dentro da janela de 24h* (fora dela precisaria de Template pré-aprovado pela Meta — ainda não
  configurado, o job fica pendente pro próximo ciclo). Ao enviar, encadeia o próximo passo da
  sequência automaticamente. Job ad-hoc (da tool `agendar_followup`, sem sequência) não manda
  nada sozinho — escala a conversa pra `needs_human`, é um lembrete pro time, não uma mensagem
  roteirizada.
- **Testado ponta a ponta** (trigger de venda, trigger de resposta do lead, scan, encadeamento —
  script de teste limpo depois). Achado real durante o teste: o token do WhatsApp configurado na
  Fase 2 era temporário (24h) e expirou — precisa de um permanente (ver abaixo).

### Dashboard financeiro

- `supabase/migrations/0006_ad_spend.sql` — `ad_account_connections` (qual conta/campanhas
  sincronizar por tenant) e `ad_spend_snapshots` (gasto/resultado diário).
- `supabase/functions/sync-ad-spend/` — porta de `scripts/lib/meta-ads-api.js`
  (`buscarInsightsDiarios`) pra Deno. Roda 1x/dia via `pg_cron`, testado manualmente (token válido,
  API respondeu — só não tem dados porque a campanha de Ads está pausada).
- Página `/financeiro/:tenantId` (link "Financeiro" no card de cada empresa no dashboard): KPIs
  (leads no período, receita fechada/a receber, gasto de tráfego, CAC de canais pagos), tabela de
  leads por canal e tabela de gasto por dia. Testada no navegador, sem erros de console.

### Pendente

- **Token do WhatsApp expirado** (mesmo bloqueio da Fase 2) — gerar um permanente via System User
  `bkads` (Business Settings → System Users → gerar token com `whatsapp_business_messaging` +
  `whatsapp_business_management`) e rodar `npx supabase secrets set WHATSAPP_TEST_ACCESS_TOKEN=...`.
- Crédito na Anthropic (mesma decisão da Fase 2, deixada pro final).
- Template pré-aprovado pela Meta pra follow-up funcionar fora da janela de 24h — sem isso, na
  prática, o follow-up de "sem resposta" quase sempre vai cair com a janela já fechada (ela fecha
  no mesmo instante em que o follow-up conta, 24h desde a última mensagem do lead). Funciona bem
  pra pós-venda se a venda for registrada logo após a última mensagem.

## Fase 4 — cérebro coletivo / RAG (pronto)

Base de conhecimento **compartilhada entre todos os tenants** (decisão do dono) — aprendizado de
padrões de venda que melhora com cada conversa, de qualquer cliente da plataforma.

- `supabase/migrations/0007_cerebro_coletivo.sql` — extensão `pgvector`, `knowledge_base_insights`
  (`scope='platform'`, sem `tenant_id` de propósito, índice `hnsw` sobre `embedding vector(512)`),
  `conversation_outcomes` (1 linha por conversa processada, evita reprocessar) e a função
  `match_insights(query_embedding, match_count)` (busca por similaridade de cosseno, só
  `status='approved'`).
- `supabase/functions/_shared/embeddings.ts` — embeddings via **Voyage AI** (`voyage-3-lite`,
  512 dim — parceiro recomendado pela Anthropic; trocar de provedor só muda esse arquivo).
- `supabase/functions/extract-insights/` — ao fim de uma conversa (venda ganha/perdida, disparado
  direto pelas tools `registrar_venda`/`marcar_conversa_perdida` em `whatsapp-webhook/agent.ts`;
  ou por timeout, scan diário via `pg_cron` pra conversas paradas há +7 dias sem outcome) lê a
  transcrição, chama Claude (tool use forçado) pra extrair 0-N insights genéricos — **sem dado que
  identifique o lead** — grava como `status='draft'`, gera o embedding de cada um, e registra o
  desfecho em `conversation_outcomes`.
- `whatsapp-webhook/agent.ts` — antes de cada resposta, embeda a mensagem do lead e busca os 5
  insights aprovados mais parecidos via `match_insights`, injeta no system prompt como "Conhecimento
  coletivo". Se a busca falhar (sem `VOYAGE_API_KEY` configurada, por exemplo), o agente segue sem
  esse contexto — retrieval é reforço, não dependência dura pra Fase 2 continuar funcionando.
- Página `/cerebro` (link "Cérebro" no header do dashboard, só visível pra `super admin`): abas
  Rascunhos/Aprovados/Arquivados, aprovar ou arquivar cada insight. Só insight aprovado entra no
  retrieval — proteção contra contaminar a base pra todos os tenants com inferência ruim.
- **Testado estruturalmente** (sem depender de chave nova): inseri um insight com embedding
  simulado via SQL, confirmei que `match_insights` ignora rascunho e retorna depois de aprovado
  (similaridade 1.0 pro próprio vetor), e testei o fluxo de aprovação inteiro pela UI (botão
  Aprovar → banco atualiza `status`/`reviewed_by`/`reviewed_at` → aparece na aba Aprovados).
  Dados de teste removidos depois.

### Pendente

- **Chave da Voyage AI** ([voyageai.com](https://voyageai.com)) — sem ela, `extract-insights` ainda
  roda (extrai e salva o rascunho) mas sem embedding, e o retrieval do agente não encontra nada
  pra buscar. Setar com `npx supabase secrets set VOYAGE_API_KEY=...` dentro de `sistema/`.
- Crédito na Anthropic e token permanente do WhatsApp (mesmos bloqueios das Fases 2/3, decisão do
  dono de deixar pro final) — sem eles, `extract-insights` não consegue chamar o Claude pra
  extrair de verdade, e o agente não consegue responder no WhatsApp real.
- **Dedup semanal de insights parecidos** (mencionado no plano) — não implementado ainda; com o
  volume atual de conversas isso não é urgente, mas fica registrado pra quando o cérebro crescer.

## Fase 5 — hub de integrações do MazyOS (pronto)

Conecta o dashboard às automações de marketing que já existem como scripts (carrossel via
Playwright, publicação via Meta Graph API), sem reescrever a lógica de negócio. Escopo desta
leva: só carrossel → Instagram (Facebook e campanha de Ads ficam pra uma próxima leva).

- `supabase/migrations/0008_integration_hub.sql` — `integration_hub_jobs` (fila de jobs por
  tenant, `tool` já reserva `seo`/`site`/`ads_campaign` além de `carrossel`/`instagram_post`) e
  o bucket público `hub-media` (a Graph API exige URL pública pra buscar a imagem).
- `scripts/hub-worker.js` — worker **local, rodado manualmente** (decisão do dono: nada de
  serviço always-on no Railway/Fly por enquanto). Pega jobs `carrossel` pendentes, roda o
  `render.js` da pasta (Playwright, sem alteração), sobe os PNGs pro Storage. Uso:
  `node --env-file=.env scripts/hub-worker.js`.
- `supabase/functions/hub-instagram-publish/` + `_shared/meta-graph.ts` (porte de
  `scripts/lib/meta-graph.js`) — chamada pelo dashboard autenticado (mantém verificação de JWT
  padrão, diferente do webhook/cron), publica no Instagram e registra o resultado como um novo
  job (`tool='instagram_post'`).
- Página `/hub/:tenantId` (link "Hub" no card de cada empresa): botão "Gerar carrossel" (cria o
  job), lista com polling automático enquanto há job pendente/processando, thumbnail + botão
  "Publicar no Instagram" quando o carrossel termina de renderizar.

### Pendente

- **`META_PAGE_ACCESS_TOKEN` / `META_IG_USER_ID`** como secrets da função (`npx supabase secrets
  set`) — sem eles, "Publicar no Instagram" responde com erro claro em vez de postar de verdade
  (mesmo tipo de bloqueio "pronto, aguardando credencial" das fases anteriores).
- Aplicar a migration no projeto hospedado e fazer deploy da função.

## Fase 6 — corte pro WhatsApp real (bloqueado — aguardando a Meta)

Gated pela verificação de empresa da Meta (`business.facebook.com/settings/security`, iniciada
2026-07-07, prazo estimado até 2026-07-21 — ver `_memoria/estrategia.md`). Sem essa aprovação
não dá pra registrar o número real nem migrar a conexão de `test` pra `live`.

O que já foi adiantado, sem depender da aprovação: `whatsapp-webhook` e `follow-up-dispatcher`
agora resolvem o token de acesso por conexão (`supabase/functions/_shared/whatsapp-tokens.ts`,
`status='live'` → `WHATSAPP_LIVE_ACCESS_TOKEN`, `status='test'` → `WHATSAPP_TEST_ACCESS_TOKEN`)
em vez de um único secret fixo — antes disso, conectar um número real ao lado do número de teste
faria a resposta pro número real sair com o token errado. `follow-up-dispatcher` também passou a
priorizar a conexão `live` quando o tenant tiver as duas. O schema já suportava isso desde a Fase
2 (`whatsapp_connections.status`).

### Quando a verificação aprovar

1. Registrar o número real no WhatsApp Manager e conectá-lo ao mesmo App (Tech Provider da BK).
2. Gerar um token permanente via System User `bkads` com `whatsapp_business_messaging` +
   `whatsapp_business_management`, e setar `npx supabase secrets set
   WHATSAPP_LIVE_ACCESS_TOKEN=...`.
3. Inserir a linha em `whatsapp_connections` (`status='live'`) pro número real — pode conviver
   com a linha `test` já existente.
4. Assinar o webhook do número real pra `whatsapp-webhook` (mesma URL do número de teste).
5. Soft-launch monitorado: acompanhar pelo CRM (botão "Ver conversa") antes de considerar o
   número real em produção plena.

Depende também dos mesmos bloqueios já registrados nas Fases 2-4 (crédito na Anthropic, token
permanente do WhatsApp) — sem eles o agente não responde de verdade, real ou de teste.

## Fase 7 (parte 1) — convite self-service + branding por tenant (pronto)

White-label completo (Embedded Signup do WhatsApp por cliente, OAuth de ads, billing de
verdade) segue bloqueado — Embedded Signup ainda não foi solicitado à Meta (prazo desconhecido)
e billing (decisão do dono: mensalidade fixa de R$97,00/mês por plano) ainda não tem integração. Essa leva
cobre só as duas peças que não dependem de nada externo:

- `supabase/migrations/0009_team_and_branding.sql` — `memberships.invited_email`, policy
  `memberships_accept_self` (convidado aceita o próprio convite), policy
  `profiles_select_tenant_members` (colegas de tenant enxergam o nome um do outro) e a função
  `update_company_branding` (`security definer`, só tenant_admin/platform admin editam
  `companies.branding_json`).
- `supabase/functions/invite-member/` — chamada pelo dashboard, checa se quem chama é
  tenant_admin daquele tenant, convida via `auth.admin.inviteUserByEmail` e cria a membership
  como `status='invited'`. Caso não tratado nesta leva: email que já tem conta em outro tenant
  — a função devolve o erro e o vínculo manual fica por SQL, mesmo padrão do setup da Fase 0.
- `LoginPage.tsx` ganhou o fluxo "Defina sua senha" — o link de convite do Supabase já
  autentica ao carregar a página; sem isso o convidado cairia direto no dashboard com uma senha
  aleatória que nunca viu.
- `DashboardPage.tsx` aceita o convite ao carregar (flipa `status` pra `active`) e força
  `refreshSession()` — os claims `tenant_ids` do JWT são fixados na emissão do token, então sem
  isso o tenant novo só apareceria no refresh automático (até 1h) ou no próximo login.
- Página `/configuracoes/:tenantId` (link "Configurações" no card de cada empresa): seção
  Equipe (lista + convidar, só tenant_admin/platform admin convidam) e seção Marca (cor
  primária + logo, só tenant_admin/platform admin editam). `src/lib/branding.ts` aproveita que
  os tokens de cor do Tailwind (`index.css`) já são CSS custom properties — sobrescrever
  `--color-violet` no container aplica a cor em cascata sem rebuild. `CrmPage`/`FinanceiroPage`/
  `HubPage` passaram a usar o `TenantHeader` compartilhado e essa mesma cor por tenant.

### Pendente

- Configurar a URL de produção em `auth.additional_redirect_urls`/`site_url` (Supabase Auth) —
  sem isso o link de convite não funciona fora do `localhost`.
- Trocar/remover role de um membro já ativo, reenviar convite — só criar e listar por agora.

## UI — sidebar de navegação + dashboard "Visão Geral" (pronto, 2026-07-08)

Pedido do dono: navegação (CRM/Financeiro/Hub/Configurações) numa barra lateral fixa, e uma
tela inicial de verdade (leads, receita, gráficos) em vez da lista de empresas nua.

- `src/components/TenantSidebarLayout.tsx` — substitui o antigo `TenantHeader` (removido) em
  todas as páginas por tenant: sidebar esquerda fixa (nome/logo do tenant, nav vertical com
  `NavLink` — Visão Geral/CRM/Financeiro/Hub/Configurações, rodapé com email + "Trocar empresa"
  + Sair) + área de conteúdo.
- `/` virou `src/pages/RootRedirect.tsx`: roda o accept-invite (movido de `DashboardPage`, já
  que `/` é o único ponto por onde todo login passa) e decide a rota — 1 empresa só → vai direto
  pra `/visao-geral/:id`; 2+ → manda pra `/empresas` (a lista antiga, deslocada pra essa rota).
- `src/pages/overview/OverviewPage.tsx` (`/visao-geral/:tenantId`, tela inicial): mesmos KPIs do
  Financeiro (leads, receita fechada/a receber, gasto, CAC) + 3 gráficos — leads/dia, receita ×
  gasto/dia, leads por canal. Usa as **mesmas query keys** do `FinanceiroPage.tsx`, então
  navegar entre as duas páginas não refaz fetch.
- Gráficos são componentes próprios (`src/components/charts/TimeSeriesChart.tsx` e
  `HorizontalBarChart.tsx`, SVG/div puro, sem lib nova), seguindo a skill de dataviz do Claude
  Code: paleta validada com `scripts/validate_palette.js` da skill contra o tema atual (o cyan
  de marca `#22d3ee` é claro demais pra mark de gráfico — usa um passo mais escuro `#0e93ab` só
  ali dentro, a cor de UI não muda), hover com crosshair+tooltip, sem dual-axis.

## Fase 8 — Prospecção (pronto, não testado ponta a ponta)

Pedido do dono (2026-07-13), inspirado no concorrente Kaptar: busca de prospects por
nicho+região, num funil separado do CRM — só quando qualificado manualmente vira lead
de verdade.

- `supabase/migrations/0010_prospeccao.sql` — tabela `prospects` (dedup por
  `unique(tenant_id, place_id)`, status próprio: novo/contatado/qualificado/
  descartado/convertido), canal de aquisição template `prospeccao_ativa`, e o RPC
  `security definer` `convert_prospect_to_lead` (cria a linha em `leads` + marca o
  prospect como convertido, atômico). RLS: client só enxerga e muda status/notes
  (nunca `convertido` direto); insert é só via service role.
- `supabase/functions/prospeccao-buscar/` — Edge Function síncrona (sem fila/worker,
  diferente do Hub — aqui é só `fetch`): chama a **Places API (New)**
  (`places.googleapis.com/v1/places:searchText`, com `X-Goog-FieldMask` pra trazer
  telefone/site na mesma chamada, até 20 resultados), e pra cada resultado com site
  tenta extrair Instagram/LinkedIn do HTML público dele (regex, timeout de 6s por
  site, `Promise.allSettled` em paralelo, best-effort — nunca quebra a busca). Upsert
  em `prospects` via service role.
- Página `/prospeccao/:tenantId` (link "Prospecção" na sidebar, logo após CRM): form de
  busca (nicho + região), lista de prospects com filtro por status, `<select>` de
  status por prospect e botão "Converter em lead".

### Status (2026-07-13) — testado ponta a ponta, funcionando

Deploy feito direto pelo painel do Supabase (Dashboard → Edge Functions → Deploy a new
function → **Via Editor**, sem CLI — o ambiente onde isso foi implementado não tinha
Node.js instalado). Frontend publicado no Netlify (`netlify.toml` na raiz do repo, base
`sistema/`, redirect de SPA). Duas pegadinhas encontradas e corrigidas nesse processo,
relevantes pra qualquer Edge Function futura chamada pelo dashboard:

- **CORS: falta `x-client-info` no `Access-Control-Allow-Headers`.** O `supabase-js`
  manda esse header em toda chamada; sem ele na lista, o preflight (OPTIONS) responde
  204 normalmente mas o navegador bloqueia a chamada real (POST) com "No
  'Access-Control-Allow-Origin' header is present" — sintoma enganoso, parece erro de
  origin mas é header faltando. Corrigido em `prospeccao-buscar`, `hub-instagram-publish`
  e `invite-member`.
- **Google Places API: restrição de "HTTP referrer" na chave não funciona pra chamada
  server-side.** Chave criada com "Application restrictions: Websites" rejeita
  requisições da Edge Function com `Requests from referer <empty> are blocked` (a
  function não manda header Referer). Precisa "Application restrictions: None" +
  restringir só por **API restrictions** (Places API (New)).
- Deploy manual pelo editor do Supabase tem UI própria pra nome/slug da function — o
  campo de "renomear" depois de criada só muda o nome de exibição, não o slug real da
  rota (`/functions/v1/<slug>`). Se o nome ficar errado, é mais simples ajustar a
  chamada `supabase.functions.invoke(...)` no frontend pro slug real do que tentar
  renomear a function.

Migration `0010_prospeccao.sql` aplicada via SQL Editor do Supabase (sem CLI).

### Extensão — extração em massa até 1.000 leads (2026-07-13, aguardando deploy manual)

Pedido do dono no mesmo dia: uma barra pra controlar quantos leads extrair por busca,
até 1.000 (antes travava em ~20). A Google Places API só devolve ~60 resultados por
busca de texto simples — acima disso a busca deixa de ser síncrona e vira um job em
lote:

- `supabase/migrations/0011_prospeccao_lote.sql` — tabela `prospeccao_jobs` (grade de
  células `{lat, lng, radius_m}` gerada 1x, `next_cell_index`/`found_count` de
  progresso), coluna `job_id` nova em `prospects`, e um `cron.schedule` de 1 em 1 minuto
  chamando `prospeccao-worker` (mesmo padrão de `pg_cron` + `pg_net` + secret
  `dispatcher_secret` do motor de follow-up da Fase 3).
- `prospeccao-buscar` (editada): `target_count <= 60` continua síncrona (agora com
  paginação, até 3 páginas); `target_count > 60` geocodifica a região (**Geocoding API**,
  precisa habilitar essa API na mesma chave do Google, além da Places API (New)), gera
  uma grade de até 60 células e cria o job, respondendo na hora só com o `job_id`.
- `prospeccao-worker` (nova function) — chamada pelo cron, processa células da grade de
  um job por vez dentro de um orçamento de ~100s por execução, atualizando o progresso a
  cada célula. Termina quando bate o `target_count` ou esgota a grade.
- Frontend: slider de 20 a 1.000 na página de Prospecção; acima de 60 mostra uma barra de
  progresso (`found_count`/`target_count` + células processadas) que faz polling
  enquanto o job está `processing`.
- **As duas functions ficaram autocontidas (sem `_shared/`)** — o editor web do Supabase
  ("Via Editor") deploya uma function por vez, sem suporte a pasta compartilhada entre
  functions diferentes; a lógica da Places API/geocoding/grade está duplicada em
  `prospeccao-buscar/index.ts` e `prospeccao-worker/index.ts`.

**Pendente**: código no GitHub, mas o deploy manual ainda não foi confirmado —
falta habilitar a Geocoding API na chave, rodar a migration `0011`, atualizar
`prospeccao-buscar` com o código novo, e criar a function `prospeccao-worker` (com
verificação de JWT desligada, diferente das outras — quem chama é o `pg_cron`, não um
usuário logado). Ainda não testado ponta a ponta.

## Fase 2 — Hub/carrossel sai do worker local, vai pra nuvem (pronto e deployado, 2026-07-14)

Antes: "Gerar carrossel" no Hub só criava um job apontando pra uma pasta que já
precisava existir no disco (`marketing/conteudo/<pasta>/carrossel.html` + `render.js`),
criada rodando a skill `/carrossel` **interativamente com o Claude Code** — não
funcionava pra nenhum tenant real, só pro dono na própria máquina. Fluxo novo: o tenant
digita um tema, a IA escreve o texto (sem interação), o tenant revisa/edita e aprova, e
só então a imagem é renderizada — mantendo o mesmo checkpoint humano que a skill
`/carrossel` já tinha, sem precisar do Claude Code aberto.

- `supabase/migrations/0013_hub_carrossel_cloud.sql` — novo status
  `awaiting_approval` em `integration_hub_jobs`, entre `pending` e `processing`.
- `supabase/functions/hub-generate-carrossel/` — chamada pelo dashboard ao clicar
  "Gerar carrossel": Claude (`claude-opus-4-8`, tool use forçado, mesmo padrão de
  `extract-insights`) escreve 5-8 slides + legenda a partir do tema digitado, sem
  interação humana nessa etapa. Rate limit de `HUB_CARROSSEL_DAILY_LIMIT` (padrão 5)
  jobs por tenant a cada 24h. Salva como `status='awaiting_approval'`,
  `result.draft = { slides, caption }` — nenhuma imagem ainda.
- `supabase/functions/hub-render-carrossel/` — chamada quando o tenant aprova (com o
  texto possivelmente editado na tela): monta o HTML dos slides usando
  `companies.branding_json` (cor primária + logo, mesmo dado já usado no tema do
  dashboard desde a Fase 7 — cada tenant gera com a própria cara, não a da BK), manda
  pro `render-service` (abaixo) e sobe os PNGs pro bucket `hub-media` (mesmo de sempre).
- `render-service/` — serviço novo, **fora** do Supabase: container Playwright
  implantado no **Google Cloud Run** (escala a zero, só cobra quando renderiza). Existe
  porque Edge Functions (Deno Deploy) não têm Chromium — reaproveita a mesma lógica de
  screenshot que `marketing/conteudo/*/render.js` sempre usou (viewport 1080x1350,
  screenshot de cada `.slide`), só que como HTTP em vez de script CLI. Deploy e
  variáveis de ambiente documentados em `render-service/README.md`.
- `scripts/hub-worker.js` — deprecado, deixado só de referência histórica (nenhum job
  novo tem o shape `params.pasta` que ele espera).
- Frontend: `NewCarrosselJobDialog.tsx` pede um tema em vez de um caminho de pasta;
  `HubPage.tsx` mostra os slides gerados como texto editável (título/corpo/legenda) com
  botão "Aprovar e renderizar" enquanto `status='awaiting_approval'`.

### Escopo desta leva

Só carrossel de **texto puro** (`tipo='texto'`). Carrossel com foto IA (geração via
OpenAI, aprovação de foto — a skill `/carrossel` já suporta isso localmente) fica pra
uma próxima leva, mesmo padrão de escopo reduzido das Fases 5 e 8.

### Deploy (concluído 2026-07-14)

`render-service/` implantado no Cloud Run (região southamerica-east1, escala a zero) via
Developer Connect + GitHub — achado no processo: a versão do pacote `playwright` no
`package.json` precisa bater EXATAMENTE com a tag da imagem Docker
(`mcr.microsoft.com/playwright:v1.48.0-jammy`), senão o Chromium instalado não bate e o
`launch` falha ("Executable doesn't exist"); corrigido travando a versão em `1.48.0`
(sem `^`). Migrations `0008` (nunca tinha sido aplicada — pendência esquecida desde a
Fase 5), `0012` e `0013` aplicadas via SQL Editor. As duas functions deployadas via
"Via Editor". Secrets `RENDER_SERVICE_URL`/`RENDER_SERVICE_SECRET` configurados.

### Testado

`render-service` testado direto por curl (gera PNG de verdade). `hub-generate-carrossel`
testado pela tela: autenticação, permissão por role e rate limit funcionando — parou em
"Your credit balance is too low to access the Anthropic API" (mesmo bloqueio de crédito
já registrado na Fase 2 do WhatsApp, decisão do dono de deixar pro final). Fluxo completo
(aprovar draft → `hub-render-carrossel` → `render-service` → Storage) **ainda não
testado ponta a ponta** — depende de crédito na Anthropic pra gerar um draft primeiro.

## Fase 1 (auditoria) — reforço de RLS por role (pronto e aplicado, 2026-07-14)

Auditoria de RLS pedida pelo dono (2026-07-14) achou uma lacuna real: o schema define 4
papéis desde a Fase 0 (`tenant_admin`, `tenant_manager`, `tenant_agent`, `tenant_viewer`),
mas as policies de escrita de `leads`/`deals`/`payments`/`acquisition_channels` (0003) e
`agent_configs` (0004) liberavam qualquer membership `active`, sem olhar o role — o
comentário original da 0003 já registrava isso como pendência ("fica pra quando existir
mais de um usuário por tenant de verdade"), e isso passou a ser real desde o convite
self-service da Fase 7. `tenant_viewer` hoje escreve igual `tenant_admin`.

- `supabase/migrations/0012_role_write_restrictions.sql` — estende o Auth Hook com uma
  claim nova `tenant_roles` (mapa `tenant_id -> role`, mesmo padrão de `tenant_ids`/
  `is_platform_admin`), helper `jwt_tenant_role(tenant_id)`, e reaperta as policies de
  escrita de `leads`/`deals`/`payments`/`acquisition_channels`/`agent_configs` (mais
  `prospects_update_client` e `integration_hub_jobs_insert`, mesmo problema) pra excluir
  `tenant_viewer`. Isolamento de tenant (o que já existia) não muda — só a granularidade
  por role dentro do mesmo tenant.
- `supabase/checks/0012_role_write_restrictions_check.sql` — verificação manual (cola no
  SQL Editor do Supabase, roda numa transação com rollback, sem deixar dado de teste):
  confirma que `tenant_viewer` é bloqueado ao inserir lead e que `tenant_manager` continua
  funcionando.
- **Efeito colateral esperado, não é bug**: sessões já abertas antes desta migration não
  têm a claim `tenant_roles` ainda (só ganham num token reemitido — mesma ressalva já
  documentada na Fase 7 pra `tenant_ids`). O helper trata claim ausente como "não é
  viewer" de propósito, então ninguém perde acesso de escrita de repente; a restrição de
  fato passa a valer sessão por sessão, conforme o token for renovado (refresh automático
  em até 1h, ou no próximo login).

### Pendente

- Papéis ainda não têm UI pra trocar role de um membro ativo nem reenviar convite
  (mesma pendência já registrada na Fase 7).

## Fase 3 (parte 2) — botão "sincronizar agora" + mensagens de erro claras (pronto, pendente de deploy)

O motor de sincronização em si (`sync-ad-spend`, cron diário às 6h) já existia desde a
Fase 3 original. Faltava exatamente o que o dono pediu: um jeito de forçar a
sincronização na hora, e mensagens de erro que dissessem *por que* o gasto está zerado
(token expirado vs conta sem campanha conectada vs campanha pausada) em vez do genérico
"sem sincronização ainda".

- `supabase/functions/sync-ad-spend-now/` — mesma lógica de `sync-ad-spend` (porte de
  `scripts/lib/meta-ads-api.js`), mas autenticada por usuário (JWT normal do dashboard,
  checa role != tenant_viewer) e escopada a um tenant só — `sync-ad-spend` continua
  existindo pro cron, que sincroniza todos os tenants de uma vez e não pode expor o
  `DISPATCHER_SECRET` pro navegador. Distingue dois erros da Graph API que pareciam a
  mesma coisa mas não são: `code 190` (token de fato inválido/expirado — gerar um novo
  resolve) vs `type: OAuthException, code 200` ("API access blocked" — o token está
  certo, quem está sem acesso aprovado à Marketing API é o **App**; gerar token novo não
  resolve, só a verificação de empresa da Meta libera). Detecta tenant sem
  `ad_account_connections` e avisa em vez de só devolver zero.
- `src/pages/financeiro/FinanceiroPage.tsx` — botão "Sincronizar agora" ao lado de
  "Gasto de tráfego por dia", mostra sucesso/erro inline e invalida a query
  (`financeiro-ad-spend`) — a Visão Geral usa a mesma query key, então também atualiza.
- Autocontida (sem `_shared/`), mesmo padrão de `prospeccao-buscar`/`hub-render-carrossel`.

### Testado ponta a ponta (2026-07-14) — achado real

Token do WhatsApp renovado (permanente, via System User `bkads`). Ao testar
"Sincronizar agora" pela primeira vez, apareceu "token expirado" — só que testando o
mesmo token direto por curl contra a Graph API, o erro real era `{"type":
"OAuthException","code":200,"message":"API access blocked."}`, não `code 190`. Ou seja:
o token estava certo, o bloqueio é o **App** não ter acesso aprovado à Marketing API —
mesmo bloqueio de fundo que já impedia criar o objeto do anúncio, ligado à verificação
de empresa da Meta (iniciada 2026-07-07, estimativa até 2026-07-21, **ainda não
aprovada**). A function classificava qualquer `OAuthException` como token expirado;
corrigido pra diferenciar os dois casos e apontar a causa certa.

### Pendente

1. Verificação de empresa da Meta aprovar — sem isso a Marketing API continua
   bloqueada pro App e a campanha real (`120246235146860014`) continua `PAUSED`, sem
   gasto de verdade pra sincronizar (o botão funciona, mas mostra zero até lá).

## Rodando localmente

```bash
npm install
npm run dev
```

## Próximas fases

Ver roadmap completo no plano. Em ordem: CRM manual (pronto) → WhatsApp sandbox + agente de IA
(pronto, aguardando crédito) → follow-up + dashboard financeiro (pronto) → cérebro coletivo/RAG
(pronto, aguardando chave da Voyage) → hub de integrações do MazyOS (pronto, aguardando
credenciais do Meta) → corte pro WhatsApp real (bloqueado, aguardando verificação da Meta) →
white-label multi-tenant completo (convite self-service + branding prontos; Embedded Signup do
WhatsApp, OAuth de ads e billing de verdade seguem pendentes) → prospecção (pronto e
testado ponta a ponta em produção, 2026-07-13).
