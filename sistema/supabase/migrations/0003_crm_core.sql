-- Fase 1 — CRM manual: canais de aquisição, leads, vendas (deals) e pagamentos.

-- ============================================================
-- acquisition_channels (tenant_id nulo = template padrão, igual pipeline_stages)
-- ============================================================
create table public.acquisition_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.companies (id) on delete cascade,
  code text not null,
  label text not null,
  category text not null check (category in ('direct', 'referral', 'paid', 'organic')),
  created_at timestamptz not null default now()
);

comment on table public.acquisition_channels is
  'Extensível sem migração: cada tenant pode adicionar linhas próprias além do template padrão (tenant_id nulo).';

insert into public.acquisition_channels (tenant_id, code, label, category) values
  (null, 'direct_contact', 'Contato direto', 'direct'),
  (null, 'phone_call', 'Ligação', 'direct'),
  (null, 'referral', 'Indicação', 'referral'),
  (null, 'paid_traffic_meta', 'Tráfego pago - Meta Ads', 'paid');

-- ============================================================
-- leads
-- ============================================================
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  full_name text not null,
  phone_number text,
  email text,
  acquisition_channel_id uuid references public.acquisition_channels (id),
  stage_id uuid not null references public.pipeline_stages (id),
  assigned_to uuid references auth.users (id),
  whatsapp_contact_id text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- deals (vendas)
-- ============================================================
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  value_cents bigint not null default 0,
  acquisition_channel_id uuid references public.acquisition_channels (id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column public.deals.acquisition_channel_id is
  'Canal capturado no fechamento — pode divergir do canal original do lead.';

-- ============================================================
-- payments
-- ============================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,
  due_date date,
  paid_at timestamptz,
  amount_cents bigint not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS — mesmo padrão de isolamento por tenant_id usado na Fase 0.
-- Escrita liberada pra qualquer membro ativo do tenant por enquanto;
-- restrição por role (ex.: tenant_viewer só leitura) fica pra quando
-- existir mais de um usuário por tenant de verdade.
-- ============================================================
alter table public.acquisition_channels enable row level security;
alter table public.leads enable row level security;
alter table public.deals enable row level security;
alter table public.payments enable row level security;

create policy "acquisition_channels_select" on public.acquisition_channels
  for select using (
    tenant_id is null
    or tenant_id = any (public.jwt_tenant_ids())
    or public.is_platform_admin()
  );

create policy "acquisition_channels_write" on public.acquisition_channels
  for all using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  )
  with check (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "leads_select" on public.leads
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "leads_write" on public.leads
  for all using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  )
  with check (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "deals_select" on public.deals
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "deals_write" on public.deals
  for all using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  )
  with check (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "payments_select" on public.payments
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "payments_write" on public.payments
  for all using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  )
  with check (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );
