-- Fase 9 — Disparo em massa via WhatsApp Template + importação de contatos via CSV.
-- Lista de contatos é separada do funil de CRM (leads/prospects) por decisão do dono —
-- não vira lead automaticamente. Disparo real depende de um Template aprovado pela
-- Meta, que ainda não existe (ver README) — o código assume `type: 'template'` desde já.

-- ============================================================
-- whatsapp_connections: teto de envio (proteção contra estourar messaging tier da Meta)
-- ============================================================
alter table public.whatsapp_connections
  add column daily_send_cap int not null default 200;

comment on column public.whatsapp_connections.daily_send_cap is
  'Teto de mensagens de broadcast nas últimas 24h (janela rolante, não "por dia calendário")
   nessa conexão — proteção contra estourar o messaging tier da Meta (250/1K/10K/100K
   conforme histórico do número). Ajustar via SQL Editor conforme o tier real for conhecido;
   sem UI de propósito, mesmo padrão dos outros campos dessa tabela.';

-- ============================================================
-- broadcast_lists
-- ============================================================
create table public.broadcast_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  extra_field_keys text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on column public.broadcast_lists.extra_field_keys is
  'União das colunas extras (fora nome/telefone) já vistas em qualquer import feito nessa
   lista — populada por broadcast-import-contacts. Usada só pra montar os dropdowns de
   variable_mapping na criação de campanha, sem precisar inspecionar contacts no client.';

-- ============================================================
-- broadcast_contacts — escrita só via service role (broadcast-import-contacts),
-- pra centralizar normalização de telefone e dedup em lote.
-- ============================================================
create table public.broadcast_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  list_id uuid not null references public.broadcast_lists (id) on delete cascade,
  full_name text not null,
  phone_number text not null,
  opted_out boolean not null default false,
  extra_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (list_id, phone_number),
  constraint broadcast_contacts_phone_format check (phone_number ~ '^[0-9]{8,15}$')
);

comment on column public.broadcast_contacts.phone_number is
  'Dígitos com código do país, SEM "+" (ex.: 5541991234567) — mesmo formato que
  whatsapp-webhook já grava em leads.phone_number a partir de waMessage.from, e que
  enviarMensagemTexto já manda direto pro campo "to" sem reformatar.';

comment on column public.broadcast_contacts.opted_out is
  'Sem UI de toggle no MVP — ajustar via SQL Editor. Excluído do fan-out de campanha.';

-- ============================================================
-- broadcast_campaigns
-- ============================================================
create table public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  list_id uuid not null references public.broadcast_lists (id) on delete restrict,
  whatsapp_connection_id uuid not null references public.whatsapp_connections (id) on delete restrict,
  name text not null,
  template_name text not null,
  template_language text not null default 'pt_BR',
  variable_mapping jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'sending', 'paused', 'done', 'failed')),
  total_recipients int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

comment on column public.broadcast_campaigns.variable_mapping is
  'Array ordenado de chaves, na ordem das variáveis {{1}}, {{2}}... do Template aprovado.
   "full_name" é um valor especial (nome do contato); qualquer outra string busca em
   broadcast_contacts.extra_fields->>chave. Ex.: ["full_name", "plano"] -> {{1}}=nome,
   {{2}}=extra_fields.plano. Sem UI de mapeamento arrasta-solta no MVP.';

comment on column public.broadcast_campaigns.total_recipients is
  'Snapshot gravado 1x por start_broadcast_campaign() no início do envio — não é um
   contador mutável. sent_count/failed_count NÃO existem como coluna: calculados ao vivo
   via group by em broadcast_campaign_recipients (evita race condition de incremento
   concorrente entre execuções do dispatcher).';

-- Serializa disparo por conexão: no máximo 1 campanha "sending" por whatsapp_connection_id
-- ao mesmo tempo, resolvido atomicamente pelo próprio banco (evita 2 campanhas brigando
-- pelo rate limit/tier da mesma conexão, e fecha a race de duplo-clique em "Iniciar").
create unique index broadcast_campaigns_one_sending_per_connection
  on public.broadcast_campaigns (whatsapp_connection_id)
  where status = 'sending';

-- ============================================================
-- broadcast_campaign_recipients — escrita só via service role/RPC.
-- Snapshot de phone_number/full_name/extra_fields no momento do fan-out (sobrevive a
-- edição/exclusão do contato original — contact_id é on delete set null de propósito).
-- ============================================================
create table public.broadcast_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  campaign_id uuid not null references public.broadcast_campaigns (id) on delete cascade,
  whatsapp_connection_id uuid not null references public.whatsapp_connections (id) on delete cascade,
  contact_id uuid references public.broadcast_contacts (id) on delete set null,
  phone_number text not null,
  full_name text not null,
  extra_fields jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  whatsapp_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

comment on column public.broadcast_campaign_recipients.whatsapp_connection_id is
  'Denormalizado do campaign no momento do fan-out — evita subquery/join só pra checar o
   teto rolante de 24h (daily_send_cap) da conexão a cada tick do dispatcher.';

create index broadcast_campaign_recipients_campaign_status_idx
  on public.broadcast_campaign_recipients (campaign_id, status);

create index broadcast_campaign_recipients_connection_sent_idx
  on public.broadcast_campaign_recipients (whatsapp_connection_id, sent_at)
  where status = 'sent';

-- ============================================================
-- RPC 1 — fan-out atômico draft -> sending. security definer porque PostgREST não
-- expressa "insert ... select de outra tabela"; feito como statement SQL único.
-- Só chamável por service_role (Edge Function broadcast-campaign-control já valida
-- tenant_admin/platform_admin antes de invocar) — nunca diretamente pelo client.
-- ============================================================
create or replace function public.start_broadcast_campaign(p_campaign_id uuid)
returns table (recipients_created int, campaign_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign record;
  v_inserted int;
begin
  select * into v_campaign from public.broadcast_campaigns where id = p_campaign_id for update;

  if not found then
    raise exception 'Campanha % não encontrada', p_campaign_id;
  end if;

  if v_campaign.status = 'sending' then
    -- idempotente: chamada duplicada (retry de rede, duplo clique já em voo) não reprocessa.
    return query select v_campaign.total_recipients, v_campaign.status;
    return;
  end if;

  if v_campaign.status <> 'draft' then
    raise exception 'Campanha só pode iniciar a partir de draft (status atual: %)', v_campaign.status;
  end if;

  insert into public.broadcast_campaign_recipients
    (campaign_id, tenant_id, whatsapp_connection_id, contact_id, phone_number, full_name, extra_fields, status)
  select v_campaign.id, v_campaign.tenant_id, v_campaign.whatsapp_connection_id, bc.id,
         bc.phone_number, bc.full_name, bc.extra_fields, 'pending'
  from public.broadcast_contacts bc
  where bc.list_id = v_campaign.list_id and not bc.opted_out
  on conflict (campaign_id, contact_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    raise exception 'Lista sem contatos válidos (vazia ou todos marcados opted_out)';
  end if;

  -- Estoura unique_violation (23505) se outra campanha já estiver "sending" nessa
  -- mesma conexão — a Edge Function traduz isso pra um 409 amigável.
  update public.broadcast_campaigns
    set status = 'sending', total_recipients = v_inserted, started_at = now()
    where id = v_campaign.id and status = 'draft';

  return query select v_inserted, 'sending'::text;
end;
$$;

revoke all on function public.start_broadcast_campaign(uuid) from public;
grant execute on function public.start_broadcast_campaign(uuid) to service_role;

-- ============================================================
-- RPC 2 — reivindica um lote de destinatários atomicamente (FOR UPDATE SKIP LOCKED).
-- Evita 2 execuções sobrepostas do cron pegarem a mesma linha, e recupera linhas presas
-- em "sending" por crash no meio do processamento (mais de 5min = considera órfã).
-- ============================================================
create or replace function public.claim_broadcast_recipients(p_campaign_id uuid, p_limit int)
returns setof public.broadcast_campaign_recipients
language sql
security definer
set search_path = public
as $$
  update public.broadcast_campaign_recipients
  set status = 'sending', updated_at = now()
  where id in (
    select id from public.broadcast_campaign_recipients
    where campaign_id = p_campaign_id
      and (status = 'pending' or (status = 'sending' and updated_at < now() - interval '5 minutes'))
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
$$;

revoke all on function public.claim_broadcast_recipients(uuid, int) from public;
grant execute on function public.claim_broadcast_recipients(uuid, int) to service_role;

-- ============================================================
-- RLS — mesmo padrão pós-0012 (jwt_tenant_role <> 'tenant_viewer' em toda escrita nova).
-- ============================================================
alter table public.broadcast_lists enable row level security;
alter table public.broadcast_contacts enable row level security;
alter table public.broadcast_campaigns enable row level security;
alter table public.broadcast_campaign_recipients enable row level security;

create policy "broadcast_lists_select" on public.broadcast_lists
  for select using (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin());

create policy "broadcast_lists_write" on public.broadcast_lists
  for all using (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
    or public.is_platform_admin()
  );

create policy "broadcast_contacts_select" on public.broadcast_contacts
  for select using (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin());
-- Sem policy de insert/update/delete: só a Edge Function (service role) escreve.

create policy "broadcast_campaigns_select" on public.broadcast_campaigns
  for select using (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin());

-- Escrita direta do client só enquanto ainda é draft — start/pause/resume sempre via
-- Edge Function (service role, que ignora RLS), nunca por update direto do dashboard.
create policy "broadcast_campaigns_write_draft" on public.broadcast_campaigns
  for all using (
    status = 'draft'
    and ((tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
      or public.is_platform_admin())
  )
  with check (
    status = 'draft'
    and ((tenant_id = any (public.jwt_tenant_ids()) and public.jwt_tenant_role(tenant_id) <> 'tenant_viewer')
      or public.is_platform_admin())
  );

create policy "broadcast_campaign_recipients_select" on public.broadcast_campaign_recipients
  for select using (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin());
-- Sem policy de escrita: só service role (dispatcher + RPCs security definer).

-- ============================================================
-- Cron do dispatcher — mesmo padrão de prospeccao-worker-tick (0011), reaproveitando o
-- secret já guardado no Vault (dispatcher_secret). Só passa a fazer algo depois que a
-- Edge Function broadcast-dispatcher for deployada (ver checklist manual no plano).
-- ============================================================
select cron.schedule(
  'broadcast-dispatcher-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://tblumyuozhysncscktrk.supabase.co/functions/v1/broadcast-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
