-- 132: estado "emitindo" nas cotações do portal.
--
-- A Edge Function junto-emissao passa a cotação de "emissao_solicitada" (ou
-- "em_analise") para "emitindo" antes de chamar a emissão na Junto. Assim dois
-- cliques, ou duas pessoas da F&G ao mesmo tempo, não emitem a mesma apólice
-- duas vezes. Se a chamada falhar, a função devolve o estado anterior.

alter table public.cotacoes_portal drop constraint if exists cotacoes_portal_status_check;

alter table public.cotacoes_portal add constraint cotacoes_portal_status_check
  check (status in ('cotada', 'recusada', 'emissao_solicitada', 'emitindo', 'em_analise', 'emitida', 'cancelada'));
