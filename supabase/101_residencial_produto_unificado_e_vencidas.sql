-- 101_residencial_produto_unificado_e_vencidas.sql
-- Aplicada no projeto real em 26/09/2026 (migracao de mesmo nome).
--
-- 1. Produto passa a ter tres valores, os mesmos que o formulario publico e o
--    portal da imobiliaria gravam: 'Apenas Seguro Residencial',
--    'Apenas Garantia Locaticia' e 'Garantia Locaticia & Seguro Residencial'.
--    Os nomes antigos ('Residencial', 'Residencial + Locaticia') e as duas
--    variantes com erro de digitacao ('Locaicia', vindas da Edge Function
--    imobiliaria-nova-cotacao, corrigida na v20) sao migrados; o valor original
--    fica em produto_legado para conferencia ou volta.
--
-- 2. Situacao acompanha a vigencia: residencial_marcar_vencidas() vira 'Ativo'
--    em 'Vencido' quando o fim da vigencia passou ha mais de 7 dias (folga para
--    a renovacao que ainda nao foi digitada). O gatilho sync_situacao_residencial
--    ja leva 'Vencido' ao portal da imobiliaria, onde o cliente aparece nas
--    pendencias com Renovar / Nao vai renovar / Renovada.
--    Cron 'residencial-vencidas-daily' as 8h de Brasilia (11:00 UTC).

alter table public.residential_clients add column if not exists produto_legado text;

update public.residential_clients
   set produto_legado = produto,
       produto = case
         when produto = 'Residencial' and tem_garantia = 'Sim' then 'Garantia Locatícia & Seguro Residencial'
         when produto = 'Residencial'                          then 'Apenas Seguro Residencial'
         when produto = 'Residencial + Locatícia'              then 'Garantia Locatícia & Seguro Residencial'
         when produto = 'Locatícia'                            then 'Apenas Garantia Locatícia'
         when produto = 'Garantia Locaícia & Seguro Residencial' then 'Garantia Locatícia & Seguro Residencial'
         when produto = 'Apenas Garantia Locaícia'             then 'Apenas Garantia Locatícia'
         else produto
       end
 where produto in ('Residencial', 'Residencial + Locatícia', 'Locatícia',
                   'Garantia Locaícia & Seguro Residencial', 'Apenas Garantia Locaícia');

create or replace function public.residencial_marcar_vencidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.residential_clients
     set situacao = 'Vencido'
   where situacao = 'Ativo'
     and fim_vigencia is not null
     and fim_vigencia < current_date - 7;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.residencial_marcar_vencidas() from anon, authenticated, public;

select cron.schedule(
  'residencial-vencidas-daily',
  '0 11 * * *',
  $$select public.residencial_marcar_vencidas()$$
);
