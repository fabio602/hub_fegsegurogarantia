-- 064_seguradora_nome_padrao.sql
-- `sales.seguradora` era texto livre e acumulou 29 grafias para 11
-- seguradoras. Esta migração normaliza o histórico para o nome do painel
-- (tabela `insurers`) e o formulário passa a usar uma lista fechada.
--
-- 1. Backup da coluna antes de mexer, para voltar se algum mapeamento
--    estiver errado: `update sales s set seguradora = b.seguradora from
--    sales_seguradora_backup_20260903 b where b.id = s.id`.
create table if not exists sales_seguradora_backup_20260903 as
  select id, seguradora, now() as backup_em from sales;
alter table sales_seguradora_backup_20260903 enable row level security;

-- 2. Nome do painel com o espaço corrigido.
update insurers set nome = 'Allseg / ASAS' where nome = 'Allseg/ ASAS';

-- 3. Grafias encontradas em 03/09/2026 -> nome do painel. Casa pelo texto
--    exato (com trim), sem tocar em nada que não esteja listado. Creditag e
--    HR Cred ficaram de fora de propósito: não existem no painel e o Fábio
--    ainda vai decidir o destino delas.
update sales set seguradora = 'Allseg / ASAS'
  where trim(seguradora) in ('ALLSEG SEGURADORA S/A', 'Allseg', 'Allseg Seguradora', 'ASAS');
update sales set seguradora = 'AVLA'
  where trim(seguradora) in ('Avla', 'AVLA Seguros Brasil S.A.', 'AVLA SEGUROS BRASIL S.A');
update sales set seguradora = 'Pottencial Seguradora'
  where trim(seguradora) in ('POTTENCIAL SEGURADORA S/A', 'Pottencial', 'Pottencial Seguradora S A', 'Potencial');
update sales set seguradora = 'Sombrero'
  where trim(seguradora) in ('SOMBRERO SEGUROS S/A');
update sales set seguradora = 'Sancor'
  where trim(seguradora) in ('SANCOR SEGUROS DO BRASIL S.A.', 'SANCOR SEGUROS DO BRASIL S.A');
update sales set seguradora = 'Tokio Marine'
  where trim(seguradora) in ('Tokio', 'Tókio');
update sales set seguradora = 'Junto Seguros'
  where trim(seguradora) in ('JUNTO SEGUROS S.A', 'Junto');
update sales set seguradora = 'AXA'
  where trim(seguradora) in ('AXA SEGUROS S.A', 'AXA Seguros S.A');
update sales set seguradora = 'NEWE'
  where trim(seguradora) in ('Newe');
