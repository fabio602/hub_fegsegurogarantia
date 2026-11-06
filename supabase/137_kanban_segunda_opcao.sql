-- 137: coluna "2ª opção" no Kanban (06/11/2026, decisão do Fábio)
--
-- Quem participou de uma licitação homologada e NÃO venceu também é lead de
-- Seguro Garantia (participa com frequência e precisa de garantia de
-- proposta), mas com prioridade menor que o vencedor. Esses leads entram com
-- source = 'pncp_participante' e status = '2ª opção', numa coluna fixa logo
-- depois de Novos Leads. A tarefa noturna que lê as propostas no PNCP é quem
-- cria esses leads, a partir das atas e relatórios com dados dos
-- participantes (BLL, BNC, AMM Licita/Licitar Digital, Compras.gov).
--
-- O arquivamento automático da 118 passa a valer também para eles: 30 dias
-- depois da homologação, sem nenhum toque, saem para o Arquivo PNCP.

insert into public.kanban_colunas (id, title, color, protected, ordem)
values ('2ª opção', '2ª opção (participantes)', 'fg_blue_2', true, 5)
on conflict (id) do nothing;

create or replace function public.arquivar_leads_pncp_antigos(p_dias integer default 30)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_qtd integer;
begin
  update public.prospects p
     set status = 'Arquivo PNCP',
         status_entered_at = now()
   where (
           (p.source = 'pncp_auto' and p.status = 'Novos Leads')
        or (p.source = 'pncp_participante' and p.status = '2ª opção')
         )
     and p.data_homologacao is not null
     and p.data_homologacao < current_date - p_dias
     and not exists (select 1 from public.prospect_toques t where t.prospect_id = p.id);
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$function$;
