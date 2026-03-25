-- Formulário público: INSERT anônimo em residential_clients + acesso completo para usuários logados.
-- Rode no SQL Editor do Supabase.
--
-- INSERT anônimo: ver migration 004 — situacao = 'Lead (site)' e origem_publica = true (sem depender de obs).
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

-- Política anônima atual está em 004_residential_lead_origem_created.sql (origem_publica + Lead (site)).
