-- Fase 8 (extensão) — extração em massa na Prospecção (até 1.000 leads). A Google
-- Places API só devolve ~60 resultados por busca de texto simples; pra ir além disso a
-- região é subdividida numa grade de círculos, processada aos poucos por um worker
-- chamado por pg_cron (mesmo padrão do motor de follow-up da Fase 3).

create table public.prospeccao_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  niche text not null,
  region text not null,
  target_count int not null,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  grid_cells jsonb not null default '[]'::jsonb,
  next_cell_index int not null default 0,
  found_count int not null default 0,
  error text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.prospeccao_jobs.grid_cells is
  'Grade de sub-áreas (círculos: lat, lng, radius_m) cobrindo a região geocodificada, calculada 1x na criação do job. O worker consome uma célula por vez a partir de next_cell_index.';

alter table public.prospects add column job_id uuid references public.prospeccao_jobs (id) on delete set null;

alter table public.prospeccao_jobs enable row level security;

create policy "prospeccao_jobs_select" on public.prospeccao_jobs
  for select using (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin());

-- Sem policy de insert/update: só a Edge Function (service role) cria/avança o job.

select cron.schedule(
  'prospeccao-worker-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://tblumyuozhysncscktrk.supabase.co/functions/v1/prospeccao-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
