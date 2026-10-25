-- ============================================================================
-- 119_prospects_telefones.sql
-- Segundo telefone e telefones marcados como inexistentes no lead.
--
-- Por que: a equipe perde tempo ligando para numero que nao existe. O lead do
-- PNCP so trazia o ddd_telefone_1 da Receita. Numa amostra de 30 leads
-- recentes (25/10/2026), 6 tinham um segundo telefone diferente na Receita e
-- nenhum tinha celular; a CNPJa aberta devolve os mesmos numeros da Receita.
--
-- - prospects.telefone_2: segundo telefone da Receita (ddd_telefone_2).
-- - prospects.telefones_invalidos: numeros (so digitos, sem 55) que alguem da
--   equipe marcou como "nao existe" no card. O card esconde esses numeros, e a
--   coluna permite medir depois qual fonte erra mais (comparando com
--   phonenumber e telefone_2).
-- - prospeccao_pncp_cnpj_cache.telefone_2: o mesmo dado no cache por CNPJ.
--
-- Tabelas ja existentes: nao precisam de grant novo.
-- ============================================================================

alter table public.prospects
  add column if not exists telefone_2 text,
  add column if not exists telefones_invalidos text[] not null default '{}';

comment on column public.prospects.telefone_2 is
  'Segundo telefone do cadastro da Receita (ddd_telefone_2), quando diferente do phonenumber.';
comment on column public.prospects.telefones_invalidos is
  'Numeros marcados como inexistentes pela equipe no card do Kanban (so digitos, sem 55). O card nao mostra esses numeros.';

alter table public.prospeccao_pncp_cnpj_cache
  add column if not exists telefone_2 text;
