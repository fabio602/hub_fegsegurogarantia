-- Agenda (Hub) - cargo/função do funcionário (editável)
-- Rode no SQL Editor do Supabase.

begin;

alter table public.agenda_staff
  add column if not exists cargo text;

update public.agenda_staff
set cargo = coalesce(cargo, 'Responsável')
where cargo is null;

alter table public.agenda_staff
  alter column cargo set default 'Responsável';

comment on column public.agenda_staff.cargo is 'Cargo/função exibido na Agenda (editável)';

commit;

