-- ============================================================================
-- 080: Radar · municipios distintos por UF (autocomplete do filtro Municipio)
--
-- Devolve os municipios de radar_empresas (nao excluidas) de uma UF com a
-- contagem de empresas, para o autocomplete da tela. O PostgREST nao faz
-- distinct, e SP tem dezenas de milhares de linhas; por isso a funcao.
-- Os municipios vem da BrasilAPI em maiusculas e sem acento (ex.: SAO PAULO).
-- ============================================================================

create or replace function public.radar_municipios(p_uf text)
returns table (municipio text, empresas int)
language sql
stable
set search_path = public
as $$
  select e.municipio, count(*)::int as empresas
  from public.radar_empresas e
  where e.uf = p_uf
    and e.status <> 'excluido'
    and nullif(trim(coalesce(e.municipio, '')), '') is not null
  group by e.municipio
  order by count(*) desc, e.municipio;
$$;

grant execute on function public.radar_municipios(text) to authenticated;
