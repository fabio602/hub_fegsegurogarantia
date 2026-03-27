-- Agenda (Hub) - incluir Fábio na lista de funcionários
-- Rode no SQL Editor do Supabase se você já aplicou o 008 antes deste seed.

begin;

insert into public.agenda_staff (name)
values ('Fábio')
on conflict (name) do nothing;

commit;
