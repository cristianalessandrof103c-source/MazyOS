-- Fase 0 — fundação multi-tenant: tenants, perfis, memberships, admin de plataforma
-- e o template padrão de estágios de pipeline (compartilhado entre tenants).

create extension if not exists "pgcrypto";

-- ============================================================
-- companies (tenants)
-- ============================================================
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_tier text not null default 'trial',
  status text not null default 'active' check (status in ('trial', 'active', 'suspended')),
  branding_json jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

comment on column public.companies.branding_json is
  'Cor/logo/fontes do tenant. Vazio = herda o tema dark-tech default do dashboard.';

-- ============================================================
-- profiles (espelha auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- memberships (usuário <-> tenant, com papel)
-- ============================================================
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.companies (id) on delete cascade,
  role text not null check (role in ('tenant_admin', 'tenant_manager', 'tenant_agent', 'tenant_viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id)
);

-- ============================================================
-- platform_admins (equipe BK — enxerga todos os tenants)
-- ============================================================
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ============================================================
-- pipeline_stages (tenant_id nulo = template padrão da plataforma)
-- ============================================================
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.companies (id) on delete cascade,
  name text not null,
  order_index int not null,
  category text not null check (category in ('new', 'in_progress', 'won', 'lost', 'customer_success')),
  created_at timestamptz not null default now()
);

comment on column public.pipeline_stages.category is
  'Dirige automação (follow-up, dashboards), independente do rótulo customizado por tenant.';

insert into public.pipeline_stages (tenant_id, name, order_index, category) values
  (null, 'Novo lead', 0, 'new'),
  (null, 'Em conversa', 1, 'in_progress'),
  (null, 'Fechado - ganho', 2, 'won'),
  (null, 'Fechado - perdido', 3, 'lost'),
  (null, 'Pós-venda', 4, 'customer_success');
