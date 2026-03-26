-- Agenda (Hub) - estrutura de tabelas + integração com Prospecção (crm_tasks)
-- Rode no SQL Editor do Supabase (antes do frontend).
--
-- Requisitos/assunções:
-- - Tabela existente: public.crm_tasks (usada pelo TaskManager).
-- - Colunas existentes em crm_tasks: id, title, due_date, status, prospect_id (nullable), sale_id (nullable), created_at.
-- - RLS atual: o app já consegue inserir/ler crm_tasks como "authenticated".
--   Aqui habilitamos RLS também para as novas tabelas, mas com políticas "liberadas" para authenticated.
--   (Depois podemos endurecer por regras/ownership.)

begin;

-- UUID generation
create extension if not exists pgcrypto;

-- =========================
-- 1) Funcionários da Agenda
-- =========================
create table if not exists public.agenda_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Seed inicial (se não existir)
insert into public.agenda_staff (name) values
  ('Rafael'),
  ('Larissa'),
  ('Andréia'),
  ('Helena'),
  ('Grace'),
  ('Geisa')
on conflict (name) do nothing;

-- =========================
-- 2) Tarefas da Agenda
-- =========================
create table if not exists public.agenda_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.agenda_staff(id) on delete cascade,

  -- vínculo opcional com crm_tasks (integração automática)
  source_crm_task_id text unique,

  title text not null,
  due_date timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),

  -- para saber de onde veio (opcional)
  prospect_id text,
  sale_id bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_tasks_staff_due_idx
  on public.agenda_tasks (staff_id, due_date);

-- =========================
-- 3) Checklist dos Cartões
-- =========================
create table if not exists public.agenda_task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agenda_tasks(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists agenda_task_items_task_sort_idx
  on public.agenda_task_items (task_id, sort_order);

-- =========================
-- 4) Integração: atribuir funcionário nas tarefas da Prospecção
-- =========================
-- Adiciona uma FK opcional em crm_tasks para vincular tarefa ao nome do funcionário.
-- A Agenda vai "espelhar" (via trigger) as tarefas do crm_tasks quando assigned_staff_id estiver preenchido.
alter table public.crm_tasks
  add column if not exists assigned_staff_id uuid references public.agenda_staff(id);

-- =========================
-- 5) Triggers: espelhar crm_tasks -> agenda_tasks
-- =========================
create or replace function public.sync_crm_task_to_agenda()
returns trigger
language plpgsql
as $$
begin
  -- Se a tarefa da Prospecção não tiver funcionário, remove o espelho na Agenda (se existir).
  if (new.assigned_staff_id is null) then
    delete from public.agenda_tasks
    where source_crm_task_id = new.id::text;
    return new;
  end if;

  insert into public.agenda_tasks (
    staff_id,
    source_crm_task_id,
    title,
    due_date,
    status,
    prospect_id,
    sale_id
  ) values (
    new.assigned_staff_id,
    new.id::text,
    new.title,
    new.due_date,
    new.status,
    new.prospect_id::text,
    new.sale_id
  )
  on conflict (source_crm_task_id) do update set
    staff_id = excluded.staff_id,
    title = excluded.title,
    due_date = excluded.due_date,
    status = excluded.status,
    prospect_id = excluded.prospect_id,
    sale_id = excluded.sale_id,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.delete_agenda_task_from_crm()
returns trigger
language plpgsql
as $$
begin
  delete from public.agenda_tasks
  where source_crm_task_id = old.id::text;
  return old;
end;
$$;

drop trigger if exists trg_crm_tasks_agenda_sync on public.crm_tasks;
create trigger trg_crm_tasks_agenda_sync
after insert or update
on public.crm_tasks
for each row
execute procedure public.sync_crm_task_to_agenda();

drop trigger if exists trg_crm_tasks_agenda_sync_delete on public.crm_tasks;
create trigger trg_crm_tasks_agenda_sync_delete
after delete
on public.crm_tasks
for each row
execute procedure public.delete_agenda_task_from_crm();

-- =========================
-- 6) RLS (Row Level Security)
-- =========================
-- Objetivo: todos os usuários logados do hub veem/alteram a agenda.
-- Depois refinamos por regras (ex.: somente determinados cargos).

alter table public.agenda_staff enable row level security;
alter table public.agenda_tasks enable row level security;
alter table public.agenda_task_items enable row level security;

drop policy if exists "authenticated_agenda_staff_all" on public.agenda_staff;
create policy "authenticated_agenda_staff_all"
  on public.agenda_staff
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_agenda_tasks_all" on public.agenda_tasks;
create policy "authenticated_agenda_tasks_all"
  on public.agenda_tasks
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated_agenda_task_items_all" on public.agenda_task_items;
create policy "authenticated_agenda_task_items_all"
  on public.agenda_task_items
  for all
  to authenticated
  using (true)
  with check (true);

commit;

