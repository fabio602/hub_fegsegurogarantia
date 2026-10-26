-- ============================================================================
-- 121_pncp_fila_frescor.sql
-- Fila da prospeccao PNCP: sobras valem nos dias seguintes, a homologacao
-- mais recente sai primeiro, e lead com Gmail passa a contar no limite.
--
-- Por que (medido em 26/10/2026):
--   1. A funcao processa so a fila da execucao do dia. O que sobra alem do
--      limite diario (30) ficava 'pendente' para sempre: 3.040 itens desde
--      29/08, 315 CNPJs com homologacao de ate 15 dias. A migracao 039 tinha
--      previsto migrar as sobras, mas a funcao deixou de fazer isso.
--   2. A fila era ordenada por valor. Com o limite de 30, o dia era gasto com
--      licitacao de 60 a 90 dias enquanto as de 3 dias esperavam: dos 39
--      leads de 26/10, so 8 tinham homologacao de ate 15 dias.
--   3. A coluna tipo_email nao aceitava 'provedor_gratuito' (Gmail, Hotmail),
--      entao o registro desses leads falhava em silencio: o lead entrava no
--      Kanban, mas nao contava no limite diario nem no relatorio (351 casos
--      desde 15/09).
--
-- O que muda:
--   - prospeccao_pncp_config.fila_validade_dias passa a contar da DATA DA
--     HOMOLOGACAO (contrato->>'dataHomologacao') e vale 30, a mesma janela do
--     arquivo do Kanban (migracao 118).
--   - pncp_fila_priorizar(execucao): chamada pela funcao a cada tique. Traz
--     para a execucao do dia as pendentes de execucoes anteriores ainda dentro
--     da validade, descarta as vencidas, os CNPJs repetidos e os que ja estao
--     no Kanban ou na carteira, e renumera a fila por homologacao mais
--     recente (empate: maior valor).
-- ============================================================================

alter table public.prospeccao_pncp_leads
  drop constraint if exists prospeccao_pncp_leads_tipo_email_check;
alter table public.prospeccao_pncp_leads
  add constraint prospeccao_pncp_leads_tipo_email_check
  check (tipo_email = any (array['direto', 'generico_corporativo', 'contador', 'provedor_gratuito']));

update public.prospeccao_pncp_config set fila_validade_dias = 30;
comment on column public.prospeccao_pncp_config.fila_validade_dias is
  'Dias, contados da data da homologacao, em que um CNPJ pendente da fila continua valido e passa para a fila dos dias seguintes.';

create or replace function public.pncp_fila_priorizar(p_execucao uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dias      integer;
  v_corte     date;
  v_migrados  integer := 0;
  v_vencidos  integer := 0;
  v_repetidos integer := 0;
begin
  select coalesce(fila_validade_dias, 30) into v_dias from prospeccao_pncp_config where id = 1;
  v_corte := current_date - v_dias;

  -- Pendentes de execucoes reais (nao dry run) que nao sao a de hoje: as fora
  -- da validade (ou sem data) saem, as dentro vem para a execucao de hoje.
  with pend as (
    select f.id,
           case when f.contrato->>'dataHomologacao' ~ '^\d{4}-\d{2}-\d{2}'
                then (f.contrato->>'dataHomologacao')::date end as homol
      from prospeccao_pncp_fila f
      join prospeccao_pncp_execucoes e on e.id = f.execucao_id
     where f.estado = 'pendente'
       and not e.dry_run
       and f.execucao_id <> p_execucao
  )
  update prospeccao_pncp_fila f set estado = 'descartado', atualizado_em = now()
    from pend p
   where f.id = p.id and (p.homol is null or p.homol < v_corte);
  get diagnostics v_vencidos = row_count;

  with pend as (
    select f.id
      from prospeccao_pncp_fila f
      join prospeccao_pncp_execucoes e on e.id = f.execucao_id
     where f.estado = 'pendente'
       and not e.dry_run
       and f.execucao_id <> p_execucao
       and f.contrato->>'dataHomologacao' ~ '^\d{4}-\d{2}-\d{2}'
       and (f.contrato->>'dataHomologacao')::date >= v_corte
  )
  update prospeccao_pncp_fila f set execucao_id = p_execucao, atualizado_em = now()
    from pend p
   where f.id = p.id;
  get diagnostics v_migrados = row_count;

  -- Um item por CNPJ (fica o de homologacao mais recente) e nada que ja esteja
  -- no Kanban ou na carteira.
  with fila as (
    select f.id, f.cnpj,
           row_number() over (
             partition by f.cnpj
             order by (f.contrato->>'dataHomologacao') desc nulls last,
                      coalesce((f.contrato->>'valor')::numeric, 0) desc
           ) as rn
      from prospeccao_pncp_fila f
     where f.execucao_id = p_execucao and f.estado = 'pendente'
  ), sair as (
    select id from fila where rn > 1
    union
    select fl.id from fila fl
     where exists (select 1 from prospects pr where regexp_replace(coalesce(pr.cnpj, ''), '\D', '', 'g') = fl.cnpj)
        or exists (select 1 from sales s where regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g') = fl.cnpj)
        or exists (select 1 from leads_seguro_garantia l where regexp_replace(coalesce(l.cnpj, ''), '\D', '', 'g') = fl.cnpj)
  )
  update prospeccao_pncp_fila f set estado = 'descartado', atualizado_em = now()
    from sair where f.id = sair.id;
  get diagnostics v_repetidos = row_count;

  -- Renumera: homologacao mais recente primeiro, empate pelo maior valor.
  with ord as (
    select f.id,
           row_number() over (
             order by (f.contrato->>'dataHomologacao') desc nulls last,
                      coalesce((f.contrato->>'valor')::numeric, 0) desc,
                      f.ordem
           ) as nova
      from prospeccao_pncp_fila f
     where f.execucao_id = p_execucao and f.estado = 'pendente'
  )
  update prospeccao_pncp_fila f set ordem = ord.nova
    from ord where f.id = ord.id and f.ordem is distinct from ord.nova;

  return jsonb_build_object('migrados', v_migrados, 'vencidos', v_vencidos, 'repetidos_ou_conhecidos', v_repetidos);
end;
$$;

revoke all on function public.pncp_fila_priorizar(uuid) from public, anon, authenticated;
grant execute on function public.pncp_fila_priorizar(uuid) to service_role;
