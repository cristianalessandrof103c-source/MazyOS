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

## Fase 2 — WhatsApp sandbox + agente de IA (código pronto, falta setup de conta)

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

### O que falta você fazer (precisa de conta — não dá pra automatizar)

1. **Número de teste do WhatsApp Cloud API**: no [Meta for Developers](https://developers.facebook.com/apps),
   dentro do App já usado pro Meta Ads, adicione o produto **WhatsApp** → use o número de teste
   que a Meta gera automaticamente (ou o seu, se já tiver linkado) → em "Configuração da API",
   copie o **Phone number ID**, o **WhatsApp Business Account ID** e gere um **token de acesso
   temporário** (válido por 24h — dá pra trocar por um permanente depois, via System User, igual
   foi feito pro Meta Ads).
2. **Cadastrar o número de teste do destinatário**: ainda em "Configuração da API", adicione seu
   próprio WhatsApp como número de destinatário de teste (a Meta manda um código de verificação).
3. **Registrar a conexão no banco** (SQL Editor do Supabase ou `psql`):
   ```sql
   insert into public.whatsapp_connections (tenant_id, phone_number_id, business_account_id, status)
   values ('d0e67a29-acc1-4f08-873f-7428955242f2', 'SEU_PHONE_NUMBER_ID', 'SEU_WABA_ID', 'test');
   ```
4. **Configurar os secrets da Edge Function** (`npx supabase secrets set` dentro de `sistema/`,
   depois de `npx supabase login` e `npx supabase link --project-ref tblumyuozhysncscktrk`):
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase secrets set WHATSAPP_TEST_ACCESS_TOKEN=<token temporario do passo 1>
   npx supabase secrets set WHATSAPP_APP_SECRET=<App Secret, em Configurações do App > Básico>
   npx supabase secrets set WHATSAPP_VERIFY_TOKEN=<qualquer string secreta que você escolher>
   ```
5. **Deploy da função**: `npx supabase functions deploy whatsapp-webhook`
6. **Registrar o webhook na Meta**: em WhatsApp > Configuração, campo "Retorno de chamada"
   (Callback URL) cole `https://tblumyuozhysncscktrk.supabase.co/functions/v1/whatsapp-webhook` e
   em "Verificar token" cole o mesmo valor de `WHATSAPP_VERIFY_TOKEN` do passo 4. Depois, inscreva
   o campo de webhook `messages`.
7. **Testar**: manda uma mensagem pro número de teste pelo WhatsApp do seu celular cadastrado no
   passo 2. A resposta do agente deve chegar em segundos, e a conversa aparece no botão "Ver
   conversa" do lead correspondente no CRM.

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
