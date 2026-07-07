-- Fase 4 — cérebro coletivo: base de conhecimento compartilhada entre TODOS
-- os tenants (decisão do dono — não é isolada por tenant como o resto do
-- schema), alimentada por extração de insights ao fim de cada conversa, com
-- aprovação humana obrigatória antes de entrar em produção.

create extension if not exists vector with schema extensions;

-- ============================================================
-- knowledge_base_insights — compartilhada (scope='platform'), sem tenant_id
-- de propósito. Só insights com status='approved' entram no retrieval.
-- ============================================================
create table public.knowledge_base_insights (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'platform' check (scope in ('platform')),
  category text not null check (category in ('objection_handling', 'pricing', 'closing_technique', 'faq')),
  insight_text text not null,
  embedding extensions.vector(512),
  source_conversation_ids uuid[] not null default '{}',
  outcome_stats jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.knowledge_base_insights is
  'Compartilhada entre todos os tenants por decisão do dono — aprendizado coletivo de padrões de venda. Aprovação humana obrigatória (status=approved) antes de entrar no retrieval, já que o impacto é pra todos os clientes da plataforma.';

create index knowledge_base_insights_embedding_idx on public.knowledge_base_insights
  using hnsw (embedding extensions.vector_cosine_ops);

-- ============================================================
-- conversation_outcomes — 1 linha por conversa processada, evita reprocessar
-- ============================================================
create table public.conversation_outcomes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  outcome text not null check (outcome in ('won', 'lost', 'undecided')),
  summary_text text,
  insights_generated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conversation_id)
);

-- ============================================================
-- match_insights — busca por similaridade de cosseno, só aprovados.
-- Chamada pela Edge Function whatsapp-webhook (service_role, ignora RLS).
-- ============================================================
create function public.match_insights(query_embedding extensions.vector(512), match_count int default 5)
returns table (id uuid, category text, insight_text text, similarity float)
language sql stable
as $$
  select id, category, insight_text, 1 - (embedding <=> query_embedding) as similarity
  from public.knowledge_base_insights
  where status = 'approved' and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- Scan periódico (pg_cron, diário): conversas sem outcome registrado, com
-- pelo menos 1 mensagem, paradas há mais de 7 dias — processadas como
-- 'undecided' pelo extract-insights.
-- ============================================================
select cron.schedule(
  'scan-conversation-timeouts',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://tblumyuozhysncscktrk.supabase.co/functions/v1/extract-insights',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatcher-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'dispatcher_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================
-- RLS — base de conhecimento é uma ferramenta interna do time BK (platform
-- admin), não algo que tenant comum acessa direto pelo app.
-- ============================================================
alter table public.knowledge_base_insights enable row level security;
alter table public.conversation_outcomes enable row level security;

create policy "knowledge_base_insights_select" on public.knowledge_base_insights
  for select using (public.is_platform_admin());

create policy "knowledge_base_insights_update" on public.knowledge_base_insights
  for update using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "conversation_outcomes_select" on public.conversation_outcomes
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );
