-- Fase 2 — tira a geração de carrossel do worker local e coloca na nuvem.
--
-- Antes: integration_hub_jobs.params.pasta apontava pra uma pasta local, criada à mão
-- rodando a skill /carrossel com o Claude Code (texto + Playwright na máquina do dono) —
-- não funcionava pra nenhum outro tenant. Fluxo novo: hub-generate-carrossel (Claude via
-- API, sem interação) gera o texto a partir de um tema digitado no dashboard e grava como
-- rascunho ('awaiting_approval'); o tenant revisa/edita e aprova; hub-render-carrossel
-- monta o HTML com a marca do tenant (companies.branding_json) e manda pro render-service
-- (Playwright rodando num container Cloud Run — Supabase Edge Function não tem Chromium).
--
-- Novo estado 'awaiting_approval' entre pending e processing: preserva o checkpoint
-- humano que a skill /carrossel já tinha (mostrar texto, esperar aprovação) — só passa a
-- rodar sem o Claude Code aberto.

-- Dropa o check constraint de status pelo nome real (em vez de assumir o nome padrão
-- integration_hub_jobs_status_check) — mais seguro rodando direto no SQL Editor contra
-- produção, sem CLI/migration runner pra validar antes.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.integration_hub_jobs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%pending%';

  if v_constraint_name is not null then
    execute format('alter table public.integration_hub_jobs drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.integration_hub_jobs add constraint integration_hub_jobs_status_check
  check (status in ('pending', 'awaiting_approval', 'processing', 'done', 'failed'));

comment on column public.integration_hub_jobs.params is
  'Entrada do job. Pra tool=carrossel: { tema, tipo } (tipo hoje só suporta "texto" — carrossel com foto IA fica pra uma próxima leva).';
comment on column public.integration_hub_jobs.result is
  'Saída do job. Pra tool=carrossel com status=awaiting_approval: { draft: { slides, caption } } (texto gerado, ainda sem imagem). Com status=done: { images: string[], caption } (URLs públicas no bucket hub-media). Pra tool=instagram_post: { post_id, permalink }.';
