-- ============================================================================
-- 076: Radar · coluna computada receitas_tipos para o filtro de receita
--
-- radar_empresas.receitas guarda os textos completos da PGFN ("COFINS -
-- CONTRIBUICAO PARA O FINANCIAMENTO...", "IPI VINCULADO A IMPORTACAO"...).
-- A tela filtra por PIS, COFINS e IPI, e o PostgREST nao faz ilike dentro de
-- array. Esta funcao vira uma coluna computada (PostgREST chama funcoes cujo
-- unico parametro e a linha da tabela): GET /radar_empresas?receitas_tipos=ov.{PIS,IPI}
-- ============================================================================

create or replace function public.receitas_tipos(e public.radar_empresas)
returns text[]
language sql
immutable
set search_path = public
as $$
  select array_remove(array[
    case when exists (select 1 from unnest(e.receitas) r where upper(r) like '%PIS%')    then 'PIS'    end,
    case when exists (select 1 from unnest(e.receitas) r where upper(r) like '%COFINS%') then 'COFINS' end,
    case when exists (select 1 from unnest(e.receitas) r where upper(r) like '%IPI%')    then 'IPI'    end
  ], null);
$$;
