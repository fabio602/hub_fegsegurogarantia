-- 083: replica a situacao de residential_clients para imobiliaria_clientes.
--
-- Contexto: o portal da imobiliaria le imobiliaria_clientes.status_apolice,
-- mas o cancelamento e registrado em residential_clients.situacao. Nao havia
-- ligacao nenhuma entre as duas tabelas, entao uma apolice cancelada no modulo
-- Residencial continuava aparecendo como ativa no portal do parceiro
-- (caso SANDRA LIMA DE ALMEIDA, apolice 9665636, 20/09/2026), e pior: seguia
-- com is_repasse = true, gerando cobranca de repasse para a imobiliaria.
--
-- Aplicada no projeto hfjvwibucplyhsvnwfor em 20/09/2026, junto com o backfill
-- comentado no fim do arquivo (so na direcao de desativacao, nunca reativando).
-- Ver tambem 084, que ajusta o `status` de tres situacoes.

create or replace function public.sync_situacao_residencial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_status_apolice text;
  v_apolice text;
begin
  v_apolice := regexp_replace(coalesce(new.apolice, ''), '\s', '', 'g');
  if v_apolice = '' then
    return new;
  end if;

  case lower(trim(coalesce(new.situacao, '')))
    when 'ativo'               then v_status := 'ativo';     v_status_apolice := 'ativo';
    when 'pendente renovação'  then v_status := 'ativo';     v_status_apolice := 'ativo';
    when 'cancelado'           then v_status := 'cancelado'; v_status_apolice := 'cancelado';
    when 'vencido'             then v_status := 'encerrado'; v_status_apolice := 'vencido';
    when 'saiu do imóvel'      then v_status := 'encerrado'; v_status_apolice := 'saiu_imovel';
    when 'desistiu da locação' then v_status := 'cancelado'; v_status_apolice := 'desistiu';
    when 'optou não contratar' then v_status := 'cancelado'; v_status_apolice := 'desistiu';
    when 'reprovado'           then v_status := 'cancelado'; v_status_apolice := 'reprovado';
    else return new;  -- 'Lead (site)' e qualquer valor novo nao mexem no portal
  end case;

  update public.imobiliaria_clientes i
     set status         = v_status,
         status_apolice = v_status_apolice,
         -- apolice fora do ar nao gera cobranca de repasse
         is_repasse     = case when v_status = 'ativo' then i.is_repasse else false end,
         updated_at     = now()
   where regexp_replace(coalesce(i.numero_apolice, ''), '\s', '', 'g') = v_apolice
     and (i.status is distinct from v_status
          or i.status_apolice is distinct from v_status_apolice
          or (v_status <> 'ativo' and i.is_repasse is true));

  return new;
end;
$$;

drop trigger if exists trg_sync_situacao_residencial on public.residential_clients;

create trigger trg_sync_situacao_residencial
after insert or update of situacao, apolice on public.residential_clients
for each row
execute function public.sync_situacao_residencial();

-- Backfill aplicado junto:
-- update residential_clients set situacao = situacao
--  where lower(trim(coalesce(situacao,''))) in
--        ('cancelado','vencido','saiu do imóvel','desistiu da locação','optou não contratar','reprovado')
--    and coalesce(apolice,'') <> '';
