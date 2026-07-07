-- Fase 3 (parte 1) — motor de follow-up: sequências, gatilhos de cancelamento/
-- enfileiramento, scan periódico de conversas paradas. O envio de verdade
-- roda na Edge Function follow-up-dispatcher, chamada por pg_cron via pg_net.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ============================================================
-- follow_up_sequences / follow_up_sequence_steps
-- (tenant_id nulo = sequência padrão da plataforma, mesmo padrão de
-- pipeline_stages/acquisition_channels)
-- ============================================================
create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.companies (id) on delete cascade,
  trigger_event text not null check (trigger_event in ('lead_no_response', 'deal_won', 'deal_lost')),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.follow_up_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.follow_up_sequences (id) on delete cascade,
  step_order int not null,
  delay_hours int not null,
  message_template text not null,
  created_at timestamptz not null default now(),
  unique (sequence_id, step_order)
);

comment on column public.follow_up_sequence_steps.delay_hours is
  'Horas após o passo anterior (o passo 1 conta a partir do evento gatilho: última mensagem do lead, venda ganha ou perdida).';

comment on column public.follow_up_sequence_steps.message_template is
  'Suporta {{lead_name}} e {{company_name}} — substituídas pelo dispatcher antes de enviar.';

-- ============================================================
-- follow_up_jobs — estender pra sequências (Fase 2 só tinha note/scheduled_for ad-hoc)
-- ============================================================
alter table public.follow_up_jobs
  add column sequence_id uuid references public.follow_up_sequences (id) on delete cascade,
  add column step_id uuid references public.follow_up_sequence_steps (id) on delete cascade,
  add column conversation_id uuid references public.conversations (id) on delete cascade;

alter table public.follow_up_jobs alter column note drop not null;

comment on column public.follow_up_jobs.note is
  'Preenchido pela tool agendar_followup (job ad-hoc, sem sequence_id — o dispatcher trata como alerta pro humano, não manda mensagem sozinho). Jobs de sequência usam sequence_id/step_id e note fica nulo.';

-- ============================================================
-- Trigger: venda ganha/perdida cancela lead_no_response pendente e enfileira
-- o primeiro passo da sequência deal_won/deal_lost (da conta do tenant, ou a
-- padrão da plataforma se o tenant não tiver a própria).
-- ============================================================
create function public.handle_deal_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_trigger_event text;
  v_sequence_id uuid;
  v_step_id uuid;
  v_delay_hours int;
  v_conversation_id uuid;
begin
  if new.status = old.status or new.status not in ('won', 'lost') then
    return new;
  end if;

  update public.follow_up_jobs
    set status = 'canceled'
    where lead_id = new.lead_id
      and status = 'pending'
      and sequence_id in (select id from public.follow_up_sequences where trigger_event = 'lead_no_response');

  v_trigger_event := case when new.status = 'won' then 'deal_won' else 'deal_lost' end;

  select s.id, st.id, st.delay_hours
    into v_sequence_id, v_step_id, v_delay_hours
    from public.follow_up_sequences s
    join public.follow_up_sequence_steps st on st.sequence_id = s.id and st.step_order = 1
    where s.trigger_event = v_trigger_event and s.active
      and (s.tenant_id = new.tenant_id or s.tenant_id is null)
    order by s.tenant_id nulls last
    limit 1;

  if v_sequence_id is null then
    return new;
  end if;

  select id into v_conversation_id
    from public.conversations
    where tenant_id = new.tenant_id and lead_id = new.lead_id
    order by created_at desc
    limit 1;

  if v_conversation_id is null then
    return new;
  end if;

  insert into public.follow_up_jobs (tenant_id, lead_id, conversation_id, sequence_id, step_id, scheduled_for)
  values (new.tenant_id, new.lead_id, v_conversation_id, v_sequence_id, v_step_id, now() + make_interval(hours => v_delay_hours));

  return new;
end;
$$;

create trigger on_deal_status_change
  after update on public.deals
  for each row execute function public.handle_deal_status_change();

-- ============================================================
-- Trigger: nova mensagem inbound cancela lead_no_response pendente daquela
-- conversa (o lead respondeu, não precisa mais cutucar).
-- ============================================================
create function public.handle_inbound_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.direction = 'inbound' then
    update public.follow_up_jobs
      set status = 'canceled'
      where conversation_id = new.conversation_id
        and status = 'pending'
        and sequence_id in (select id from public.follow_up_sequences where trigger_event = 'lead_no_response');
  end if;
  return new;
end;
$$;

create trigger on_inbound_message
  after insert on public.messages
  for each row execute function public.handle_inbound_message();

-- ============================================================
-- Scan periódico (pg_cron, a cada 15min): enfileira o passo 1 de
-- lead_no_response pra conversas ativas, em estágio "in_progress", paradas
-- há mais tempo que o delay do passo 1. Passos seguintes são encadeados pelo
-- próprio dispatcher depois que o passo anterior for enviado.
-- ============================================================
create function public.enqueue_lead_no_response_jobs()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.follow_up_jobs (tenant_id, lead_id, conversation_id, sequence_id, step_id, scheduled_for)
  select tenant_id, lead_id, conversation_id, sequence_id, step_id,
         last_message_at + make_interval(hours => delay_hours)
  from (
    select distinct on (c.id)
      c.tenant_id, c.lead_id, c.id as conversation_id, s.id as sequence_id, st.id as step_id,
      c.last_message_at, st.delay_hours
    from public.conversations c
    join public.leads l on l.id = c.lead_id
    join public.pipeline_stages ps on ps.id = l.stage_id
    join public.follow_up_sequences s on s.trigger_event = 'lead_no_response' and s.active
      and (s.tenant_id = c.tenant_id or s.tenant_id is null)
    join public.follow_up_sequence_steps st on st.sequence_id = s.id and st.step_order = 1
    where c.status = 'active'
      and ps.category = 'in_progress'
      and c.last_message_at <= now() - make_interval(hours => st.delay_hours)
      and not exists (
        select 1 from public.follow_up_jobs fj
        where fj.conversation_id = c.id and fj.sequence_id = s.id
      )
    order by c.id, s.tenant_id nulls last
  ) candidates;
end;
$$;

select cron.schedule(
  'enqueue-lead-no-response',
  '*/15 * * * *',
  $$select public.enqueue_lead_no_response_jobs()$$
);

-- Dispatcher: chama a Edge Function follow-up-dispatcher a cada 2min. O
-- header x-dispatcher-secret vem do Vault (criado à parte, fora desta
-- migration, pra não commitar o valor no git — ver sistema/README.md).
select cron.schedule(
  'dispatch-follow-ups',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://tblumyuozhysncscktrk.supabase.co/functions/v1/follow-up-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- Seed: sequências padrão da plataforma (tenant_id nulo)
-- ============================================================
insert into public.follow_up_sequences (id, tenant_id, trigger_event, name) values
  ('a0000000-0000-0000-0000-000000000001', null, 'lead_no_response', 'Lead sem resposta (padrão)'),
  ('a0000000-0000-0000-0000-000000000002', null, 'deal_won', 'Pós-venda (padrão)');

insert into public.follow_up_sequence_steps (sequence_id, step_order, delay_hours, message_template) values
  ('a0000000-0000-0000-0000-000000000001', 1, 24, 'Oi {{lead_name}}! Vi que ficamos sem falar — ainda faz sentido pra você entender como a {{company_name}} pode ajudar? Qualquer dúvida, é só chamar aqui.'),
  ('a0000000-0000-0000-0000-000000000001', 2, 72, '{{lead_name}}, última vez que eu te chamo por aqui — se não for o momento certo, sem problema nenhum. Se quiser retomar depois, é só mandar mensagem.'),
  ('a0000000-0000-0000-0000-000000000002', 1, 168, 'Oi {{lead_name}}! Faz uma semana que fechamos — como está sendo a experiência até aqui? Qualquer coisa que precisar, me chama.');

-- ============================================================
-- RLS
-- ============================================================
alter table public.follow_up_sequences enable row level security;
alter table public.follow_up_sequence_steps enable row level security;

create policy "follow_up_sequences_select" on public.follow_up_sequences
  for select using (
    tenant_id is null
    or tenant_id = any (public.jwt_tenant_ids())
    or public.is_platform_admin()
  );

create policy "follow_up_sequence_steps_select" on public.follow_up_sequence_steps
  for select using (
    exists (
      select 1 from public.follow_up_sequences s
      where s.id = sequence_id
        and (s.tenant_id is null or s.tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin())
    )
  );
