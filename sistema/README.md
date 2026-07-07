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

## Rodando localmente

```bash
npm install
npm run dev
```

## Próximas fases

Ver roadmap completo no plano. Em ordem: CRM manual → WhatsApp sandbox + agente de IA →
follow-up + dashboard financeiro → cérebro coletivo (RAG) → hub de integrações do MazyOS →
corte pro WhatsApp real → white-label multi-tenant completo.
