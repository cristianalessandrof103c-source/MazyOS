-- Fase 1 (auditoria de RLS) — lacuna encontrada: o schema define 4 papéis desde a Fase 0
-- (tenant_admin, tenant_manager, tenant_agent, tenant_viewer), mas as policies de escrita
-- de leads/deals/payments/acquisition_channels (0003) e agent_configs (0004) liberam
-- qualquer membership 'active', sem olhar o role — o comentário original dizia
-- "fica pra quando existir mais de um usuário por tenant de verdade", e isso já é real
-- desde a Fase 7 (convite self-service). tenant_viewer hoje escreve igual tenant_admin.
-- Estende também prospects_update_client (0010) e integration_hub_jobs_insert (0008),
-- que têm o mesmo problema.

-- ============================================================
-- 1. Auth Hook: adiciona claim tenant_roles (mapa tenant_id -> role), mesmo padrão de
--    tenant_ids/is_platform_admin da Fase 0. Sem isso, cada policy de escrita precisaria
--    de subquery em memberships por linha (o que a Fase 0 evitou de propósito).
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
  tenant_roles jsonb;
  is_admin boolean;
  uid uuid := (event ->> 'user_id')::uuid;
begin
  select coalesce(array_agg(tenant_id), '{}'::uuid[])
    into tenant_ids
  from public.memberships
  where user_id = uid and status = 'active';

  select coalesce(jsonb_object_agg(tenant_id::text, role), '{}'::jsonb)
    into tenant_roles
  from public.memberships
  where user_id = uid and status = 'active';

  select exists (select 1 from public.platform_admins where user_id = uid)
    into is_admin;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{tenant_ids}', to_jsonb(tenant_ids));
  claims := jsonb_set(claims, '{tenant_roles}', tenant_roles);
  claims := jsonb_set(claims, '{is_platform_admin}', to_jsonb(is_admin));

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- ============================================================
-- 2. Helper — lê o papel do usuário nesse tenant direto do JWT (sem round-trip no banco).
--    coalesce(..., '') em vez de assumir null = viewer: uma sessão aberta antes desta
--    migration ainda não tem a claim tenant_roles (só ganha num token reemitido — mesma
--    ressalva já documentada pra tenant_ids na Fase 7). Tratar null como "não é viewer"
--    evita bloquear quem já está logado até o refresh automático (até 1h) ou próximo login;
--    a restrição de fato passa a valer pra cada sessão assim que o token for reemitido.
-- ============================================================
create or replace function public.jwt_tenant_role(p_tenant_id uuid)
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'tenant_roles' ->> p_tenant_id::text, '');
$$;

-- ============================================================
-- 3. Aperta as policies de escrita: tenant_viewer nunca escreve, só lê (policies de select
--    não mudam). Postgres não tem "alter policy ... using", precisa dropar e recriar.
-- ============================================================
drop policy "acquisition_channels_write" on public.acquisition_channels;
create policy "acquisition_channels_write" on public.acquisition_channels
  for all using (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );

drop policy "leads_write" on public.leads;
create policy "leads_write" on public.leads
  for all using (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );

drop policy "deals_write" on public.deals;
create policy "deals_write" on public.deals
  for all using (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );

drop policy "payments_write" on public.payments;
create policy "payments_write" on public.payments
  for all using (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );

drop policy "agent_configs_write" on public.agent_configs;
create policy "agent_configs_write" on public.agent_configs
  for all using (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );

drop policy "prospects_update_client" on public.prospects;
create policy "prospects_update_client" on public.prospects
  for update using (
    ((tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
      or public.is_platform_admin())
    and status <> 'convertido'
  )
  with check (
    ((tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
      or public.is_platform_admin())
    and status <> 'convertido'
    and converted_lead_id is null
  );

drop policy "integration_hub_jobs_insert" on public.integration_hub_jobs;
create policy "integration_hub_jobs_insert" on public.integration_hub_jobs
  for insert with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );
