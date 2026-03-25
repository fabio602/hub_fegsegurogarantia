-- Lead do site sem depender de `obs`: flag + data de entrada.
-- Rode no SQL Editor do Supabase (depois de 003).

alter table public.residential_clients
  add column if not exists origem_publica boolean not null default false;

alter table public.residential_clients
  add column if not exists created_at timestamptz default now();

alter table public.residential_clients
  alter column created_at set default now();

comment on column public.residential_clients.origem_publica is 'true = cadastro via formulário público (anon)';
comment on column public.residential_clients.created_at is 'Momento em que o registro entrou no sistema';

-- Leads antigos que tinham o marcador no obs
update public.residential_clients
set origem_publica = true
where origem_publica is false
  and situacao = 'Lead (site)'
  and position('[origem:formulario-publico]' in coalesce(obs, '')) > 0;

-- Política pública: não exige mais texto em obs
drop policy if exists "public_insert_residential_lead_form" on public.residential_clients;
create policy "public_insert_residential_lead_form"
  on public.residential_clients
  for insert
  to anon
  with check (
    situacao = 'Lead (site)'
    and origem_publica is true
  );
