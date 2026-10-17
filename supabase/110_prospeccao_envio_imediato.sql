-- ============================================================================
-- 110_prospeccao_envio_imediato.sql
-- A flag que decide se o lead do PNCP recebe o 1o e-mail sozinho.
--
-- false (padrao, novo comportamento): enviarLead() insere o lead no Kanban e
-- na trilha com ativo = false e NAO chama a prospecting-cadence. O lead fica
-- "aguardando 1o e-mail" ate o Fabio enviar o e-mail da licitacao pelo card.
--
-- true: volta o comportamento antigo, o E1 generico da trilha `garantia` sai
-- no instante em que o lead entra. E o botao de rollback: trocar a flag
-- desfaz a mudanca sem deploy nenhum.
-- ============================================================================
alter table public.prospeccao_pncp_config
  add column if not exists envio_imediato boolean not null default false;

comment on column public.prospeccao_pncp_config.envio_imediato is
  'false: o lead entra sem e-mail e espera o envio manual do e-mail da licitacao pelo card do Kanban. true: comportamento antigo, o E1 da trilha sai sozinho na entrada do lead. Serve de rollback sem deploy.';
