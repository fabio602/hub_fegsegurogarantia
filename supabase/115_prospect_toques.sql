-- 115: registro de toques manuais (WhatsApp e e-mail) nos leads do Kanban.
-- Cada clique em "Confirmar" no card grava uma linha aqui, com canal, autor e
-- data. O trigger mantém prospects.ult_contato igual ao toque mais recente.

create table if not exists public.prospect_toques (
    id           uuid primary key default gen_random_uuid(),
    prospect_id  uuid not null references public.prospects(id) on delete cascade,
    canal        text not null check (canal in ('whatsapp', 'email')),
    autor_email  text default (auth.jwt() ->> 'email'),
    created_at   timestamptz not null default now()
);

create index if not exists prospect_toques_prospect_idx
    on public.prospect_toques (prospect_id, created_at desc);

alter table public.prospect_toques enable row level security;

grant select, insert, update, delete on table public.prospect_toques to authenticated;
grant select, insert, update, delete on table public.prospect_toques to service_role;

drop policy if exists authenticated_prospect_toques_all on public.prospect_toques;
create policy authenticated_prospect_toques_all on public.prospect_toques
    for all to authenticated using (true) with check (true);

-- ult_contato acompanha o último toque (inclusive quando um toque é desfeito).
create or replace function public.prospect_toques_sync_ult_contato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid := coalesce(new.prospect_id, old.prospect_id);
begin
    update public.prospects p
       set ult_contato = (select max(t.created_at) from public.prospect_toques t where t.prospect_id = v_id)
     where p.id = v_id;
    return null;
end;
$$;

drop trigger if exists trg_prospect_toques_sync on public.prospect_toques;
create trigger trg_prospect_toques_sync
    after insert or delete on public.prospect_toques
    for each row execute function public.prospect_toques_sync_ult_contato();
