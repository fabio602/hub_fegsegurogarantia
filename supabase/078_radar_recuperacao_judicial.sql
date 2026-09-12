-- ============================================================================
-- 078: Radar · empresa em recuperacao judicial sai do Radar
--
-- Nome da PGFN ou razao social com "RECUPERACAO JUDICIAL" ou "EM RECUPERACAO"
-- (sem acento, sem diferenciar maiusculas) vira status 'excluido' com motivo
-- 'recuperacao_judicial'. Vale na consolidacao (nome_devedor) e no
-- enriquecimento (razao_social; a Edge Function e o enrich_local.py fazem a
-- mesma checagem antes de gravar).
-- ============================================================================

create or replace function public.radar_em_recuperacao(p_nome text, p_razao text)
returns boolean
language sql
immutable
as $$
  select radar_sem_acento(coalesce(p_nome, '') || ' | ' || coalesce(p_razao, '')) like '%RECUPERACAO JUDICIAL%'
      or radar_sem_acento(coalesce(p_nome, '') || ' | ' || coalesce(p_razao, '')) like '%EM RECUPERACAO%';
$$;

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

  -- Recuperacao judicial: so mexe em quem ainda esta 'novo'.
  update public.radar_empresas e
     set status = 'excluido',
         motivo_exclusao = 'recuperacao_judicial',
         atualizado_em = now()
   where e.competencia_ultima = p_competencia
     and e.status = 'novo'
     and radar_em_recuperacao(e.nome_devedor, e.razao_social);

  update public.radar_empresas e
     set score = public.radar_calcular_score(e.cnpj)
   where e.competencia_ultima = p_competencia;

  return v_linhas;
end;
$$;

-- Aplica na base atual (quem ja foi excluido por outro motivo, enviado ao
-- Kanban ou descartado nao muda).
update public.radar_empresas e
   set status = 'excluido',
       motivo_exclusao = 'recuperacao_judicial',
       score = 0,
       atualizado_em = now()
 where e.status = 'novo'
   and radar_em_recuperacao(e.nome_devedor, e.razao_social);
