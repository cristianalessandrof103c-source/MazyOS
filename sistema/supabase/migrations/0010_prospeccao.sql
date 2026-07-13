-- Fase 8 — Prospecção: busca de prospects por nicho+região via Google Places API,
-- separada do funil do CRM. Qualificação manual gera um lead de verdade via RPC.

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.companies (id) on delete cascade,
  place_id text not null,
  name text not null,
  formatted_address text,
  phone_number text,
  website text,
  instagram_url text,
  linkedin_url text,
  google_maps_url text,
  latitude double precision,
  longitude double precision,
  search_niche text,
  search_region text,
  status text not null default 'novo'
    check (status in ('novo', 'contatado', 'qualificado', 'descartado', 'convertido')),
  notes text,
  converted_lead_id uuid references public.leads (id) on delete set null,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, place_id)
);

comment on column public.prospects.status is
  'Funil de prospecção, independente de pipeline_stages do CRM. convertido só é setado via RPC convert_prospect_to_lead.';
comment on column public.prospects.converted_lead_id is
  'Preenchido só pelo RPC convert_prospect_to_lead — nunca diretamente pelo client.';

-- Canal de aquisição template pro lead criado a partir de um prospect qualificado.
insert into public.acquisition_channels (tenant_id, code, label, category) values
  (null, 'prospeccao_ativa', 'Prospecção ativa', 'direct');

alter table public.prospects enable row level security;

create policy "prospects_select" on public.prospects
  for select using (
    tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin()
  );

-- Sem policy de insert: prospects só são criados pela Edge Function prospeccao-buscar,
-- via service_role (bypassa RLS) — garante que os dados vieram de fato de uma busca
-- real na Places API.
--
-- Update liberado pro client só pra mudar status/notes dentro do funil de prospecção
-- (novo/contatado/qualificado/descartado). status='convertido' e converted_lead_id só
-- são setados pelo RPC convert_prospect_to_lead (security definer, bypassa RLS).
create policy "prospects_update_client" on public.prospects
  for update using (
    (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin())
    and status <> 'convertido'
  )
  with check (
    (tenant_id = any (public.jwt_tenant_ids()) or public.is_platform_admin())
    and status <> 'convertido'
    and converted_lead_id is null
  );

-- ============================================================
-- RPC: qualificação manual de um prospect vira lead de verdade no CRM.
-- ============================================================
create function public.convert_prospect_to_lead(p_prospect_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_prospect public.prospects%rowtype;
  v_channel_id uuid;
  v_stage_id uuid;
  v_lead_id uuid;
begin
  select * into v_prospect from public.prospects where id = p_prospect_id;
  if not found then
    raise exception 'prospect não encontrado';
  end if;

  if not public.is_platform_admin()
     and not (v_prospect.tenant_id = any (public.jwt_tenant_ids())) then
    raise exception 'not authorized';
  end if;

  if v_prospect.status = 'convertido' then
    raise exception 'prospect já convertido (lead_id %)', v_prospect.converted_lead_id;
  end if;

  select id into v_channel_id from public.acquisition_channels
    where code = 'prospeccao_ativa'
      and (tenant_id is null or tenant_id = v_prospect.tenant_id)
    order by tenant_id nulls last
    limit 1;

  select id into v_stage_id from public.pipeline_stages
    where category = 'new'
      and (tenant_id is null or tenant_id = v_prospect.tenant_id)
    order by tenant_id nulls last, order_index
    limit 1;

  if v_stage_id is null then
    raise exception 'nenhum pipeline_stage com category=new configurado pra esse tenant';
  end if;

  insert into public.leads (
    tenant_id, full_name, phone_number, acquisition_channel_id, stage_id, assigned_to, custom_fields
  ) values (
    v_prospect.tenant_id,
    v_prospect.name,
    v_prospect.phone_number,
    v_channel_id,
    v_stage_id,
    auth.uid(),
    jsonb_build_object(
      'prospect_id', v_prospect.id,
      'address', v_prospect.formatted_address,
      'website', v_prospect.website,
      'instagram_url', v_prospect.instagram_url,
      'linkedin_url', v_prospect.linkedin_url,
      'google_maps_url', v_prospect.google_maps_url
    )
  )
  returning id into v_lead_id;

  update public.prospects
    set status = 'convertido', converted_lead_id = v_lead_id
    where id = p_prospect_id;

  return v_lead_id;
end;
$$;

grant execute on function public.convert_prospect_to_lead to authenticated;
