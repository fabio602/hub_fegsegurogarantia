-- ============================================================================
-- 075: Radar · Fase 1 · Ingestao PGFN + enriquecimento de CNPJ
--
-- Tabelas do modulo Radar: a base publica de devedores da PGFN (Divida Ativa
-- da Uniao) e filtrada e consolidada por CNPJ, enriquecida pela BrasilAPI e
-- pontuada para virar lead no Kanban. Especificacao em docs/radar/RADAR-FASE1.md.
--
--   radar_ingestoes   uma linha por arquivo CSV processado pelo script local
--   radar_inscricoes  inscricoes aceitas pelos filtros (uma por numero de inscricao)
--   radar_empresas    consolidado por CNPJ + cadastro da BrasilAPI + score + status
--
-- Escrita normal: script Python (service role) e Edge Function radar-enrich-cnpj
-- (service role). O hub le e altera status/prospect_id como authenticated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists public.radar_ingestoes (
  id bigserial primary key,
  competencia text not null,
  arquivo text not null,
  linhas_lidas int not null default 0,
  linhas_aceitas int not null default 0,
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  erro text
);

create table if not exists public.radar_inscricoes (
  id bigserial primary key,
  ingestao_id bigint references public.radar_ingestoes(id),
  competencia text not null,
  -- sempre 14 digitos, sem mascara
  cnpj text not null,
  nome_devedor text not null,
  uf text,
  unidade_responsavel text,
  numero_inscricao text not null,
  tipo_situacao text,
  situacao text,
  receita_principal text,
  data_inscricao date,
  ajuizado boolean not null default false,
  valor_consolidado numeric(16,2) not null default 0,
  unique (competencia, numero_inscricao)
);
create index if not exists radar_inscricoes_cnpj_idx on public.radar_inscricoes (cnpj);
create index if not exists radar_inscricoes_competencia_idx on public.radar_inscricoes (competencia);

create table if not exists public.radar_empresas (
  -- sempre 14 digitos, sem mascara
  cnpj text primary key,
  nome_devedor text not null,
  uf text,
  competencia_ultima text not null,
  qtd_inscricoes int not null default 0,
  valor_total numeric(16,2) not null default 0,
  data_inscricao_mais_recente date,
  -- alguma inscricao com tipo_situacao contendo GARANTIA
  tem_garantia boolean not null default false,
  receitas text[] not null default '{}',
  score int not null default 0,
  -- enriquecimento (BrasilAPI)
  enriquecido_em timestamptz,
  enriquecimento_erro text,
  razao_social text,
  nome_fantasia text,
  cnae_principal text,
  cnae_descricao text,
  porte text,
  optante_simples boolean,
  optante_mei boolean,
  situacao_cadastral text,
  municipio text,
  email text,
  telefone text,
  socios jsonb,
  -- fluxo no hub
  status text not null default 'novo'
    check (status in ('novo', 'excluido', 'enviado_kanban', 'descartado')),
  motivo_exclusao text,
  -- FK logica para prospects.id (uuid); sem constraint para o lead poder ser
  -- apagado do Kanban sem travar o Radar.
  prospect_id uuid,
  atualizado_em timestamptz not null default now()
);
create index if not exists radar_empresas_status_idx on public.radar_empresas (status);
create index if not exists radar_empresas_score_idx on public.radar_empresas (score desc);

-- ---------------------------------------------------------------------------
-- RLS: leitura e escrita para authenticated. Service role ignora RLS.
-- ---------------------------------------------------------------------------

alter table public.radar_ingestoes enable row level security;
alter table public.radar_inscricoes enable row level security;
alter table public.radar_empresas enable row level security;

drop policy if exists "authenticated_radar_ingestoes_all" on public.radar_ingestoes;
create policy "authenticated_radar_ingestoes_all"
  on public.radar_ingestoes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_radar_inscricoes_all" on public.radar_inscricoes;
create policy "authenticated_radar_inscricoes_all"
  on public.radar_inscricoes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_radar_empresas_all" on public.radar_empresas;
create policy "authenticated_radar_empresas_all"
  on public.radar_empresas for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- View: tudo que nao foi excluido, na ordem da tela.
-- security_invoker para a RLS da tabela valer para quem consulta a view.
-- ---------------------------------------------------------------------------

create or replace view public.vw_radar_empresas
  with (security_invoker = true) as
  select *
  from public.radar_empresas
  where status <> 'excluido'
  order by score desc, valor_total desc;

-- ---------------------------------------------------------------------------
-- Score (0 a 100). Empresa excluida fica com 0.
-- ---------------------------------------------------------------------------

create or replace function public.radar_calcular_score(p_cnpj text)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when e.status = 'excluido' then 0
    else least(100,
      (case when e.tem_garantia then 35 else 0 end)
      + (case
           when e.valor_total >= 5000000 then 25
           when e.valor_total >= 1000000 then 18
           when e.valor_total >= 300000 then 10
           else 0
         end)
      + (case when e.qtd_inscricoes >= 3 then 10 else 0 end)
      + (case when e.data_inscricao_mais_recente >= (current_date - interval '24 months')::date then 10 else 0 end)
      -- porte acima de EPP. BrasilAPI devolve "DEMAIS" para quem nao e ME/EPP.
      + (case when upper(coalesce(e.porte, '')) in ('DEMAIS', 'MEDIA', 'MÉDIA', 'MEDIA EMPRESA', 'MÉDIA EMPRESA') then 10 else 0 end)
      + (case when nullif(trim(coalesce(e.email, '')), '') is not null then 5 else 0 end)
      + (case when nullif(trim(coalesce(e.telefone, '')), '') is not null then 5 else 0 end)
    )
  end
  from public.radar_empresas e
  where e.cnpj = p_cnpj;
$$;

-- Grava o score recalculado na propria linha. Usado pela Edge Function apos
-- enriquecer e pelo hub apos mudar status.
create or replace function public.radar_atualizar_score(p_cnpj text)
returns int
language sql
volatile
set search_path = public
as $$
  update public.radar_empresas
     set score = public.radar_calcular_score(p_cnpj),
         atualizado_em = now()
   where cnpj = p_cnpj
  returning score;
$$;

-- ---------------------------------------------------------------------------
-- Consolidacao: radar_inscricoes (competencia) -> radar_empresas (por CNPJ).
-- Nao mexe em enriquecimento, status, prospect_id nem motivo_exclusao.
-- Uma competencia mais antiga nao sobrescreve o consolidado de uma mais nova.
-- Retorna quantas empresas foram inseridas/atualizadas.
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
      bool_or(upper(coalesce(tipo_situacao, '')) like '%GARANTIA%') as tem_garantia,
      coalesce(array_agg(distinct receita_principal) filter (where receita_principal is not null), '{}') as receitas
    from public.radar_inscricoes
    where competencia = p_competencia
    group by cnpj
  ),
  maior as (
    -- nome e UF vem da inscricao de maior valor
    select distinct on (cnpj) cnpj, nome_devedor, uf
    from public.radar_inscricoes
    where competencia = p_competencia
    order by cnpj, valor_consolidado desc, id
  )
  insert into public.radar_empresas (
    cnpj, nome_devedor, uf, competencia_ultima, qtd_inscricoes, valor_total,
    data_inscricao_mais_recente, tem_garantia, receitas, atualizado_em
  )
  select
    a.cnpj, m.nome_devedor, m.uf, p_competencia, a.qtd_inscricoes, a.valor_total,
    a.data_inscricao_mais_recente, a.tem_garantia, a.receitas, now()
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
-- Cron: enriquecimento pela BrasilAPI, a cada hora cheia entre 08h e 22h de
-- Brasilia. O pg_cron roda em UTC e Brasilia e UTC-3: 08h BRT = 11h UTC e
-- 22h BRT = 01h UTC do dia seguinte, por isso as horas 11-23 e 0-1.
-- Mesmo mecanismo dos jobs prospeccao-pncp-daily e garimpo-daily: pg_cron +
-- pg_net, com URL e anon key lidas do Vault (segredos project_url e anon_key).
-- ---------------------------------------------------------------------------

select cron.unschedule('radar-enrich-hourly')
where exists (select 1 from cron.job where jobname = 'radar-enrich-hourly');

select cron.schedule(
  'radar-enrich-hourly',
  '0 0-1,11-23 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
    || '/functions/v1/radar-enrich-cnpj',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
