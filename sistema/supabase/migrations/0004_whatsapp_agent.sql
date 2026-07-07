-- Fase 2 — WhatsApp sandbox + agente de IA: conexão do número, conversas,
-- mensagens, configuração do agente por tenant e fila simples de follow-up
-- (a automação completa de disparo entra na Fase 3 — aqui só a tabela existe
-- pra tool `agendar_followup` já ter onde gravar).

-- ============================================================
-- whatsapp_connections
-- ============================================================
create table public.whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  phone_number_id text not null unique,
  business_account_id text not null,
  status text not null default 'test' check (status in ('test', 'live')),
  created_at timestamptz not null default now()
);

comment on column public.whatsapp_connections.phone_number_id is
  'ID do número na Cloud API — é isso que o webhook usa pra resolver o tenant_id (nunca aceitar tenant_id cru do payload do WhatsApp).';

comment on column public.whatsapp_connections.status is
  'test = número de sandbox da Cloud API (Fase 2). live = número real, conectado só depois da verificação de empresa da Meta (Fase 6).';

-- ============================================================
-- conversations
-- ============================================================
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  status text not null default 'active' check (status in ('active', 'needs_human', 'closed')),
  window_expires_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on column public.conversations.window_expires_at is
  'Janela de 24h da Cloud API — fora dela só dá pra mandar Template pré-aprovado, não mensagem livre.';

comment on column public.conversations.status is
  'needs_human = tool escalar_para_humano foi chamada; o agente para de responder automaticamente até alguém da equipe assumir.';

-- ============================================================
-- messages
-- ============================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('lead', 'agent', 'human')),
  content_text text not null,
  content_type text not null default 'text' check (content_type in ('text')),
  whatsapp_message_id text,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

comment on column public.messages.tool_calls is
  'Auditoria: quais tools o agente chamou (nome + input) ao gerar essa mensagem outbound. Nulo em mensagens inbound.';

-- ============================================================
-- agent_configs (1 linha por tenant — criada sob demanda, sem seed padrão)
-- ============================================================
create table public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.companies (id) on delete cascade,
  system_prompt_override text,
  model text not null default 'claude-opus-4-8',
  tools_enabled text[] not null default array[
    'atualizar_estagio_lead', 'registrar_venda', 'agendar_followup',
    'marcar_conversa_perdida', 'escalar_para_humano'
  ],
  created_at timestamptz not null default now()
);

-- ============================================================
-- follow_up_jobs — fila simples. A tool agendar_followup grava aqui;
-- o dispatcher (pg_cron + sequences) que efetivamente dispara é Fase 3.
-- ============================================================
create table public.follow_up_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  note text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'canceled')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS — mesmo padrão de isolamento por tenant_id das fases anteriores.
-- Edge Functions rodam com service_role e ignoram RLS por definição; as
-- policies abaixo são pra acesso autenticado direto do dashboard (leitura
-- do histórico de conversa, principalmente).
-- ============================================================
alter table public.whatsapp_connections enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.agent_configs enable row level security;
alter table public.follow_up_jobs enable row level security;

create policy "whatsapp_connections_select" on public.whatsapp_connections
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "conversations_select" on public.conversations
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "messages_select" on public.messages
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "agent_configs_select" on public.agent_configs
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "agent_configs_write" on public.agent_configs
  for all using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  )
  with check (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "follow_up_jobs_select" on public.follow_up_jobs
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );
