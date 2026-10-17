-- ============================================================================
-- 114: Radar · fila do PJe só para SP e MS (TRF3)
--
-- Passo 1 da expansão do Radar para outras UFs. O worker do PJe consulta só o
-- TRF3, que cobre SP e MS; empresa de outra UF que entrar em radar_pje_fila
-- gasta a cota diária procurando processo num tribunal onde ele não está.
--
-- Recria radar_enfileirar_dossies() a partir da versão EM PRODUÇÃO
-- (lida com pg_get_functiondef em 17/10/2026), acrescentando só a condição
-- uf in ('SP', 'MS'). Nada mais muda na função.
--
-- Aditiva: create or replace da mesma assinatura; o cron radar-fila-daily
-- continua chamando a mesma função. Decisão 76 em docs/radar/DECISOES.md.
-- ============================================================================

create or replace function public.radar_enfileirar_dossies()
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_inseridas int;
begin
  with candidatas as (
    select cnpj, score
    from public.radar_empresas
    where status = 'novo'
      and tem_garantia = true
      and dossie_status = 'nenhum'
      and uf in ('SP', 'MS')
  ),
  inseridas as (
    insert into public.radar_pje_fila (cnpj, prioridade)
    select cnpj, score from candidatas
    on conflict (cnpj) do nothing
    returning cnpj
  )
  update public.radar_empresas e
     set dossie_status = 'fila',
         atualizado_em = now()
    from inseridas i
   where e.cnpj = i.cnpj;

  get diagnostics v_inseridas = row_count;
  return v_inseridas;
end;
$function$;
