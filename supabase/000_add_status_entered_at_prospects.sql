-- Adds a timestamp to track when a lead entered the current Kanban phase/column.
-- This enables correct "tempo na coluna" even after page reload.

-- 1) Column
alter table public.prospects
  add column if not exists status_entered_at timestamptz;

-- 2) Backfill existing rows (optional but recommended)
update public.prospects
set status_entered_at = created_at
where status_entered_at is null
  and created_at is not null;

-- 3) Trigger:
-- - On INSERT: initialize status_entered_at to now() (or keep provided value)
-- - On UPDATE of `status`: refresh status_entered_at to now() only if status actually changed
create or replace function public.set_status_entered_at()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    new.status_entered_at := coalesce(new.status_entered_at, now());
    return new;
  end if;

  if new.status is distinct from old.status then
    new.status_entered_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_status_entered_at on public.prospects;

create trigger trg_set_status_entered_at
before insert or update of status
on public.prospects
for each row
execute procedure public.set_status_entered_at();

