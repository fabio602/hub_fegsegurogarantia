-- 107 — Data de homologação dos leads do PNCP no Kanban
--
-- Desde 10/09/2026 a prospecção automática do PNCP (source = 'pncp_auto')
-- tem como gatilho a homologação da licitação. A data ficava só no texto da
-- descrição do lead, que é reescrito quando o lead é editado no Kanban. Esta
-- coluna guarda a data de forma estável para o card mostrar há quantos dias
-- a licitação foi homologada e para ordenar a coluna pelos mais quentes.
--
-- A data é a que a função prospeccao-pncp grava em pncp_monitor.homologado_em
-- (data em que a homologação apareceu no PNCP).
--
-- Leads anteriores a 10/09 (regra antiga, contrato publicado) não têm
-- registro no pncp_monitor e ficam com a coluna nula.

alter table public.prospects
  add column if not exists data_homologacao date;

-- Preenche automaticamente nos leads novos do PNCP, sem precisar mexer na
-- Edge Function: procura a licitação no pncp_monitor pelo número de controle
-- e, se não achar, lê a linha "Homologada em: AAAA-MM-DD" da descrição.
create or replace function public.prospects_preencher_data_homologacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data date;
  v_txt text;
begin
  if new.data_homologacao is not null or new.source is distinct from 'pncp_auto' then
    return new;
  end if;

  if new.numero_licitacao is not null then
    select m.homologado_em into v_data
      from public.pncp_monitor m
     where m.numero_controle_pncp = new.numero_licitacao
       and m.homologado_em is not null
     order by m.homologado_em desc
     limit 1;
  end if;

  if v_data is null and new.description is not null then
    v_txt := substring(new.description from 'Homologada em: (\d{4}-\d{2}-\d{2})');
    if v_txt is not null then
      begin
        v_data := v_txt::date;
      exception when others then
        v_data := null;
      end;
    end if;
  end if;

  new.data_homologacao := v_data;
  return new;
end;
$$;

revoke all on function public.prospects_preencher_data_homologacao() from public, anon, authenticated;

drop trigger if exists trg_prospects_data_homologacao on public.prospects;
create trigger trg_prospects_data_homologacao
  before insert or update of numero_licitacao, description, source on public.prospects
  for each row execute function public.prospects_preencher_data_homologacao();

-- Carga inicial dos leads que já estão no Kanban.
update public.prospects p
   set data_homologacao = m.homologado_em
  from public.pncp_monitor m
 where p.source = 'pncp_auto'
   and p.data_homologacao is null
   and m.numero_controle_pncp = p.numero_licitacao
   and m.homologado_em is not null;

create index if not exists prospects_data_homologacao_idx
  on public.prospects (data_homologacao desc)
  where data_homologacao is not null;
