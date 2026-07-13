-- Fase 7 (parte 1) — convite self-service + branding por tenant. As duas peças que dependem
-- de aprovação externa (Embedded Signup do WhatsApp, OAuth de ads) e a decisão de billing
-- (mensalidade fixa por plano, já cabe em companies.plan_tier) ficam fora desta migration.

alter table public.memberships add column invited_email text;

comment on column public.memberships.invited_email is
  'Email pro qual o convite foi mandado — permite listar convites pendentes sem precisar ler auth.users (não exposto via PostgREST).';

-- Convidado aceita o próprio convite: única transição de status que o cliente pode fazer
-- direto (o resto — criar a membership como 'invited' — é sempre via invite-member, service_role).
create policy "memberships_accept_self" on public.memberships
  for update using (user_id = auth.uid() and status = 'invited')
  with check (user_id = auth.uid() and status = 'active');

-- Sem isso, um tenant_admin não enxerga o full_name dos próprios colegas de time — profiles
-- hoje só permite ver o próprio perfil (política da Fase 0), o que impede um roster de equipe.
create policy "profiles_select_tenant_members" on public.profiles
  for select using (
    exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.tenant_id = m2.tenant_id
      where m1.user_id = auth.uid() and m1.status = 'active'
        and m2.user_id = profiles.id and m2.status = 'active'
    )
  );

-- security definer em vez de uma policy de UPDATE genérica em companies — evita abrir
-- plan_tier/status (controle da plataforma) pra edição por tenant_admin.
create function public.update_company_branding(p_tenant_id uuid, p_branding jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_platform_admin() and not exists (
    select 1 from public.memberships
    where tenant_id = p_tenant_id and user_id = auth.uid() and role = 'tenant_admin' and status = 'active'
  ) then
    raise exception 'not authorized';
  end if;

  update public.companies set branding_json = p_branding where id = p_tenant_id;
end;
$$;

grant execute on function public.update_company_branding to authenticated;
