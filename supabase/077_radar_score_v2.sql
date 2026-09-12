-- ============================================================================
-- 077: Radar · score v2 (recalibrado com a base real de 06/2026)
--
-- O que muda:
--   - radar_empresas ganha qtd_em_cobranca e qtd_beneficio, contadas pelo
--     tipo_situacao das inscricoes ("Em cobranca" vs "Beneficio Fiscal" /
--     negociacao);
--   - radar_consolidar_empresas preenche as duas colunas;
--   - radar_calcular_score passa a premiar valor em faixa util (nao o gigante
--     de bilhoes), inscricao em cobranca (garantia por apresentar) e CNAE
--     industrial, e a penalizar quem so tem beneficio fiscal/parcelamento.
--
-- Comparacoes de texto sao feitas sem acento e em maiusculas pela funcao
-- radar_sem_acento (translate), porque o projeto nao tem a extensao unaccent.
-- ============================================================================

alter table public.radar_empresas
  add column if not exists qtd_em_cobranca int not null default 0,
  add column if not exists qtd_beneficio   int not null default 0;

create or replace function public.radar_sem_acento(p text)
returns text
language sql
immutable
as $$
  select translate(upper(coalesce(p, '')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'AAAAAEEEEIIIIOOOOOUUUUCN');
$$;

-- ---------------------------------------------------------------------------
-- Score v2 (0 a 100)
-- ---------------------------------------------------------------------------

create or replace function public.radar_calcular_score(p_cnpj text)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when e.status = 'excluido' then 0
    else greatest(0, least(100,
        (case when e.tem_garantia then 30 else 0 end)
      + (case
           when e.valor_total >= 300000000 then 3
           when e.valor_total >= 50000000  then 12
           when e.valor_total >= 5000000   then 25
           when e.valor_total >= 1000000   then 20
           when e.valor_total >= 300000    then 10
           else 0
         end)
      + (case when e.qtd_em_cobranca >= 1 then 15 else 0 end)
      -- tudo parcelado ou em negociacao: nao ha garantia a apresentar agora
      + (case when e.qtd_em_cobranca = 0 and e.qtd_inscricoes > 0 and e.qtd_beneficio = e.qtd_inscricoes then -25 else 0 end)
      + (case when e.qtd_inscricoes >= 3 then 5 else 0 end)
      + (case when e.data_inscricao_mais_recente >= (current_date - interval '24 months')::date then 10 else 0 end)
      -- divisoes CNAE 05 a 33: extrativa e industria de transformacao.
      -- A BrasilAPI devolve cnae_fiscal como numero (perde o zero a esquerda), por isso o lpad.
      + (case when substr(lpad(regexp_replace(coalesce(e.cnae_principal, ''), '\D', '', 'g'), 7, '0'), 1, 2) between '05' and '33'
              and length(regexp_replace(coalesce(e.cnae_principal, ''), '\D', '', 'g')) >= 6 then 10 else 0 end)
      + (case when upper(coalesce(e.porte, '')) = 'DEMAIS' then 5 else 0 end)
      + (case when nullif(trim(coalesce(e.email, '')), '') is not null then 5 else 0 end)
      + (case when nullif(trim(coalesce(e.telefone, '')), '') is not null then 5 else 0 end)
    ))
  end
  from public.radar_empresas e
  where e.cnpj = p_cnpj;
$$;

-- ---------------------------------------------------------------------------
-- Consolidacao com as duas contagens novas
-- ---------------------------------------------------------------------------

create or replace function public.radar_consolidar_empresas(p_competencia text)
returns int
language plpgsql
volatile
set search_path = public
as $$
declare
  v_linhas int;
begin
  with agg as (
    select
      cnpj,
      count(*)::int                       as qtd_inscricoes,
      sum(valor_consolidado)              as valor_total,
      max(data_inscricao)                 as data_inscricao_mais_recente,
      bool_or(radar_sem_acento(tipo_situacao) like '%GARANTIA%') as tem_garantia,
      count(*) filter (where radar_sem_acento(tipo_situacao) like '%COBRANCA%')::int as qtd_em_cobranca,
      count(*) filter (where radar_sem_acento(tipo_situacao) like '%BENEFICIO%'
                          or radar_sem_acento(tipo_situacao) like '%NEGOCIACAO%')::int as qtd_beneficio,
      coalesce(array_agg(distinct receita_principal) filter (where receita_principal is not null), '{}') as receitas
    from public.radar_inscricoes
    where competencia = p_competencia
    group by cnpj
  ),
  maior as (
    select distinct on (cnpj) cnpj, nome_devedor, uf
    from public.radar_inscricoes
    where competencia = p_competencia
    order by cnpj, valor_consolidado desc, id
  )
  insert into public.radar_empresas (
    cnpj, nome_devedor, uf, competencia_ultima, qtd_inscricoes, valor_total,
    data_inscricao_mais_recente, tem_garantia, qtd_em_cobranca, qtd_beneficio, receitas, atualizado_em
  )
  select
    a.cnpj, m.nome_devedor, m.uf, p_competencia, a.qtd_inscricoes, a.valor_total,
    a.data_inscricao_mais_recente, a.tem_garantia, a.qtd_em_cobranca, a.qtd_beneficio, a.receitas, now()
  from agg a
  join maior m using (cnpj)
  on conflict (cnpj) do update set
    nome_devedor                = excluded.nome_devedor,
    uf                          = excluded.uf,
    competencia_ultima          = excluded.competencia_ultima,
    qtd_inscricoes              = excluded.qtd_inscricoes,
    valor_total                 = excluded.valor_total,
    data_inscricao_mais_recente = excluded.data_inscricao_mais_recente,
    tem_garantia                = excluded.tem_garantia,
    qtd_em_cobranca             = excluded.qtd_em_cobranca,
    qtd_beneficio               = excluded.qtd_beneficio,
    receitas                    = excluded.receitas,
    atualizado_em               = now()
  where radar_empresas.competencia_ultima <= excluded.competencia_ultima;

  get diagnostics v_linhas = row_count;

  update public.radar_empresas e
     set score = public.radar_calcular_score(e.cnpj)
   where e.competencia_ultima = p_competencia;

  return v_linhas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reprocessa a competencia carregada e recalcula o score de todo mundo
-- ---------------------------------------------------------------------------

select public.radar_consolidar_empresas('202606');

update public.radar_empresas e
   set score = public.radar_calcular_score(e.cnpj);
