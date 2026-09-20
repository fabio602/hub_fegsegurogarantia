-- 093_email_cadencia_origem_garimpo_livre.sql
--
-- Conserta uma bomba-relogio no check de `origem`.
--
-- A Edge Function `garimpo` grava origem como 'garimpo_' || slug da campanha
-- (index.ts, linha 1359). O check antigo listava um por um os slugs que ja
-- existiam: garimpo_imobiliarias, garimpo_consultores, garimpo_energia. Ou
-- seja, TODA campanha nova quebrava o insert ate alguem lembrar de alterar a
-- constraint, e a quebra acontece dentro de um cron: falha calada, ninguem
-- inscrito, e nenhum aviso.
--
-- A campanha de saude ja estava nessa armadilha: o slug e 'saude-pme', entao
-- a origem seria 'garimpo_saude-pme', fora da lista. Ligar a campanha nao
-- inscreveria ninguem.
--
-- Agora qualquer origem que comece com 'garimpo_' passa, que e exatamente o
-- contrato da funcao. Os valores fixos continuam listados porque nao seguem
-- esse padrao. Entra tambem 'saude_manual', usado pela inclusao manual de
-- empresas na aba Prospecção do modulo de Saude.

alter table email_cadencia drop constraint if exists email_cadencia_origem_check;

alter table email_cadencia add constraint email_cadencia_origem_check
  check (
    origem in ('hub', 'csv', 'pncp_auto', 'saude_manual')
    or origem like 'garimpo\_%'
  );

comment on column email_cadencia.origem is
  'De onde o contato veio. Valores fixos: hub, csv, pncp_auto, saude_manual. '
  'Campanhas de garimpo gravam garimpo_<slug>, liberado por padrao para nao '
  'quebrar a cada campanha nova.';
