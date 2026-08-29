-- ============================================================================
-- 039: Sobras da fila valem para os dias seguintes
--
-- Antes, quando a janela do dia acabava (11:30 BRT) com CNPJs pendentes, o
-- restante da fila morria com a execucao. Agora as sobras ainda validas
-- entram como PRIMEIRAS da fila do dia seguinte, ate a validade configurada
-- (padrao 3 dias a contar do dia do contrato). Assim uma empresa que venceu
-- na sexta ainda recebe o e-mail na segunda ou terca, quando esta fechando a
-- garantia.
-- ============================================================================

alter table public.prospeccao_pncp_config
  add column if not exists fila_validade_dias integer not null default 3;

comment on column public.prospeccao_pncp_config.fila_validade_dias is
  'Por quantos dias um CNPJ pendente da fila continua valido e migra para a fila dos dias seguintes.';

-- O dia do contrato viaja com o item da fila: e ele que define a validade,
-- mesmo depois de o item migrar de execucao.
alter table public.prospeccao_pncp_fila
  add column if not exists data_referencia date;

update public.prospeccao_pncp_fila f
set data_referencia = e.data_referencia
from public.prospeccao_pncp_execucoes e
where e.id = f.execucao_id
  and f.data_referencia is null;

comment on column public.prospeccao_pncp_fila.data_referencia is
  'Dia dos contratos de origem (nao muda quando o item migra de execucao). Define a validade da sobra.';
