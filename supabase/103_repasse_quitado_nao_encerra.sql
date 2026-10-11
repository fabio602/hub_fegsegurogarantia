-- ============================================================================
-- 103: quitar a última parcela do repasse não encerra mais o cadastro
--
-- A RPC avancar_parcela_repasse, ao passar da última parcela, gravava
-- status = 'encerrado'. Só que repasse quitado não é apólice encerrada: o
-- seguro pode ter sido parcelado em 2x e valer por mais um ano. O cadastro
-- caía na lista de encerrados do hub com a apólice vigente.
--
-- Agora, na última parcela: o repasse é desligado (is_repasse = false, data
-- limpa), a parcela fica em total/total (nunca total+1) e o status do cadastro
-- não é tocado. A chave 'encerrado' do retorno continua existindo, com o
-- sentido de "repasse quitado", para o front não quebrar.
-- ============================================================================

create or replace function public.avancar_parcela_repasse(p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_dia          int;
  v_parcela      int;
  v_total        int;
  v_prox         date;
  v_nova_parcela int;
  v_novo_prox    date;
  v_quitou       boolean;
begin
  select dia_vencimento_aluguel, coalesce(parcela_atual, 0), total_parcelas, proximo_vencimento
    into v_dia, v_parcela, v_total, v_prox
    from public.imobiliaria_clientes
   where id = p_id
     for update;

  if not found then
    raise exception 'Cliente % não encontrado', p_id;
  end if;

  v_quitou       := v_total is not null and v_parcela + 1 > v_total;
  -- Quitado fica em total/total: gravar 3/2 quebraria as telas.
  v_nova_parcela := case when v_quitou then v_total else v_parcela + 1 end;

  v_novo_prox := case
    when v_quitou or v_prox is null then null
    else public.proximo_vencimento_do_dia(
           coalesce(v_dia, extract(day from v_prox)::int),
           (v_prox + 1)
         )
  end;

  update public.imobiliaria_clientes
     set parcela_atual        = v_nova_parcela,
         proximo_vencimento   = v_novo_prox,
         ultimo_repasse_pago  = (now() at time zone 'America/Sao_Paulo')::date,
         repasse_pago_em      = null,
         is_repasse           = case when v_quitou then false else is_repasse end,
         updated_at           = now()
   where id = p_id;

  return jsonb_build_object(
    'parcela_atual',      v_nova_parcela,
    'total_parcelas',     v_total,
    'proximo_vencimento', v_novo_prox,
    'encerrado',          v_quitou
  );
end;
$function$;
