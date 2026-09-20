-- 085_email_trilhas_assinatura_linha.sql
-- Permite que uma trilha assine com outra linha que nao "Corretora especialista
-- em Seguro Garantia". Necessario para a trilha saude-pme.
-- ATENCAO: o molde visual vive na Edge Function prospecting-cadence. Aplicar o
-- patch descrito em docs/saude/HUB-SAUDE-FASE1.md, secao 7, senao esta coluna
-- fica gravada e sem efeito.

alter table email_trilhas
  add column if not exists assinatura_linha text not null
  default 'Corretora especialista em Seguro Garantia';

comment on column email_trilhas.assinatura_linha is
  'Linha sob o cargo na assinatura do e-mail. Permite que trilhas de outras linhas de negocio (saude) nao assinem como corretora de Seguro Garantia.';

update email_trilhas
   set assinatura_linha = 'Planos de saude empresariais e Seguro Garantia'
 where slug = 'saude-pme';
