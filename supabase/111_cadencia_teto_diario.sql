-- ============================================================================
-- 111_cadencia_teto_diario.sql
-- Teto diario de envios da cadencia, configuravel sem deploy.
--
-- Por que: o cron da cadencia nao tem teto de volume. O limite que existe e
-- de UM e-mail por contato por rodada, que nao e a mesma coisa: com 723
-- contatos com etapa vencida, a rodada tenta mandar 723 e-mails de uma vez.
-- O recorde historico do dominio e 120 num dia (14/09/2026), entao seria 6x o
-- pico, de uma vez, depois de 12 dias de silencio. E o jeito mais rapido de
-- queimar a reputacao do dominio.
--
-- Mora aqui, e nao numa tabela nova, porque reputacao_envio ja e a tabela que
-- governa o envio (pausa global, limites de bounce) e o cron ja a le em toda
-- rodada. Tabela nova precisaria de grants proprios e de uma segunda leitura.
--
-- Trocar o teto e um update nesta coluna. Sem deploy.
-- ============================================================================
alter table public.reputacao_envio
  add column if not exists limite_diario_envios integer not null default 50;

comment on column public.reputacao_envio.limite_diario_envios is
  'Teto de e-mails que a cadencia manda por dia. O cron para ao atingir o teto e retoma no dia seguinte, dos contatos com data_inicio mais recente para os mais antigos. 0 para nao enviar nada (use o pausado para isso, que registra o motivo).';

-- Guarda-corpo: teto negativo viraria "nunca enviar" por acidente de digitacao,
-- sem o registro de motivo que o `pausado` obriga.
alter table public.reputacao_envio
  drop constraint if exists reputacao_envio_limite_diario_nao_negativo;
alter table public.reputacao_envio
  add constraint reputacao_envio_limite_diario_nao_negativo
  check (limite_diario_envios >= 0);
