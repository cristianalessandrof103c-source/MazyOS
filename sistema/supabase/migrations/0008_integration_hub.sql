-- Fase 5 — hub de integrações do MazyOS: fila de jobs que conecta o dashboard às
-- automações de marketing que já existem como scripts (carrossel via Playwright,
-- publicação via Meta Graph API). Escopo desta leva: só carrossel → Instagram
-- (tool já reserva os outros valores do plano pra não precisar de migration nova
-- quando SEO/site/ads entrarem, mesmo padrão de acquisition_channels).

create table public.integration_hub_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  tool text not null check (tool in ('carrossel', 'seo', 'site', 'instagram_post', 'ads_campaign')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  params jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

comment on column public.integration_hub_jobs.params is
  'Entrada do job. Pra tool=carrossel: { pasta } (caminho relativo em marketing/conteudo/ lido pelo worker local).';
comment on column public.integration_hub_jobs.result is
  'Saída do job. Pra tool=carrossel: { images: string[] (URLs públicas no bucket hub-media), caption }. Pra tool=instagram_post: { post_id, permalink }.';

alter table public.integration_hub_jobs enable row level security;

-- Só select/insert client-side. status/result/error só mudam via worker local ou
-- Edge Function (ambos com service_role, que ignora RLS) — nunca direto pelo dashboard.
create policy "integration_hub_jobs_select" on public.integration_hub_jobs
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

create policy "integration_hub_jobs_insert" on public.integration_hub_jobs
  for insert with check (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

-- Bucket público: a Graph API do Instagram busca a imagem por URL pública
-- (mesma exigência que hoje força publicar-fila.js a subir PNGs num repo Git à parte).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-media', 'hub-media', true, 10485760, array['image/png'])
on conflict (id) do nothing;
