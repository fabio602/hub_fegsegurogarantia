-- ============================================================================
-- 104: adiar o vencimento em um mês e desfazer a última baixa do repasse
--
-- Dois botões novos na linha do cliente, na tela Repasse Imobiliárias:
--   Adiar 1 mês     -> adiar_vencimento_repasse(p_id)
--   Desfazer baixa  -> desfazer_baixa_repasse(p_id)
--
-- Para a baixa poder ser desfeita, avancar_parcela_repasse passa a guardar em
-- repasse_baixa_anterior o retrato do cadastro antes da baixa. Sem isso não dá
-- para voltar um repasse quitado: a data some e is_repasse é desligado.
-- É um desfazer de um nível só (a última baixa).
-- ============================================================================

alter table public.imobiliaria_clientes
  add column if not exists repasse_baixa_anterior jsonb;

comment on column public.imobiliaria_clientes.repasse_baixa_anterior is
  'Retrato do repasse antes da última baixa (parcela, vencimento, is_repasse, último pago). Usado pelo Desfazer baixa.';

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
  v_repasse      boolean;
  v_ultimo       date;
  v_nova_parcela int;
  v_novo_prox    date;
  v_quitou       boolean;
begin
  select dia_vencimento_aluguel, coalesce(parcela_atual, 0), total_parcelas, proximo_vencimento, is_repasse, ultimo_repasse_pago
    into v_dia, v_parcela, v_total, v_prox, v_repasse, v_ultimo
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
     set repasse_baixa_anterior = jsonb_build_object(
           'parcela_atual',       v_parcela,
           'proximo_vencimento',  v_prox,
           'is_repasse',          v_repasse,
           'ultimo_repasse_pago', v_ultimo
         ),
         parcela_atual        = v_nova_parcela,
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

-- Volta o cadastro ao que era antes da última baixa e apaga o retrato, para
-- o mesmo desfazer não ser aplicado duas vezes.
create or replace function public.desfazer_baixa_repasse(p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ant jsonb;
begin
  select repasse_baixa_anterior into v_ant
    from public.imobiliaria_clientes
   where id = p_id
     for update;

  if not found then
    raise exception 'Cliente % não encontrado', p_id;
  end if;
  if v_ant is null then
    raise exception 'Não há baixa para desfazer neste cliente.';
  end if;

  update public.imobiliaria_clientes
     set parcela_atual          = (v_ant->>'parcela_atual')::int,
         proximo_vencimento     = (v_ant->>'proximo_vencimento')::date,
         is_repasse             = coalesce((v_ant->>'is_repasse')::boolean, true),
         ultimo_repasse_pago    = (v_ant->>'ultimo_repasse_pago')::date,
         repasse_baixa_anterior = null,
         updated_at             = now()
   where id = p_id;

  return jsonb_build_object(
    'parcela_atual',      (v_ant->>'parcela_atual')::int,
    'proximo_vencimento', (v_ant->>'proximo_vencimento')::date
  );
end;
$function$;

-- Empurra o vencimento da parcela em aberto para o mesmo dia do mês seguinte,
-- sem mexer no número da parcela. Não é baixa: a parcela continua devida.
create or replace function public.adiar_vencimento_repasse(p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_dia  int;
  v_prox date;
  v_novo date;
begin
  select dia_vencimento_aluguel, proximo_vencimento into v_dia, v_prox
    from public.imobiliaria_clientes
   where id = p_id
     for update;

  if not found then
    raise exception 'Cliente % não encontrado', p_id;
  end if;
  if v_prox is null then
    raise exception 'Este cliente não tem data de vencimento para adiar.';
  end if;

  -- Parte do dia 1º do mês seguinte, e não de v_prox + 1: assim uma data que
  -- esteja antes do dia do aluguel no mesmo mês também pula de mês.
  v_novo := public.proximo_vencimento_do_dia(
              coalesce(v_dia, extract(day from v_prox)::int),
              (date_trunc('month', v_prox) + interval '1 month')::date
            );

  update public.imobiliaria_clientes
     set proximo_vencimento = v_novo,
         updated_at         = now()
   where id = p_id;

  return jsonb_build_object('de', v_prox, 'para', v_novo);
end;
$function$;
