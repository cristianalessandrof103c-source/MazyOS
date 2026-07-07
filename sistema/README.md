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

## Rodando localmente

```bash
npm install
npm run dev
```

## Próximas fases

Ver roadmap completo no plano. Em ordem: CRM manual (pronto) → WhatsApp sandbox + agente de IA
(código pronto, aguardando setup de conta) → follow-up + dashboard financeiro → cérebro coletivo
(RAG) → hub de integrações do MazyOS → corte pro WhatsApp real → white-label multi-tenant
completo.
