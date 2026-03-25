-- Formulário público: INSERT anônimo em residential_clients + acesso completo para usuários logados.
-- Rode no SQL Editor do Supabase.
--
-- O app envia: situacao = 'Lead (site)' e obs com '[origem:formulario-publico]'.
-- Dados extras do formulário público: colunas dedicadas (migration 003); obs pode ser só o carimbo.
--
-- Se `situacao` tiver CHECK constraint, inclua 'Lead (site)' nos valores permitidos.

-- Criar policy em uma tabela com RLS desligado passa a exigir RLS; por isso incluímos também `authenticated`.
drop policy if exists "authenticated_full_residential_clients" on public.residential_clients;
create policy "authenticated_full_residential_clients"
  on public.residential_clients
  for all
  to authenticated
  using (true)
  with check (true);

-- Visitante sem login: só INSERT, com carimbo do formulário público (evita spam genérico)
drop policy if exists "public_insert_residential_lead_form" on public.residential_clients;
create policy "public_insert_residential_lead_form"
  on public.residential_clients
  for insert
  to anon
  with check (
    situacao = 'Lead (site)'
    and position('[origem:formulario-publico]' in coalesce(obs, '')) > 0
  );
