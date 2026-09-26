-- 100_remove_tabelas_backup_agosto_setembro.sql
--
-- Remove as cinco fotografias de dados excluidos nas limpezas de 28/08, 03/09
-- e 06/09/2026 (prospects, tarefas do CRM e coluna seguradora da sales).
-- Tres semanas sem uso, nenhuma view, gatilho, funcao ou FK dependia delas
-- (conferido em 26/09/2026 antes de apagar). Eram os ultimos avisos do linter.
-- Aplicada no projeto real em 26/09/2026.
drop table if exists public.crm_tasks_apagadas_20260828;
drop table if exists public.prospects_apagados_20260828;
drop table if exists public.prospects_apagados_20260906;
drop table if exists public.prospects_apagados_garimpo_20260906;
drop table if exists public.sales_seguradora_backup_20260903;
