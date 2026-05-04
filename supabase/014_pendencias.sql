-- Pendências operacionais (Gestão de Resultados — aba Pendências).
create table if not exists public.pendencias (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  responsavel text,
  prazo date,
  prioridade text not null default 'media'
    check (prioridade in ('alta', 'media', 'baixa')),
  concluida boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_pendencias_concluida on public.pendencias (concluida);
create index if not exists idx_pendencias_prazo on public.pendencias (prazo);

comment on table public.pendencias is 'Pendências internas do Hub (Gestão de Resultados).';

create or replace function public.set_pendencias_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_pendencias_atualizado_em on public.pendencias;

create trigger trg_pendencias_atualizado_em
before update on public.pendencias
for each row
execute procedure public.set_pendencias_atualizado_em();

alter table public.pendencias enable row level security;

drop policy if exists "authenticated_pendencias_all" on public.pendencias;
create policy "authenticated_pendencias_all"
  on public.pendencias
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
