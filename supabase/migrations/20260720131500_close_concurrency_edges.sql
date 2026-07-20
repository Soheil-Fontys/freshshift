begin;

-- Changing the dates of a previously verified illness requires a fresh eAU
-- check because the verified period no longer matches.
create or replace function private.prepare_absence_au()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> 'krank' then
    new.au_required := false;
    new.au_status := 'not_required';
    new.au_verified_at := null;
    new.au_verified_by := null;
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.type is distinct from old.type
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date then
    new.au_required := (new.end_date - new.start_date) >= 3;
    new.au_status := case when new.au_required then 'pending' else 'not_required' end;
    new.au_verified_at := null;
    new.au_verified_by := null;
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_absence_au() from public, anon, authenticated;
grant execute on function private.prepare_absence_au() to service_role;

-- Employee responses and deviation reports modify a shift outside an admin's
-- editor. Advance the parent version so an already-open admin tab cannot save
-- stale shift data over the employee's update.
create or replace function private.bump_schedule_version_for_employee_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    update public.schedules
    set version = version + 1,
        saved_at = now()
    where id = new.schedule_id;
  end if;
  return new;
end;
$$;

revoke all on function private.bump_schedule_version_for_employee_update()
  from public, anon, authenticated;
grant execute on function private.bump_schedule_version_for_employee_update()
  to service_role;

drop trigger if exists schedule_shifts_bump_version_for_employee on public.schedule_shifts;
create trigger schedule_shifts_bump_version_for_employee
  after update on public.schedule_shifts
  for each row execute function private.bump_schedule_version_for_employee_update();

commit;
