-- 084: alinha o `status` gravado pelo trigger 083 com o que a tela do HUB grava
-- ao encerrar um cadastro (STATUS_CARTEIRA_POR_ENCERRAMENTO em
-- components/ImobiliariaRepasse.tsx).
--
-- Saiu do Imovel, Optou Nao Contratar/Desistiu da Locacao e Reprovado passam a
-- gravar status = 'encerrado' (eram 'cancelado' em tres deles). Sem isso o
-- espelho vindo do Residencial regravava um status diferente do que a tela
-- tinha acabado de salvar. 'Cancelado' continua 'cancelado', que e o que a
-- Carteira do portal destaca em vermelho.
--
-- Aplicada no projeto hfjvwibucplyhsvnwfor em 20/09/2026.

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
    when 'desistiu da locação' then v_status := 'encerrado'; v_status_apolice := 'desistiu';
    when 'optou não contratar' then v_status := 'encerrado'; v_status_apolice := 'desistiu';
    when 'reprovado'           then v_status := 'encerrado'; v_status_apolice := 'reprovado';
    else return new;
  end case;

  update public.imobiliaria_clientes i
     set status         = v_status,
         status_apolice = v_status_apolice,
         is_repasse     = case when v_status = 'ativo' then i.is_repasse else false end,
         updated_at     = now()
   where regexp_replace(coalesce(i.numero_apolice, ''), '\s', '', 'g') = v_apolice
     and (i.status is distinct from v_status
          or i.status_apolice is distinct from v_status_apolice
          or (v_status <> 'ativo' and i.is_repasse is true));

  return new;
end;
$$;
