begin;

-- Remote migration version: 20260719213121.
alter table public.employees
  add column default_availability_json jsonb not null default '{}'::jsonb;

create unique index employees_name_unique
  on public.employees (lower(name));

alter table public.notifications
  alter column target_role set not null,
  alter column payload set default '{}'::jsonb,
  alter column payload set not null;

alter table public.notifications
  add constraint notifications_target_check
  check (
    (target_role = 'admin' and target_employee_id is null)
    or (target_role = 'employee' and target_employee_id is not null)
  );

create or replace function private.guard_shift_employee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  schedule_is_released boolean;
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  if old.employee_id <> public.current_employee_id()
     or new.schedule_id is distinct from old.schedule_id
     or new.store_id is distinct from old.store_id
     or new.week_key is distinct from old.week_key
     or new.day_key is distinct from old.day_key
     or new.employee_id is distinct from old.employee_id
     or new.start is distinct from old.start
     or new."end" is distinct from old."end"
     or new.requested_at is distinct from old.requested_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Employees cannot change assigned shift details';
  end if;

  if old.request_status = 'pending'
     and new.request_status in ('accepted', 'declined')
     and new.actual_start is not distinct from old.actual_start
     and new.actual_end is not distinct from old.actual_end
     and new.deviation_json is not distinct from old.deviation_json then
    new.responded_at = coalesce(new.responded_at, now());
    return new;
  end if;

  select s.released
  into schedule_is_released
  from public.schedules s
  where s.id = old.schedule_id;

  if schedule_is_released
     and new.request_status is not distinct from old.request_status
     and new.responded_at is not distinct from old.responded_at
     and new.response_reason is not distinct from old.response_reason then
    return new;
  end if;

  raise exception 'Employees may only answer requests or report deviations on released shifts';
end;
$$;

revoke all on function private.guard_shift_employee_update()
  from public, anon, authenticated;
grant execute on function private.guard_shift_employee_update()
  to service_role;

drop policy if exists shifts_update on public.schedule_shifts;
create policy shifts_update on public.schedule_shifts
  for update to authenticated
  using (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
      and (
        request_status = 'pending'
        or exists (
          select 1
          from public.schedules s
          where s.id = schedule_shifts.schedule_id
            and s.released
        )
      )
    )
  )
  with check (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
    )
  );

drop policy if exists absences_insert on public.absences;
create policy absences_insert on public.absences
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and requested_by = 'employee'
      and (
        status = 'pending'
        or (type = 'krank' and status = 'approved')
      )
      and (store_id is null or public.employee_in_store(store_id))
    )
  );

drop policy if exists notifications_admin_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      target_role = 'admin'
      and target_employee_id is null
      and type in (
        'late',
        'early',
        'absence_notice',
        'absence_request',
        'shift_request_response'
      )
      and payload ->> 'employeeId' = public.current_employee_id()::text
      and (store_id is null or public.employee_in_store(store_id))
    )
  );

commit;
