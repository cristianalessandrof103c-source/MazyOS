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

## Rodando localmente

```bash
npm install
npm run dev
```

## Próximas fases

Ver roadmap completo no plano. Em ordem: CRM manual (pronto) → WhatsApp sandbox + agente de IA
(pronto, aguardando crédito) → follow-up + dashboard financeiro (pronto) → cérebro coletivo/RAG
(pronto, aguardando chave da Voyage) → hub de integrações do MazyOS → corte pro WhatsApp real →
white-label multi-tenant completo.
