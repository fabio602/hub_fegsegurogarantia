-- 087_unimed_leads_status_acentuado.sql
-- Os rotulos do funil passam a ser gravados acentuados, iguais ao que a tela
-- mostra, evitando mapa de traducao entre UI e banco.

alter table unimed_leads drop constraint if exists unimed_leads_status_ck;

update unimed_leads set status = case status
  when 'Cotacao enviada'   then 'Cotação enviada'
  when 'Documentacao'      then 'Documentação'
  when 'Entrevista medica' then 'Entrevista médica'
  else status end;

alter table unimed_leads add constraint unimed_leads_status_ck check (status in (
  'Novo',
  'Contato feito',
  'Cotação enviada',
  'Documentação',
  'Entrevista médica',
  'Implantado',
  'Perdido'
));
