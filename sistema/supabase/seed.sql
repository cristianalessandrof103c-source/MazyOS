-- Roda depois das migrations em `supabase db reset` (ou manualmente contra o projeto hospedado).
-- Só cria a empresa; o usuário dono precisa existir em auth.users primeiro (cadastro pela tela
-- de login ou Supabase Studio) — ver sistema/README.md para o passo de vincular o dono como
-- tenant_admin + platform_admin depois de criar a conta.

insert into public.companies (name, slug, plan_tier, status)
values ('BK Solutions', 'bk-solutions', 'internal', 'active')
on conflict (slug) do nothing;
