-- Fase 0 — Auth Hook (injeta tenant_ids/is_platform_admin no JWT) e políticas de RLS
-- que fazem o isolamento multi-tenant na camada de dados.

-- ============================================================
-- Custom Access Token Hook
-- Precisa ser habilitado manualmente em Authentication > Hooks no dashboard
-- (ou em supabase/config.toml -> [auth.hook.custom_access_token] pra dev local).
--
-- security definer é obrigatório aqui: o hook roda como supabase_auth_admin, que
-- não tem sessão/JWT ainda (é literalmente o que está sendo criado), então as
-- policies de RLS de memberships/platform_admins (que dependem de auth.jwt())
-- bloqueariam a leitura e sempre devolveriam listas vazias. security definer faz
-- a função rodar com o dono (postgres), que ignora RLS nessas tabelas.
-- ============================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  claims jsonb;
  tenant_ids uuid[];
  is_admin boolean;
  uid uuid := (event ->> 'user_id')::uuid;
begin
  select coalesce(array_agg(tenant_id), '{}'::uuid[])
    into tenant_ids
  from public.memberships
  where user_id = uid and status = 'active';

  select exists (select 1 from public.platform_admins where user_id = uid)
    into is_admin;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{tenant_ids}', to_jsonb(tenant_ids));
  claims := jsonb_set(claims, '{is_platform_admin}', to_jsonb(is_admin));

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- supabase_auth_admin precisa poder chamar a função e ler as tabelas usadas nela.
-- Ninguém mais deveria poder chamar essa função diretamente.
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

grant select on public.memberships to supabase_auth_admin;
grant select on public.platform_admins to supabase_auth_admin;

-- ============================================================
-- Helpers de RLS — leem os claims já injetados no JWT (sem subquery por linha)
-- ============================================================
create function public.jwt_tenant_ids()
returns uuid[]
language sql
stable
as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(auth.jwt() -> 'tenant_ids')))::uuid[],
    '{}'::uuid[]
  );
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_platform_admin')::boolean, false);
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_admins enable row level security;
alter table public.pipeline_stages enable row level security;

create policy "companies_select" on public.companies
  for select using (
    id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "profiles_select_self" on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());

create policy "memberships_select" on public.memberships
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "platform_admins_select" on public.platform_admins
  for select using (public.is_platform_admin());

create policy "pipeline_stages_select" on public.pipeline_stages
  for select using (
    tenant_id is null
    or tenant_id = any (public.jwt_tenant_ids())
    or public.is_platform_admin()
  );
