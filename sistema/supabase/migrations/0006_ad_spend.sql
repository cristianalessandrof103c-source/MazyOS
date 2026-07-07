-- Fase 3 (parte 2) — dashboard financeiro: conexão com a conta de anúncios e
-- snapshot diário de gasto/resultado, sincronizado via Edge Function
-- sync-ad-spend (porta de scripts/lib/meta-ads-api.js). CAC e atribuição de
-- receita usam isso junto com leads/acquisition_channels/deals/payments, que
-- já existem desde a Fase 1.

create table public.ad_account_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  provider text not null default 'meta' check (provider in ('meta')),
  external_account_id text not null,
  campaign_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on column public.ad_account_connections.campaign_ids is
  'Campanhas a sincronizar. O token de acesso fica como secret da Edge Function (META_ADS_ACCESS_TOKEN) — OAuth por tenant é Fase 7 (white-label).';

create table public.ad_spend_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  campaign_id text not null,
  date date not null,
  spend_cents bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  results_count int not null default 0,
  cpa_cents bigint,
  created_at timestamptz not null default now(),
  unique (tenant_id, campaign_id, date)
);

insert into public.ad_account_connections (tenant_id, provider, external_account_id, campaign_ids) values
  ('d0e67a29-acc1-4f08-873f-7428955242f2', 'meta', '1928356298123181', array['120246235146860014']);

alter table public.ad_account_connections enable row level security;
alter table public.ad_spend_snapshots enable row level security;

create policy "ad_account_connections_select" on public.ad_account_connections
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "ad_spend_snapshots_select" on public.ad_spend_snapshots
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

select cron.schedule(
  'sync-ad-spend-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://tblumyuozhysncscktrk.supabase.co/functions/v1/sync-ad-spend',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
