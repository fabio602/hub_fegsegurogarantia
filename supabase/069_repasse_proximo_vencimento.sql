-- ============================================================================
-- 069: repasse da imobiliária passa a ter a data completa do próximo vencimento
--
-- Até aqui a cobrança guardava só o NÚMERO do dia (dia_vencimento_aluguel) e
-- cada consumidor recalculava "que dia será daqui a 10 dias" na mão. Isso não
-- distinguia meses e errava na virada (agosto tem 31 dias, fevereiro 28).
-- Agora a tabela guarda `proximo_vencimento` como date, avançado um mês a cada
-- parcela pela RPC `avancar_parcela_repasse`, e a Edge Function
-- imobiliaria-repasse-aviso (v15) compara essa data com hoje + 10 direto.
--
-- Este arquivo registra o que já está aplicado em produção (coluna, funções e
-- preenchimento inicial). É idempotente: pode rodar de novo sem efeito.
-- ============================================================================

alter table public.imobiliaria_clientes
  add column if not exists proximo_vencimento date;

comment on column public.imobiliaria_clientes.proximo_vencimento is
  'Data completa do próximo vencimento do repasse. Avança um mês a cada parcela.';

-- Primeira data >= p_a_partir cujo dia do mês é p_dia. Se o mês não tem o
-- dia (31 em abril, 29/30/31 em fevereiro), usa o último dia daquele mês.
create or replace function public.proximo_vencimento_do_dia(p_dia integer, p_a_partir date)
returns date
language plpgsql
immutable
as $function$
declare
  v_mes  date := date_trunc('month', p_a_partir)::date;
  v_ult  int;
  v_data date;
begin
  if p_dia is null then
    return null;
  end if;
  for i in 0..1 loop
    v_ult  := extract(day from (v_mes + interval '1 month - 1 day'))::int;
    v_data := v_mes + (least(p_dia, v_ult) - 1);
    if v_data >= p_a_partir then
      return v_data;
    end if;
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  return v_data;
end;
$function$;

comment on function public.proximo_vencimento_do_dia(integer, date) is
  'Primeira data >= p_a_partir que cai no dia p_dia do mês (ou no último dia do mês, se o mês for mais curto).';

-- Preenchimento inicial: quem está em repasse e ainda não tem a data recebe
-- o próximo vencimento a partir de hoje (Brasília), calculado do dia do aluguel.
update public.imobiliaria_clientes
   set proximo_vencimento = public.proximo_vencimento_do_dia(
         dia_vencimento_aluguel,
         (now() at time zone 'America/Sao_Paulo')::date
       )
 where is_repasse = true
   and proximo_vencimento is null
   and dia_vencimento_aluguel is not null;

-- Botão "Avançar Parcela" do hub. Substitui o update feito no front:
--   parcela + 1, próximo vencimento um mês à frente, e ao passar do total
--   encerra o repasse (is_repasse = false, data limpa, status = 'encerrado')
--   para o cadastro sair da cobrança sozinho e entrar no painel de encerrados,
--   como fazia o botão Encerrar antigo. Trava a linha (for update) para dois
--   cliques não pularem duas parcelas.
create or replace function public.avancar_parcela_repasse(p_id uuid)
returns jsonb
language plpgsql
as $function$
declare
  v_dia          int;
  v_parcela      int;
  v_total        int;
  v_prox         date;
  v_nova_parcela int;
  v_novo_prox    date;
  v_encerrou     boolean;
begin
  select dia_vencimento_aluguel, coalesce(parcela_atual, 0), total_parcelas, proximo_vencimento
    into v_dia, v_parcela, v_total, v_prox
    from public.imobiliaria_clientes
   where id = p_id
     for update;

  if not found then
    raise exception 'Cliente % não encontrado', p_id;
  end if;

  v_nova_parcela := v_parcela + 1;
  v_encerrou     := v_total is not null and v_nova_parcela > v_total;

  v_novo_prox := case
    when v_prox is null then null
    else public.proximo_vencimento_do_dia(
           coalesce(v_dia, extract(day from v_prox)::int),
           (v_prox + 1)
         )
  end;

  update public.imobiliaria_clientes
     set parcela_atual        = v_nova_parcela,
         proximo_vencimento   = case when v_encerrou then null else v_novo_prox end,
         ultimo_repasse_pago  = (now() at time zone 'America/Sao_Paulo')::date,
         repasse_pago_em      = null,
         is_repasse           = case when v_encerrou then false else is_repasse end,
         status               = case when v_encerrou then 'encerrado' else status end,
         updated_at           = now()
   where id = p_id;

  return jsonb_build_object(
    'parcela_atual',      v_nova_parcela,
    'total_parcelas',     v_total,
    'proximo_vencimento', case when v_encerrou then null else v_novo_prox end,
    'encerrado',          v_encerrou
  );
end;
$function$;

comment on function public.avancar_parcela_repasse(uuid) is
  'Avança a parcela do repasse e o próximo vencimento em um mês; encerra o repasse ao passar do total. Retorna {parcela_atual, total_parcelas, proximo_vencimento, encerrado}.';

grant execute on function public.avancar_parcela_repasse(uuid) to authenticated, service_role;
