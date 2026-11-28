-- ============================================================================
-- 147: comprovante de repasse por cliente e parcela (28/11/2026, decisão do Fábio)
--
-- Hoje a imobiliária manda o comprovante do PIX pelo WhatsApp e a baixa é o
-- botão "Avançar Parcela". O histórico (imobiliaria_repasses) é por mês, com um
-- total e um comprovante só. Esta migração cria o registro por cliente e por
-- parcela, que é o que o portal e o HUB vão usar:
--
--   enviado          -> a imobiliária anexou o comprovante no portal
--   recusado         -> a F&G devolveu (valor errado, comprovante de outro cliente)
--   recebido         -> o Fábio conferiu no banco e confirmou (a parcela avança)
--   pago_seguradora  -> o Fábio já repassou o valor à seguradora
--
-- Decisões do Fábio: toda baixa espera o clique dele (nada de baixa automática);
-- a imobiliária faz um PIX por cliente; a lista "A pagar para a seguradora" fica
-- só no HUB; lembrete por e-mail quando o repasse passa do vencimento.
--
-- SÓ ACRESCENTA: nenhuma tabela, coluna ou função existente é alterada. As
-- funções avancar_parcela_repasse e desfazer_baixa_repasse (migração 104)
-- continuam iguais e são chamadas daqui.
--
-- Segurança: o portal NUNCA lê nem grava esta tabela com a anon key, e o bucket
-- é privado. Tudo o que vem da imobiliária passa por Edge Function que confere
-- o token do login (como a s8-analise) e usa a service role.
-- ============================================================================

-- 1) Tabela ------------------------------------------------------------------
create table if not exists public.imobiliaria_repasse_pagamentos (
    id                     uuid primary key default gen_random_uuid(),

    -- Cadastro do Repasse. Se o cadastro for apagado o pagamento fica (é
    -- registro financeiro), por isso o retrato do nome e da apólice abaixo.
    client_id              uuid references public.imobiliaria_clientes(id) on delete set null,
    partner_id             integer not null,

    -- Retrato da parcela no momento do envio (o cadastro muda quando avança).
    inquilino_nome         text,
    numero_apolice         text,
    seguradora             text,
    parcela                integer not null check (parcela > 0),
    total_parcelas         integer,
    vencimento             date,
    valor_esperado         numeric(12,2),

    origem                 text not null default 'portal'
                           check (origem in ('portal', 'manual')),
    status                 text not null default 'enviado'
                           check (status in ('enviado', 'recusado', 'recebido', 'pago_seguradora')),

    -- Comprovante (caminho dentro do bucket privado repasse-comprovantes).
    comprovante_path       text,
    comprovante_nome       text,
    comprovante_enviado_em timestamptz,

    -- Leitura do comprovante por regras (valor, data, pagador, id da transação).
    leitura                jsonb,
    leitura_confere        boolean,
    id_transacao           text,

    recusado_em            timestamptz,
    recusa_motivo          text,

    recebido_em            timestamptz,
    recebido_por           uuid,
    -- true quando a confirmação avançou a parcela do cadastro (o desfazer usa).
    avancou_parcela        boolean,

    pago_seguradora_em     date,
    pago_seguradora_por    uuid,

    -- Hora do e-mail de aviso ao Fábio (a function manda uma vez por envio).
    aviso_fg_enviado_em    timestamptz,

    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    -- Só a baixa manual (sem portal) pode ficar sem comprovante.
    constraint imobiliaria_repasse_pagamentos_comprovante_ck
        check (origem = 'manual' or comprovante_path is not null)
);

comment on table public.imobiliaria_repasse_pagamentos is
  'Repasse da imobiliária por cliente e parcela: comprovante enviado no portal, confirmação do recebimento pela F&G e pagamento à seguradora.';

-- Uma parcela tem no máximo um pagamento "vivo". O vencimento entra na chave
-- porque na renovação a contagem de parcelas recomeça no mesmo cadastro.
create unique index if not exists imobiliaria_repasse_pagamentos_parcela_uk
    on public.imobiliaria_repasse_pagamentos (client_id, parcela, coalesce(vencimento, date '0001-01-01'))
    where status <> 'recusado' and client_id is not null;

-- O mesmo PIX não serve para duas parcelas.
create unique index if not exists imobiliaria_repasse_pagamentos_transacao_uk
    on public.imobiliaria_repasse_pagamentos (id_transacao)
    where id_transacao is not null and status <> 'recusado';

create index if not exists imobiliaria_repasse_pagamentos_partner_idx
    on public.imobiliaria_repasse_pagamentos (partner_id, status);

-- 2) Grants e RLS ------------------------------------------------------------
alter table public.imobiliaria_repasse_pagamentos enable row level security;

-- Fecha a porta no grant também (lição da migração 145): anon não entra.
revoke all on table public.imobiliaria_repasse_pagamentos from anon;
revoke all on table public.imobiliaria_repasse_pagamentos from authenticated;

grant select, insert, update, delete on table public.imobiliaria_repasse_pagamentos to authenticated;
grant select, insert, update, delete on table public.imobiliaria_repasse_pagamentos to service_role;

drop policy if exists imobiliaria_repasse_pagamentos_equipe on public.imobiliaria_repasse_pagamentos;
create policy imobiliaria_repasse_pagamentos_equipe on public.imobiliaria_repasse_pagamentos
    for all to authenticated using (true) with check (true);

-- updated_at automático
create or replace function public.imobiliaria_repasse_pagamentos_before_update()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists imobiliaria_repasse_pagamentos_bu on public.imobiliaria_repasse_pagamentos;
create trigger imobiliaria_repasse_pagamentos_bu
    before update on public.imobiliaria_repasse_pagamentos
    for each row execute function public.imobiliaria_repasse_pagamentos_before_update();

-- 3) Bucket privado para os comprovantes -------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'repasse-comprovantes', 'repasse-comprovantes', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- A equipe logada no HUB lê. Quem grava é a Edge Function (service role), por
-- URL de upload assinada; a imobiliária vê o próprio comprovante por link
-- assinado que a function devolve.
drop policy if exists "repasse_comprovantes_ler_hub" on storage.objects;
create policy "repasse_comprovantes_ler_hub" on storage.objects
  for select to authenticated
  using (bucket_id = 'repasse-comprovantes');

-- 4) Lembrete de atraso ------------------------------------------------------
alter table public.imobiliaria_clientes
  add column if not exists repasse_atraso_avisado_em date;

comment on column public.imobiliaria_clientes.repasse_atraso_avisado_em is
  'Dia do último e-mail de repasse em atraso enviado à imobiliária para a parcela em aberto. Evita mandar o mesmo lembrete todo dia.';

-- 5) Portal: registrar o comprovante (só a Edge Function, com service role) ---
-- Tira o retrato da parcela em aberto e grava o comprovante. Se a parcela já
-- tem um comprovante ainda não conferido, troca o arquivo (a imobiliária
-- anexou o errado e mandou de novo). Parcela já confirmada não aceita outro.
create or replace function public.repasse_registrar_comprovante(
  p_client_id  uuid,
  p_partner_id integer,
  p_path       text,
  p_nome       text
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  c        record;
  v_id     uuid;
  v_status text;
begin
  if p_path is null or left(p_path, length(p_partner_id::text || '/' || p_client_id::text || '/'))
                       <> p_partner_id::text || '/' || p_client_id::text || '/' then
    raise exception 'Caminho de arquivo inválido';
  end if;

  select id, partner_id, inquilino_nome, numero_apolice, seguradora, parcela_atual,
         total_parcelas, proximo_vencimento, valor_seguro, is_repasse
    into c
    from public.imobiliaria_clientes
   where id = p_client_id
     for update;

  if not found or c.partner_id is distinct from p_partner_id then
    raise exception 'Cadastro não encontrado para esta imobiliária';
  end if;
  if c.is_repasse is not true or coalesce(c.valor_seguro, 0) <= 0 or coalesce(c.parcela_atual, 0) < 1 then
    raise exception 'Este cliente não tem parcela de repasse em aberto';
  end if;

  select id, status into v_id, v_status
    from public.imobiliaria_repasse_pagamentos
   where client_id = p_client_id
     and parcela = c.parcela_atual
     and coalesce(vencimento, date '0001-01-01') = coalesce(c.proximo_vencimento, date '0001-01-01')
     and status <> 'recusado'
     for update;

  if found then
    if v_status <> 'enviado' then
      raise exception 'Esta parcela já foi confirmada pela F&G';
    end if;
    update public.imobiliaria_repasse_pagamentos
       set comprovante_path       = p_path,
           comprovante_nome       = left(coalesce(p_nome, ''), 200),
           comprovante_enviado_em = now(),
           leitura                = null,
           leitura_confere        = null,
           id_transacao           = null,
           aviso_fg_enviado_em    = null
     where id = v_id;
    return v_id;
  end if;

  insert into public.imobiliaria_repasse_pagamentos (
    client_id, partner_id, inquilino_nome, numero_apolice, seguradora,
    parcela, total_parcelas, vencimento, valor_esperado,
    origem, status, comprovante_path, comprovante_nome, comprovante_enviado_em
  ) values (
    p_client_id, p_partner_id, c.inquilino_nome, c.numero_apolice, c.seguradora,
    c.parcela_atual, c.total_parcelas, c.proximo_vencimento, c.valor_seguro,
    'portal', 'enviado', p_path, left(coalesce(p_nome, ''), 200), now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.repasse_registrar_comprovante(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.repasse_registrar_comprovante(uuid, integer, text, text) to service_role;

-- 6) HUB: confirmar o recebimento (o clique do Fábio) -------------------------
-- Marca como recebido e dá a baixa da parcela pelo mesmo caminho do botão
-- "Avançar Parcela". Se o cadastro já estiver adiante (alguém deu a baixa por
-- fora), só marca o recebimento, sem avançar de novo.
create or replace function public.confirmar_recebimento_repasse(p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  p         record;
  v_parcela int;
  v_repasse boolean;
  v_avancou boolean := false;
begin
  select * into p from public.imobiliaria_repasse_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', p_id;
  end if;
  if p.status <> 'enviado' then
    raise exception 'Este comprovante não está aguardando conferência (situação atual: %).', p.status;
  end if;

  if p.client_id is not null then
    select coalesce(parcela_atual, 0), is_repasse into v_parcela, v_repasse
      from public.imobiliaria_clientes where id = p.client_id for update;
    if found and v_repasse is true and v_parcela = p.parcela then
      perform public.avancar_parcela_repasse(p.client_id);
      v_avancou := true;
    end if;
  end if;

  update public.imobiliaria_repasse_pagamentos
     set status          = 'recebido',
         recebido_em     = now(),
         recebido_por    = auth.uid(),
         avancou_parcela = v_avancou
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'recebido', 'avancou_parcela', v_avancou);
end;
$function$;

-- 7) HUB: desfazer a confirmação ----------------------------------------------
-- Volta para "enviado" e desfaz a baixa do cadastro. Só enquanto a última baixa
-- do cadastro for a desta parcela (o desfazer da 104 é de um nível só).
create or replace function public.desfazer_recebimento_repasse(p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  p     record;
  v_ant jsonb;
begin
  select * into p from public.imobiliaria_repasse_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', p_id;
  end if;
  if p.status = 'pago_seguradora' then
    raise exception 'Este repasse já foi pago à seguradora. Desmarque o pagamento antes de desfazer o recebimento.';
  end if;
  if p.status <> 'recebido' then
    raise exception 'Não há recebimento confirmado para desfazer.';
  end if;

  if p.avancou_parcela is true and p.client_id is not null then
    select repasse_baixa_anterior into v_ant
      from public.imobiliaria_clientes where id = p.client_id for update;
    if v_ant is null or (v_ant->>'parcela_atual')::int is distinct from p.parcela then
      raise exception 'Este cliente teve outra baixa depois desta. Não dá para desfazer automaticamente; ajuste a parcela no cadastro.';
    end if;
    perform public.desfazer_baixa_repasse(p.client_id);
  end if;

  if p.origem = 'manual' then
    delete from public.imobiliaria_repasse_pagamentos where id = p_id;
    return jsonb_build_object('id', p_id, 'status', 'removido');
  end if;

  update public.imobiliaria_repasse_pagamentos
     set status = 'enviado', recebido_em = null, recebido_por = null, avancou_parcela = null
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'enviado');
end;
$function$;

-- 8) HUB: recusar o comprovante ------------------------------------------------
-- A parcela volta a ficar em aberto no portal, com o motivo, e a imobiliária
-- pode anexar outro.
create or replace function public.recusar_comprovante_repasse(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
  v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 500)), '');
begin
  if v_motivo is null then
    raise exception 'Informe o motivo da recusa (a imobiliária vai ler).';
  end if;
  select status into v_status from public.imobiliaria_repasse_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', p_id;
  end if;
  if v_status <> 'enviado' then
    raise exception 'Só dá para recusar comprovante que ainda não foi confirmado.';
  end if;

  update public.imobiliaria_repasse_pagamentos
     set status = 'recusado', recusado_em = now(), recusa_motivo = v_motivo
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'recusado');
end;
$function$;

-- 9) HUB: pagamento à seguradora -----------------------------------------------
create or replace function public.marcar_repasse_pago_seguradora(p_id uuid, p_data date default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
  v_data   date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  select status into v_status from public.imobiliaria_repasse_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', p_id;
  end if;
  if v_status <> 'recebido' then
    raise exception 'Confirme o recebimento da imobiliária antes de marcar o pagamento à seguradora.';
  end if;

  update public.imobiliaria_repasse_pagamentos
     set status = 'pago_seguradora', pago_seguradora_em = v_data, pago_seguradora_por = auth.uid()
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'pago_seguradora', 'pago_seguradora_em', v_data);
end;
$function$;

create or replace function public.desmarcar_repasse_pago_seguradora(p_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from public.imobiliaria_repasse_pagamentos where id = p_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', p_id;
  end if;
  if v_status <> 'pago_seguradora' then
    raise exception 'Este repasse não está marcado como pago à seguradora.';
  end if;

  update public.imobiliaria_repasse_pagamentos
     set status = 'recebido', pago_seguradora_em = null, pago_seguradora_por = null
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'recebido');
end;
$function$;

-- 10) HUB: baixa sem comprovante no portal --------------------------------------
-- Para quando a imobiliária ainda mandar o comprovante por fora. Faz a mesma
-- baixa de hoje e deixa o registro, para o valor entrar em "A pagar para a
-- seguradora" do mesmo jeito.
create or replace function public.registrar_recebimento_manual_repasse(p_client_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  c    record;
  v_id uuid;
begin
  select id, partner_id, inquilino_nome, numero_apolice, seguradora, parcela_atual,
         total_parcelas, proximo_vencimento, valor_seguro, is_repasse
    into c
    from public.imobiliaria_clientes
   where id = p_client_id
     for update;

  if not found then
    raise exception 'Cliente % não encontrado', p_client_id;
  end if;
  if c.is_repasse is not true or coalesce(c.parcela_atual, 0) < 1 then
    raise exception 'Este cliente não tem parcela de repasse em aberto.';
  end if;
  if c.partner_id is null then
    raise exception 'Este cadastro não está ligado a uma imobiliária.';
  end if;

  if exists (
    select 1 from public.imobiliaria_repasse_pagamentos
     where client_id = p_client_id
       and parcela = c.parcela_atual
       and coalesce(vencimento, date '0001-01-01') = coalesce(c.proximo_vencimento, date '0001-01-01')
       and status <> 'recusado'
  ) then
    raise exception 'Esta parcela já tem comprovante enviado pelo portal. Confirme o recebimento por ele.';
  end if;

  insert into public.imobiliaria_repasse_pagamentos (
    client_id, partner_id, inquilino_nome, numero_apolice, seguradora,
    parcela, total_parcelas, vencimento, valor_esperado,
    origem, status, recebido_em, recebido_por, avancou_parcela
  ) values (
    p_client_id, c.partner_id, c.inquilino_nome, c.numero_apolice, c.seguradora,
    c.parcela_atual, c.total_parcelas, c.proximo_vencimento, c.valor_seguro,
    'manual', 'recebido', now(), auth.uid(), true
  )
  returning id into v_id;

  perform public.avancar_parcela_repasse(p_client_id);

  return jsonb_build_object('id', v_id, 'status', 'recebido');
end;
$function$;

-- As funções do HUB são só para a equipe logada.
revoke all on function public.confirmar_recebimento_repasse(uuid)            from public, anon;
revoke all on function public.desfazer_recebimento_repasse(uuid)             from public, anon;
revoke all on function public.recusar_comprovante_repasse(uuid, text)        from public, anon;
revoke all on function public.marcar_repasse_pago_seguradora(uuid, date)     from public, anon;
revoke all on function public.desmarcar_repasse_pago_seguradora(uuid)        from public, anon;
revoke all on function public.registrar_recebimento_manual_repasse(uuid)     from public, anon;

grant execute on function public.confirmar_recebimento_repasse(uuid)         to authenticated, service_role;
grant execute on function public.desfazer_recebimento_repasse(uuid)          to authenticated, service_role;
grant execute on function public.recusar_comprovante_repasse(uuid, text)     to authenticated, service_role;
grant execute on function public.marcar_repasse_pago_seguradora(uuid, date)  to authenticated, service_role;
grant execute on function public.desmarcar_repasse_pago_seguradora(uuid)     to authenticated, service_role;
grant execute on function public.registrar_recebimento_manual_repasse(uuid)  to authenticated, service_role;

-- Conferência depois de rodar (deve voltar 1 tabela, 1 bucket privado e 7 funções):
--   select count(*) from information_schema.tables where table_name = 'imobiliaria_repasse_pagamentos';
--   select id, public from storage.buckets where id = 'repasse-comprovantes';
--   select proname from pg_proc where pronamespace = 'public'::regnamespace
--    and proname in ('repasse_registrar_comprovante','confirmar_recebimento_repasse',
--      'desfazer_recebimento_repasse','recusar_comprovante_repasse','marcar_repasse_pago_seguradora',
--      'desmarcar_repasse_pago_seguradora','registrar_recebimento_manual_repasse');
