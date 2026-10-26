-- ============================================================================
-- 120_pncp_monitor_situacao_processo.sql
-- Separa o numero do processo da situacao da contratacao no pncp_monitor.
--
-- Por que: a prospeccao-pncp gravava o numero do processo (raw.processo) na
-- coluna `situacao`, entao o monitor nunca soube se a licitacao estava
-- revogada, anulada ou suspensa. A partir desta versao:
--   - `processo` guarda o numero do processo (coluna nova);
--   - `situacao` guarda o situacaoCompraNome do PNCP ("Divulgada no PNCP",
--     "Revogada", "Anulada", "Suspensa"), e as tres ultimas saem do monitor.
--
-- Dados existentes: o que estava em `situacao` era o processo, entao vai para
-- `processo` e `situacao` fica nula ate a licitacao reaparecer no feed.
--
-- Tabela existente: nao precisa de grant novo.
-- ============================================================================

alter table public.pncp_monitor
  add column if not exists processo text;

comment on column public.pncp_monitor.processo is
  'Numero do processo administrativo da licitacao (raw.processo do PNCP).';
comment on column public.pncp_monitor.situacao is
  'situacaoCompraNome do PNCP. Revogada, Anulada e Suspensa saem do monitor.';

update public.pncp_monitor
   set processo = situacao,
       situacao = null
 where processo is null
   and situacao is not null
   and situacao not in ('Divulgada no PNCP', 'Revogada', 'Anulada', 'Suspensa');
