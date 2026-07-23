-- Fase 10b — nota de qualidade (0-100) por prospect, pedido do dono inspirado de novo no
-- Kaptar: uma barra mostrando o quanto a presença digital da empresa é boa (tem site? o
-- site responde? é https? é mobile-friendly?) além de telefone/Instagram capturados.

alter table public.prospects
  add column site_reachable boolean,
  add column site_https boolean,
  add column site_mobile_friendly boolean;

comment on column public.prospects.site_reachable is
  'null = ainda não verificado (prospect capturado antes dessa coluna existir, ou sem site).
   Preenchido por prospeccao-buscar/prospeccao-worker no momento da captura, ou sob demanda
   pelo botão "Reavaliar site" (prospeccao-avaliar-site).';

alter table public.prospects
  add column quality_score int generated always as (
    (case when phone_number is not null then 20 else 0 end) +
    (case when instagram_url is not null then 15 else 0 end) +
    (case when website is not null and coalesce(site_reachable, false) then 25 else 0 end) +
    (case when website is not null and coalesce(site_https, false) then 20 else 0 end) +
    (case when website is not null and coalesce(site_mobile_friendly, false) then 20 else 0 end)
  ) stored;

comment on column public.prospects.quality_score is
  'Gerada a partir das outras colunas da própria linha -- nunca fica desatualizada. Sem site,
   teto é 35 (só telefone+instagram). Pontuação: telefone +20, instagram +15, site responde
   +25, site https +20, site mobile-friendly (tem <meta viewport>) +20.';
