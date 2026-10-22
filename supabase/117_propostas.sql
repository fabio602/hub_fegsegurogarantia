-- 117: propostas comerciais de Seguro Garantia geradas pelo HUB (menu Cotações > Gerar Proposta).
-- Cada proposta salva o que foi apresentado ao tomador (IS, prêmio, honorários, total)
-- e os dados internos do cálculo (taxa, comissão), que não saem no PDF.

create sequence if not exists public.propostas_seq;

create table if not exists public.propostas (
    id               uuid primary key default gen_random_uuid(),
    seq              bigint not null default nextval('public.propostas_seq'),
    numero           text unique,
    tomador_nome     text not null,
    tomador_cnpj     text,
    responsavel      text,
    importancia_segurada numeric(16,2) not null default 0,
    taxa_aa          numeric(8,4),
    prazo_dias       integer,
    premio_minimo    numeric(14,2),
    premio_cotado    numeric(14,2),
    premio           numeric(14,2) not null default 0,
    comissao_perc    numeric(6,2),
    comissao_valor   numeric(14,2),
    honorario_perc   numeric(6,3),
    honorario_valor  numeric(14,2) not null default 0,
    total            numeric(14,2) not null default 0,
    vigencia_inicio  date,
    vigencia_fim     date,
    observacoes      text,
    status           text not null default 'aberta' check (status in ('aberta', 'aceita', 'recusada')),
    autor_email      text default (auth.jwt() ->> 'email'),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

alter sequence public.propostas_seq owned by public.propostas.seq;

create index if not exists propostas_created_idx on public.propostas (created_at desc);
create index if not exists propostas_cnpj_idx on public.propostas (tomador_cnpj);

alter table public.propostas enable row level security;

grant select, insert, update, delete on table public.propostas to authenticated;
grant select, insert, update, delete on table public.propostas to service_role;
grant usage, select on sequence public.propostas_seq to authenticated, service_role;

drop policy if exists authenticated_propostas_all on public.propostas;
create policy authenticated_propostas_all on public.propostas
    for all to authenticated using (true) with check (true);

-- Número no formato FG-AAAA-0001 e updated_at automático.
create or replace function public.propostas_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' and (new.numero is null or new.numero = '') then
        new.numero := 'FG-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY') || '-' || lpad(new.seq::text, 4, '0');
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_propostas_before_write on public.propostas;
create trigger trg_propostas_before_write
    before insert or update on public.propostas
    for each row execute function public.propostas_before_write();
