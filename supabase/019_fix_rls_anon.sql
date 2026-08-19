-- 019_fix_rls_anon.sql
-- ============================================================================
-- Correção de RLS: fechar acesso do papel anônimo (anon).
--
-- Contexto: a anon key é pública (vai no bundle JS). No Postgres o papel
-- `public` INCLUI o `anon`, então políticas `TO public USING (true)` — mesmo
-- que o nome diga "authenticated" — deixam a tabela aberta para qualquer um.
--
-- Esta migration:
--   1) Remove todas as políticas abertas a anon/public (USING true).
--   2) Garante uma política somente-`authenticated` (CRUD para usuários logados)
--      nas tabelas cuja única política era aberta.
--   3) NÃO mexe nos 2 inserts públicos legítimos (formulário residencial e
--      landing de licitação) nem nas políticas `authenticated_*` já existentes.
--   4) Fixa search_path nas 4 funções apontadas pelo linter de segurança.
--
-- Verificação feita em 2026-08-19: nenhum código público (Hub é 100% gated por
-- login; formulário residencial só faz INSERT em residential_clients; site
-- estático FeG_Corretora não usa Supabase) depende de acesso anônimo de leitura.
--
-- Rode no SQL Editor do Supabase (ou via `supabase db push`). Idempotente.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Grupo A — tabelas que JÁ possuem política `authenticated`: só remover o anon.
-- ----------------------------------------------------------------------------

-- sales: mantém `auth_sales` (authenticated ALL). Remove a leitura anônima de
-- vendas emitidas (vazava prêmio, comissão, CNPJ e contato do segurado).
drop policy if exists "anon_read_vendas_emitidas" on public.sales;

-- sellers: mantém `authenticated_sellers_all`. Remove acesso anônimo total
-- (nomes, e-mails e % de comissão dos vendedores).
drop policy if exists "anon_sellers_all" on public.sellers;

-- monthly_targets: mantém `authenticated_monthly_targets_all`.
drop policy if exists "anon_monthly_targets_all" on public.monthly_targets;

-- imobiliaria_clientes: mantém `imobiliaria_auth` (authenticated ALL).
drop policy if exists "imobiliaria_anon_read" on public.imobiliaria_clientes;
drop policy if exists "imobiliaria_anon_insert" on public.imobiliaria_clientes;

-- imobiliaria_repasses: mantém `repasses_auth` (authenticated ALL).
drop policy if exists "repasses_anon_read" on public.imobiliaria_repasses;

-- ----------------------------------------------------------------------------
-- Grupo B — tabelas cuja ÚNICA política era aberta a public:
-- remover a aberta e recriar como somente-`authenticated`.
-- ----------------------------------------------------------------------------

-- prospects (CRM: 384 leads com PII) --------------------------------------
drop policy if exists "Enable read access for all users"   on public.prospects;
drop policy if exists "Enable insert access for all users" on public.prospects;
drop policy if exists "Enable update access for all users" on public.prospects;
drop policy if exists "Enable delete access for all users" on public.prospects;
drop policy if exists "authenticated_prospects_all"        on public.prospects;
create policy "authenticated_prospects_all" on public.prospects
  for all to authenticated using (true) with check (true);

-- crm_tasks ----------------------------------------------------------------
drop policy if exists "Allow all for authenticated users" on public.crm_tasks;
drop policy if exists "authenticated_crm_tasks_all"       on public.crm_tasks;
create policy "authenticated_crm_tasks_all" on public.crm_tasks
  for all to authenticated using (true) with check (true);

-- banks --------------------------------------------------------------------
drop policy if exists "Permitir leitura de bancos"     on public.banks;
drop policy if exists "Permitir insercao de banco"     on public.banks;
drop policy if exists "Permitir atualizacao de banco"  on public.banks;
drop policy if exists "Permitir delecao de banco"      on public.banks;
drop policy if exists "authenticated_banks_all"        on public.banks;
create policy "authenticated_banks_all" on public.banks
  for all to authenticated using (true) with check (true);

-- sureties (afiançadoras) --------------------------------------------------
drop policy if exists "Permitir leitura de afiancadoras"    on public.sureties;
drop policy if exists "Permitir insercao de afiancadoras"   on public.sureties;
drop policy if exists "Permitir atualizacao de afiancadoras" on public.sureties;
drop policy if exists "Permitir delecao de afiancadoras"    on public.sureties;
drop policy if exists "authenticated_sureties_all"          on public.sureties;
create policy "authenticated_sureties_all" on public.sureties
  for all to authenticated using (true) with check (true);

-- rc_clients ---------------------------------------------------------------
drop policy if exists "allow_all"                  on public.rc_clients;
drop policy if exists "authenticated_rc_clients_all" on public.rc_clients;
create policy "authenticated_rc_clients_all" on public.rc_clients
  for all to authenticated using (true) with check (true);

-- garantidoras_residencial -------------------------------------------------
drop policy if exists "allow_all"                              on public.garantidoras_residencial;
drop policy if exists "authenticated_garantidoras_residencial_all" on public.garantidoras_residencial;
create policy "authenticated_garantidoras_residencial_all" on public.garantidoras_residencial
  for all to authenticated using (true) with check (true);

-- seguradoras_auto ---------------------------------------------------------
drop policy if exists "allow_all"                       on public.seguradoras_auto;
drop policy if exists "authenticated_seguradoras_auto_all" on public.seguradoras_auto;
create policy "authenticated_seguradoras_auto_all" on public.seguradoras_auto
  for all to authenticated using (true) with check (true);

-- seguradoras_rc -----------------------------------------------------------
drop policy if exists "allow_all"                     on public.seguradoras_rc;
drop policy if exists "authenticated_seguradoras_rc_all" on public.seguradoras_rc;
create policy "authenticated_seguradoras_rc_all" on public.seguradoras_rc
  for all to authenticated using (true) with check (true);

-- seguradoras_residencial --------------------------------------------------
drop policy if exists "allow_all"                              on public.seguradoras_residencial;
drop policy if exists "authenticated_seguradoras_residencial_all" on public.seguradoras_residencial;
create policy "authenticated_seguradoras_residencial_all" on public.seguradoras_residencial
  for all to authenticated using (true) with check (true);

-- repasses (tabela standalone; a policy "repasses_auth" estava TO public) ---
drop policy if exists "repasses_auth"                on public.repasses;
drop policy if exists "authenticated_repasses_all"   on public.repasses;
create policy "authenticated_repasses_all" on public.repasses
  for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Grupo C — Function Search Path Mutable (linter de segurança).
-- Fixa um search_path explícito sem reescrever o corpo das funções.
-- Todas são trigger functions (sem argumentos).
-- ----------------------------------------------------------------------------
alter function public.set_status_entered_at()      set search_path = public, pg_temp;
alter function public.sync_crm_task_to_agenda()     set search_path = public, pg_temp;
alter function public.delete_agenda_task_from_crm() set search_path = public, pg_temp;
alter function public.set_pendencias_atualizado_em() set search_path = public, pg_temp;

commit;

-- ============================================================================
-- PRESERVADO DE PROPÓSITO (não remover — são acessos públicos legítimos):
--   • residential_clients / "public_insert_residential_lead_form"
--       anon INSERT com escopo (situacao='Lead (site)' AND origem_publica) — formulário público.
--   • leads_seguro_garantia / "public_insert_leads_seguro_garantia_landing"
--       anon INSERT com escopo (status='novo' AND origem='Landing Page - Licitação') — landing.
--
-- CONFERÊNCIA PÓS-APLICAÇÃO (deve retornar só as 2 linhas acima):
--   select tablename, policyname, cmd, roles
--   from pg_policies
--   where schemaname='public'
--     and (roles && array['anon']::name[] or roles && array['public']::name[])
--     and coalesce(qual,'') <> '(auth.role() = ''authenticated''::text)';
-- ============================================================================
