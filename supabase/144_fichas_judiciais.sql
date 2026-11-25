-- 144: fichas de garantia judicial enviadas pelo formulário público
-- judicial.fegsegurogarantia.com (24/11/2026, decisão do Fábio).
--
-- O cliente (empresa ou o advogado da causa) preenche a ficha de depósito
-- recursal trabalhista no site. A Edge Function ficha-judicial valida tudo de
-- novo no servidor, grava a ficha aqui, devolve o protocolo e as URLs de upload
-- assinadas dos documentos, e dispara os e-mails (confirmação para o cliente e
-- aviso para o Fábio).
--
-- 1) fichas_judiciais: uma linha por ficha. Os campos seguem a ficha padrão
--    de garantia judicial pedida pelas seguradoras (17 itens), para o HUB
--    gerar o documento para qualquer seguradora sem redigitar nada.
-- 2) Protocolo no formato GJ-AAMMDD-1001 e updated_at automático.
-- 3) Bucket privado fichas-judiciais para sentença, cálculo e procuração.
--
-- Segurança: o site NUNCA lê nem grava direto com a anon key. Não há grant
-- nem policy para anon. Só a function (service role) insere; a equipe logada
-- no HUB lê e atualiza (status e notas). Ninguém apaga pela tela: ficha
-- indevida vira status 'descartada'.

-- 1 ---------------------------------------------------------------------------
create sequence if not exists public.fichas_judiciais_seq start with 1001;

create table if not exists public.fichas_judiciais (
    id                    uuid primary key default gen_random_uuid(),
    seq                   bigint not null default nextval('public.fichas_judiciais_seq'),
    protocolo             text unique,
    status                text not null default 'recebida'
                          check (status in ('recebida', 'em_analise', 'cotada', 'emitida', 'cancelada', 'descartada')),

    -- Quem preencheu (é com esta pessoa que a F&G fala)
    contato_nome          text not null,
    contato_papel         text not null check (contato_papel in ('advogado', 'empresa')),
    contato_email         text not null,
    contato_telefone      text not null,

    -- Empresa que contrata a garantia (tomador, a reclamada). Item 2 da ficha.
    tomador_cnpj          text not null,
    tomador_razao_social  text not null,
    tomador_cep           text not null,
    tomador_endereco      text not null,
    tomador_cidade        text not null,
    tomador_uf            text not null check (tomador_uf ~ '^[A-Z]{2}$'),

    -- Processo. Itens 3 a 8 da ficha.
    processo_numero       text not null check (processo_numero ~ '^[0-9]{7}-[0-9]{2}\.[0-9]{4}\.[0-9]\.[0-9]{2}\.[0-9]{4}$'),
    processo_juizo        text not null,
    valor_causa           numeric(14,2) not null check (valor_causa > 0),
    data_distribuicao     date not null,
    recurso               text not null,
    tipo_caucao           text not null check (tipo_caucao in ('nova', 'substituicao', 'adicional')),

    -- Reclamante (autor da ação). Item 1 da ficha.
    reclamante_nome       text not null,
    reclamante_documento  text not null,
    reclamante_endereco   text,

    -- Parecer jurídico. Itens 8 a 11 da ficha.
    objeto                text not null,
    historico             text not null,
    linha_defesa          text not null,
    probabilidade_exito   text not null check (probabilidade_exito in ('provavel', 'possivel', 'remota')),

    -- Advogado que patrocina a causa. Itens 16 e 17.
    advogado_nome         text not null,
    advogado_oab          text not null,
    advogado_oab_uf       text not null check (advogado_oab_uf ~ '^[A-Z]{2}$'),

    -- Valor. Itens 12 a 15. valor_garantia = valor_base com o acréscimo de 30%
    -- pedido na ficha, calculado pela function (nunca aceito do navegador).
    valor_base            numeric(14,2) not null check (valor_base > 0),
    valor_garantia        numeric(14,2) not null check (valor_garantia >= valor_base),
    data_base             date not null,
    indice_reajuste       text not null,
    objetivo              text not null,
    segurado              text,
    observacoes           text,

    -- Documentos no bucket privado fichas-judiciais:
    -- [{ path, nome, tamanho, tipo, categoria }], categoria = sentenca | calculo | procuracao.
    anexos                jsonb not null default '[]'::jsonb,
    anexos_concluidos_em  timestamptz,

    -- Controle
    lgpd_aceite_em        timestamptz not null,
    token_envio           uuid not null default gen_random_uuid(),
    origem_hash           text,
    email_cliente_em      timestamptz,
    email_interno_em      timestamptz,
    notas_internas        text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

alter sequence public.fichas_judiciais_seq owned by public.fichas_judiciais.seq;

create index if not exists fichas_judiciais_created_idx on public.fichas_judiciais (created_at desc);
create index if not exists fichas_judiciais_status_idx  on public.fichas_judiciais (status, created_at desc);
create index if not exists fichas_judiciais_cnpj_idx    on public.fichas_judiciais (tomador_cnpj);
create index if not exists fichas_judiciais_origem_idx  on public.fichas_judiciais (origem_hash, created_at desc);

comment on table public.fichas_judiciais is
  'Fichas de garantia judicial (depósito recursal trabalhista) enviadas pelo formulário judicial.fegsegurogarantia.com, via Edge Function ficha-judicial.';
comment on column public.fichas_judiciais.token_envio is
  'Token devolvido só a quem enviou a ficha, usado para confirmar o upload dos anexos. Não é exibido no HUB.';
comment on column public.fichas_judiciais.origem_hash is
  'Hash do IP de origem (não o IP), usado só para limitar envios repetidos.';

alter table public.fichas_judiciais enable row level security;

grant select, update on table public.fichas_judiciais to authenticated;
grant select, insert, update, delete on table public.fichas_judiciais to service_role;
grant usage, select on sequence public.fichas_judiciais_seq to service_role;

drop policy if exists fichas_judiciais_equipe_le on public.fichas_judiciais;
create policy fichas_judiciais_equipe_le on public.fichas_judiciais
    for select to authenticated using (true);

drop policy if exists fichas_judiciais_equipe_atualiza on public.fichas_judiciais;
create policy fichas_judiciais_equipe_atualiza on public.fichas_judiciais
    for update to authenticated using (true) with check (true);

-- 2 ---------------------------------------------------------------------------
create or replace function public.fichas_judiciais_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' and (new.protocolo is null or new.protocolo = '') then
        new.protocolo := 'GJ-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYMMDD') || '-' || new.seq::text;
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_fichas_judiciais_before_write on public.fichas_judiciais;
create trigger trg_fichas_judiciais_before_write
    before insert or update on public.fichas_judiciais
    for each row execute function public.fichas_judiciais_before_write();

-- 3 ---------------------------------------------------------------------------
-- 20 MB por arquivo. O cliente sobe por URL de upload assinada gerada pela
-- Edge Function, então não precisa de policy de insert. O HUB só lê.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fichas-judiciais', 'fichas-judiciais', false, 20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do nothing;

drop policy if exists "fichas_judiciais_ler_hub" on storage.objects;
create policy "fichas_judiciais_ler_hub" on storage.objects
  for select to authenticated
  using (bucket_id = 'fichas-judiciais');

-- Aplicada no banco em 24/11/2026 (pelo Fábio, no SQL Editor).
