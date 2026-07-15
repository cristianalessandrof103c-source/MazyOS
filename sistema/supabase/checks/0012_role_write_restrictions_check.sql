-- Verificação manual da migration 0012 — cola isto inteiro no SQL Editor do Supabase
-- (dashboard do projeto, depois de aplicar 0012_role_write_restrictions.sql) e roda de
-- uma vez. Não precisa de Node/CLI. Tudo roda dentro de uma transação com rollback no
-- final, então não deixa nenhum dado de teste no banco (nem no `rollback` implícito se
-- o script for interrompido no meio por um erro inesperado — o editor do Supabase não
-- faz commit parcial de uma query só).
--
-- O que confirma:
--   1. tenant_viewer NÃO consegue inserir lead (RLS bloqueia).
--   2. tenant_manager CONSEGUE inserir lead (não quebrou quem devia continuar escrevendo).
--
-- Leia o resultado na aba "Messages" do SQL Editor: "OK: ..." = passou. Se aparecer
-- "FALHOU: ..." como erro, a migration não fez o que deveria — não aplique em produção
-- sem investigar antes.

begin;

insert into public.companies (id, name, slug)
values ('00000000-0000-0000-0000-0000000000f1', '__rls_check__', '__rls_check__')
on conflict (id) do nothing;

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000f2', 'viewer@__rls_check__.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'manager@__rls_check__.test')
on conflict (id) do nothing;

insert into public.memberships (user_id, tenant_id, role, status, accepted_at)
values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'tenant_viewer', 'active', now()),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1', 'tenant_manager', 'active', now());

-- ============================================================
-- 1. Sessão simulada do tenant_viewer — insert de lead deve ser bloqueado por RLS.
-- ============================================================
set local role authenticated;
set local request.jwt.claims = '{
  "sub": "00000000-0000-0000-0000-0000000000f2",
  "tenant_ids": ["00000000-0000-0000-0000-0000000000f1"],
  "tenant_roles": {"00000000-0000-0000-0000-0000000000f1": "tenant_viewer"},
  "is_platform_admin": false
}';

do $$
begin
  insert into public.leads (tenant_id, full_name, stage_id)
  values (
    '00000000-0000-0000-0000-0000000000f1',
    'lead do viewer',
    (select id from public.pipeline_stages where category = 'new' and tenant_id is null limit 1)
  );
  raise exception 'FALHOU: tenant_viewer conseguiu inserir lead (RLS não bloqueou)';
exception
  when insufficient_privilege then
    raise notice 'OK: tenant_viewer bloqueado ao inserir lead (esperado)';
end $$;

-- ============================================================
-- 2. Sessão simulada do tenant_manager — insert de lead deve continuar funcionando.
-- ============================================================
set local request.jwt.claims = '{
  "sub": "00000000-0000-0000-0000-0000000000f3",
  "tenant_ids": ["00000000-0000-0000-0000-0000000000f1"],
  "tenant_roles": {"00000000-0000-0000-0000-0000000000f1": "tenant_manager"},
  "is_platform_admin": false
}';

do $$
begin
  insert into public.leads (tenant_id, full_name, stage_id)
  values (
    '00000000-0000-0000-0000-0000000000f1',
    'lead do manager',
    (select id from public.pipeline_stages where category = 'new' and tenant_id is null limit 1)
  );
  raise notice 'OK: tenant_manager conseguiu inserir lead (esperado)';
end $$;

rollback;
