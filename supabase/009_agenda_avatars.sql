-- Agenda (Hub) - Avatares persistentes (Supabase Storage)
-- Rode no SQL Editor do Supabase.
--
-- O que isso faz:
-- 1) Adiciona `avatar_url` na tabela public.agenda_staff
-- 2) Cria o bucket `agenda-avatars` (público) para armazenar as fotos
-- 3) Políticas (RLS) para usuários autenticados:
--    - ler imagens do bucket
--    - inserir/atualizar/deletar imagens do bucket

begin;

-- 1) Coluna para persistir a URL pública da foto
alter table public.agenda_staff
  add column if not exists avatar_url text;

comment on column public.agenda_staff.avatar_url is 'URL pública do avatar (Supabase Storage bucket agenda-avatars)';

-- 2) Bucket (público para simplificar carregamento no frontend)
insert into storage.buckets (id, name, public)
values ('agenda-avatars', 'agenda-avatars', true)
on conflict (id) do update set public = true;

-- 3) Políticas no storage.objects
-- Observação: storage.objects normalmente já tem RLS habilitado; criamos policies específicas do bucket.

drop policy if exists "agenda_avatars_read_authenticated" on storage.objects;
create policy "agenda_avatars_read_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'agenda-avatars');

drop policy if exists "agenda_avatars_insert_authenticated" on storage.objects;
create policy "agenda_avatars_insert_authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'agenda-avatars');

drop policy if exists "agenda_avatars_update_authenticated" on storage.objects;
create policy "agenda_avatars_update_authenticated"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'agenda-avatars')
  with check (bucket_id = 'agenda-avatars');

drop policy if exists "agenda_avatars_delete_authenticated" on storage.objects;
create policy "agenda_avatars_delete_authenticated"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'agenda-avatars');

commit;

