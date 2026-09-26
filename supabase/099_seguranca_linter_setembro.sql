-- 099_seguranca_linter_setembro.sql
--
-- Fecha os avisos do linter de seguranca do Supabase levantados em 26/09/2026.
-- Aplicada no projeto real na mesma data (migracao 099_seguranca_linter_setembro).
-- Nada aqui muda comportamento para usuario logado: as tabelas por tras das
-- views ja liberam tudo para authenticated, e os gatilhos disparam sem checar
-- EXECUTE do chamador (testado em transacao antes de aplicar).

-- 1. Views passam a respeitar as permissoes de quem consulta, nao de quem criou.
alter view public.vw_posvenda_revisar set (security_invoker = true);
alter view public.saude_envios_para_apagar set (security_invoker = true);

-- 2. Funcoes SECURITY DEFINER que so o cron (postgres) e o gatilho chamam:
--    ninguem precisa dispara-las pela API REST.
revoke execute on function public.inscrever_endosso_novas_apolices() from anon, authenticated, public;
revoke execute on function public.sync_situacao_residencial() from anon, authenticated, public;

-- 3. search_path fixo nas funcoes que ainda herdavam o do chamador.
alter function public.set_vendeu_at() set search_path = public;
alter function public.gerar_toques_posvenda(date) set search_path = public;
alter function public.sales_marca_vendeu_at() set search_path = public;
alter function public.proximo_vencimento_do_dia(integer, date) set search_path = public;
alter function public.avancar_parcela_repasse(uuid) set search_path = public;
alter function public.radar_sem_acento(text) set search_path = public;
alter function public.radar_em_recuperacao(text, text) set search_path = public;
alter function public.unimed_leads_touch() set search_path = public;
alter function public.unimed_calcular_cotacao(text, jsonb, text[]) set search_path = public;
