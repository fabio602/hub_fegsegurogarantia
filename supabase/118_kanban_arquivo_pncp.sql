-- ============================================================================
-- 118_kanban_arquivo_pncp.sql
-- Tira do Kanban os leads do PNCP que esfriaram sem contato.
--
-- Por que: em 25/10/2026 havia 820 leads do PNCP em "Novos Leads", 670 parados
-- ha mais de 7 dias e so 2 com algum toque registrado. A equipe trabalha uns
-- 30 por dia, entao o quadro virou estoque e o lead quente (homologacao
-- recente, contrato ainda por assinar) se perdia no meio dos frios.
--
-- O que sai: lead com origem pncp_auto, ainda em "Novos Leads", homologacao
-- ha mais de 30 dias e nenhum toque manual (prospect_toques). Na primeira
-- rodada sao 561; 496 deles ja tinham recebido os e-mails da trilha na epoca
-- do envio automatico. Nenhum e-mail novo e disparado por esta migracao.
--
-- Nada e apagado: o lead so muda de status para 'Arquivo PNCP', que nao e
-- coluna do quadro. A tela esconde esse status e a caixa "Ver arquivo PNCP"
-- mostra de novo. Como o CNPJ continua em prospects, a deduplicacao da
-- prospeccao-pncp segue impedindo que o mesmo vencedor entre outra vez.
--
-- COMO REVERTER:
--   update public.prospects set status = 'Novos Leads'
--    where status = 'Arquivo PNCP';
-- e para parar o arquivamento diario:
--   select cron.unschedule('kanban-arquivo-pncp-daily');
-- ============================================================================

create or replace function public.arquivar_leads_pncp_antigos(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd integer;
begin
  update public.prospects p
     set status = 'Arquivo PNCP',
         status_entered_at = now()
   where p.source = 'pncp_auto'
     and p.status = 'Novos Leads'
     and p.data_homologacao is not null
     and p.data_homologacao < current_date - p_dias
     and not exists (select 1 from public.prospect_toques t where t.prospect_id = p.id);
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

revoke all on function public.arquivar_leads_pncp_antigos(integer) from public, anon, authenticated;

-- Primeira rodada.
select public.arquivar_leads_pncp_antigos(30);

-- Todo dia as 7h40 de Brasilia (10:40 UTC), antes de a equipe abrir o quadro.
select cron.unschedule('kanban-arquivo-pncp-daily')
 where exists (select 1 from cron.job where jobname = 'kanban-arquivo-pncp-daily');
select cron.schedule(
  'kanban-arquivo-pncp-daily',
  '40 10 * * *',
  $$select public.arquivar_leads_pncp_antigos(30)$$
);
