-- 138: todos os vencedores de cada licitação, com o valor de cada um
-- (06/11/2026)
--
-- Até aqui o pncp_monitor guardava só o vencedor principal e o lead recebia o
-- valor homologado da licitação INTEIRA. Em licitação por itens isso inflava
-- o valor (TJBA 83/2026: CS levou R$ 4,83 mi, o lead mostrava R$ 13,09 mi,
-- soma dos 3 itens) e descartava os outros vencedores (Mainan e Continental).
-- A prospeccao-pncp passa a gravar a lista em vencedores e a criar um lead
-- por vencedor, com o valor que ele levou. Linhas antigas, sem a lista,
-- seguem como antes.

alter table public.pncp_monitor
  add column if not exists vencedores jsonb;
