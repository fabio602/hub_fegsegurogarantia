-- 130: parceiros de seguro garantia marcados como "Escalonado (contrato)" que
-- ficaram sem a tabela de faixas.
--
-- Até esta correção o tipo de comissão do formulário de Parceiros do HUB não
-- gravava comissao_faixas, então um parceiro novo escolhido como escalonado
-- (Apex Licitações, criado em 04/11/2026) continuava em 20% fixo no portal e no
-- repasse. Agora o HUB grava a tabela ao salvar; esta migração acerta quem já
-- estava cadastrado assim. Imobiliárias ficam de fora (repasse mensal).

update public.partners
   set comissao_faixas = '{"imposto_pct":6,"faixas":[{"ate":10000,"pct":10},{"ate":30000,"pct":20},{"ate":50000,"pct":30},{"ate":80000,"pct":40},{"ate":null,"pct":50}]}'::jsonb
 where partner_type = 'seguro_garantia'
   and coalesce(commission_type, 'escalonado') = 'escalonado'
   and comissao_faixas is null;
