-- ============================================================================
-- 079: Radar · Fase 2 · Dossie judicial via PJe TRF3
--
-- Para cada empresa do Radar com garantia, o worker local
-- (scripts/radar/pje_worker.py, Playwright no Mac) localiza as execucoes
-- fiscais (classe 1116) e os embargos a execucao fiscal (1118) na consulta
-- publica do PJe TRF3 1o grau e grava vara, advogados e movimentacoes.
-- Especificacao em docs/radar/RADAR-FASE2.md.
--
--   radar_pje_fila              fila de empresas a consultar (uma linha por CNPJ)
--   radar_processos             um processo por numero CNJ
--   radar_processo_movimentos   as 15 movimentacoes mais recentes de cada processo
--   radar_processo_advogados    participantes ADVOGADO por processo e polo
--
-- Escrita: worker (service role). O hub le tudo e escreve a fila (botao
-- "Buscar processos") e a garantia informada, como authenticated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fila
-- ---------------------------------------------------------------------------

create table if not exists public.radar_pje_fila (
  id bigserial primary key,
  cnpj text not null references public.radar_empresas(cnpj),
  -- maior primeiro; o botao manual da tela usa 100, o cron usa o score
  prioridade int not null default 0,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'concluido', 'sem_processos', 'erro', 'bloqueado')),
  tentativas int not null default 0,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  erro text,
  unique (cnpj)
);
create index if not exists radar_pje_fila_status_idx
  on public.radar_pje_fila (status, prioridade desc, criado_em);

-- ---------------------------------------------------------------------------
-- Processos
-- ---------------------------------------------------------------------------

create table if not exists public.radar_processos (
  id bigserial primary key,
  cnpj text not null references public.radar_empresas(cnpj),
  -- 25 caracteres com pontuacao, ex.: 5002050-64.2023.4.03.6182
  numero_cnj text not null unique,
  -- 1116 = EXECUCAO FISCAL, 1118 = EMBARGOS A EXECUCAO FISCAL
  classe_codigo int,
  classe_nome text,
  assunto text,
  jurisdicao text,
  orgao_julgador text,
  data_distribuicao date,
  polo_passivo_nome text,
  -- como vem do PJe: 56.1XX.XXX/XXXX-XX (so os 3 primeiros digitos aparecem)
  cnpj_mascarado text,
  ultima_movimentacao_texto text,
  ultima_movimentacao_em timestamptz,
  qtd_movimentacoes int,
  fonte text not null default 'pje_trf3',
  capturado_em timestamptz not null default now()
);
create index if not exists radar_processos_cnpj_idx on public.radar_processos (cnpj);

create table if not exists public.radar_processo_movimentos (
  id bigserial primary key,
  processo_id bigint not null references public.radar_processos(id) on delete cascade,
  ocorrido_em timestamptz not null,
  texto text not null,
  unique (processo_id, ocorrido_em, texto)
);

create table if not exists public.radar_processo_advogados (
  id bigserial primary key,
  processo_id bigint not null references public.radar_processos(id) on delete cascade,
  nome text not null,
  -- formato SP182592
  oab text,
  -- 'passivo' ou 'ativo'
  polo text,
  unique (processo_id, nome, oab)
);
create index if not exists radar_processo_advogados_processo_idx
  on public.radar_processo_advogados (processo_id);

-- ---------------------------------------------------------------------------
-- Colunas novas em radar_empresas
-- ---------------------------------------------------------------------------

alter table public.radar_empresas
  add column if not exists dossie_status text not null default 'nenhum',
  add column if not exists dossie_em timestamptz,
  add column if not exists qtd_execucoes int not null default 0,
  add column if not exists qtd_embargos int not null default 0,
  add column if not exists garantia_informada text,
  add column if not exists garantia_obs text,
  add column if not exists garantia_informada_em timestamptz;

alter table public.radar_empresas drop constraint if exists radar_empresas_dossie_status_check;
alter table public.radar_empresas add constraint radar_empresas_dossie_status_check
  check (dossie_status in ('nenhum', 'fila', 'pronto', 'sem_processos', 'erro'));

alter table public.radar_empresas drop constraint if exists radar_empresas_garantia_informada_check;
alter table public.radar_empresas add constraint radar_empresas_garantia_informada_check
  check (garantia_informada is null or garantia_informada in ('seguro', 'penhora', 'deposito', 'fianca', 'nenhuma', 'nao_sei'));

create index if not exists radar_empresas_dossie_status_idx on public.radar_empresas (dossie_status);

-- ---------------------------------------------------------------------------
-- RLS: leitura e escrita para authenticated. Service role (worker) ignora RLS.
-- ---------------------------------------------------------------------------

alter table public.radar_pje_fila enable row level security;
alter table public.radar_processos enable row level security;
alter table public.radar_processo_movimentos enable row level security;
alter table public.radar_processo_advogados enable row level security;

drop policy if exists "authenticated_radar_pje_fila_all" on public.radar_pje_fila;
create policy "authenticated_radar_pje_fila_all"
  on public.radar_pje_fila for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_radar_processos_all" on public.radar_processos;
create policy "authenticated_radar_processos_all"
  on public.radar_processos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_radar_processo_movimentos_all" on public.radar_processo_movimentos;
create policy "authenticated_radar_processo_movimentos_all"
  on public.radar_processo_movimentos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_radar_processo_advogados_all" on public.radar_processo_advogados;
create policy "authenticated_radar_processo_advogados_all"
  on public.radar_processo_advogados for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- View: advogados que mais defendem executados fiscais (canal de parceria).
-- Um advogado = (nome, oab). Conta processos e empresas distintas em que
-- aparece no polo passivo.
-- ---------------------------------------------------------------------------

create or replace view public.vw_radar_advogados
  with (security_invoker = true) as
  select
    a.nome,
    a.oab,
    count(distinct a.processo_id)::int as processos,
    count(distinct p.cnpj)::int        as empresas
  from public.radar_processo_advogados a
  join public.radar_processos p on p.id = a.processo_id
  where a.polo = 'passivo'
  group by a.nome, a.oab
  order by empresas desc, processos desc, a.nome;

-- ---------------------------------------------------------------------------
-- Score v3: embargos localizados no PJe valem +10 (garantia do juizo
-- confirmada em processo). Resto igual a v2 (migracao 077). Teto 100.
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
      -- Fase 2: embargos a execucao fiscal localizados no PJe = juizo ja garantido
      + (case when e.qtd_embargos >= 1 then 10 else 0 end)
    ))
  end
  from public.radar_empresas e
  where e.cnpj = p_cnpj;
$$;

-- ---------------------------------------------------------------------------
-- Enfileira toda empresa nova, com garantia e sem dossie, prioridade = score.
-- Idempotente (on conflict do nothing na fila). Retorna quantas entraram.
-- ---------------------------------------------------------------------------

create or replace function public.radar_enfileirar_dossies()
returns int
language plpgsql
volatile
set search_path = public
as $$
declare
  v_inseridas int;
begin
  with candidatas as (
    select cnpj, score
    from public.radar_empresas
    where status = 'novo'
      and tem_garantia = true
      and dossie_status = 'nenhum'
  ),
  inseridas as (
    insert into public.radar_pje_fila (cnpj, prioridade)
    select cnpj, score from candidatas
    on conflict (cnpj) do nothing
    returning cnpj
  )
  update public.radar_empresas e
     set dossie_status = 'fila',
         atualizado_em = now()
    from inseridas i
   where e.cnpj = i.cnpj;

  get diagnostics v_inseridas = row_count;
  return v_inseridas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consolida o dossie de uma empresa a partir de radar_processos e recalcula
-- o score (os embargos entram no score).
-- ---------------------------------------------------------------------------

create or replace function public.radar_consolidar_dossie(p_cnpj text)
returns void
language plpgsql
volatile
set search_path = public
as $$
declare
  v_exec int;
  v_emb  int;
begin
  select
    count(*) filter (where classe_codigo = 1116),
    count(*) filter (where classe_codigo = 1118)
    into v_exec, v_emb
  from public.radar_processos
  where cnpj = p_cnpj;

  update public.radar_empresas
     set qtd_execucoes = v_exec,
         qtd_embargos  = v_emb,
         dossie_status = case when (v_exec + v_emb) > 0 then 'pronto' else 'sem_processos' end,
         dossie_em     = now(),
         atualizado_em = now()
   where cnpj = p_cnpj;

  update public.radar_empresas
     set score = public.radar_calcular_score(p_cnpj)
   where cnpj = p_cnpj;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron: enfileira as empresas novas todo dia as 06h de Brasilia (09:00 UTC).
-- Chama funcao SQL direto, como o posvenda-toques-daily.
-- ---------------------------------------------------------------------------

select cron.unschedule('radar-fila-daily')
where exists (select 1 from cron.job where jobname = 'radar-fila-daily');

select cron.schedule('radar-fila-daily', '0 9 * * *', 'select public.radar_enfileirar_dossies()');

-- Primeira carga da fila.
select public.radar_enfileirar_dossies();
