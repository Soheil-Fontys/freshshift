begin;

-- Permit only the owner of a current/future pending or approved absence to
-- perform the cancellation transition. A trigger below validates every field.
drop policy if exists absences_employee_cancel_own on public.absences;
create policy absences_employee_cancel_own on public.absences
  for update to authenticated
  using (
    employee_id = public.current_employee_id()
    and status in ('pending', 'approved')
    and end_date >= current_date
  )
  with check (
    employee_id = public.current_employee_id()
    and status = 'cancelled'
    and cancelled_by = (select auth.uid())
    and cancelled_at is not null
  );

create or replace function private.guard_employee_absence_cancellation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  if old.employee_id <> public.current_employee_id()
     or old.status not in ('pending', 'approved')
     or old.end_date < current_date
     or new.status <> 'cancelled'
     or (to_jsonb(new) - array[
       'status', 'cancelled_at', 'cancelled_by',
       'responded_at', 'response_reason', 'updated_at'
     ]) is distinct from (to_jsonb(old) - array[
       'status', 'cancelled_at', 'cancelled_by',
       'responded_at', 'response_reason', 'updated_at'
     ]) then
    raise exception 'Employees may only cancel their own current or future absence';
  end if;

  new.cancelled_at := now();
  new.cancelled_by := (select auth.uid());
  new.responded_at := now();
  new.response_reason := 'Vom Mitarbeiter storniert';
  return new;
end;
$$;

revoke all on function private.guard_employee_absence_cancellation()
  from public, anon, authenticated;
grant execute on function private.guard_employee_absence_cancellation()
  to service_role;

drop trigger if exists absences_guard_employee_cancellation on public.absences;
create trigger absences_guard_employee_cancellation
  before update on public.absences
  for each row execute function private.guard_employee_absence_cancellation();

create or replace function private.notify_admin_of_absence_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_name text;
begin
  if old.status not in ('pending', 'approved')
     or new.status <> 'cancelled'
     or (select auth.uid()) is null
     or public.is_admin() then
    return new;
  end if;

  select e.name into employee_name
  from public.employees e
  where e.id = new.employee_id;

  insert into public.notifications (
    store_id,
    target_role,
    target_employee_id,
    type,
    payload
  ) values (
    new.store_id,
    'admin',
    null,
    'absence_cancelled',
    jsonb_build_object(
      'employeeId', new.employee_id::text,
      'employeeName', coalesce(employee_name, 'Unbekannt'),
      'absenceId', new.id::text,
      'message', 'Abwesenheit storniert: ' || new.start_date::text
        || case when new.end_date <> new.start_date
          then ' bis ' || new.end_date::text else '' end,
      'reason', 'Bitte den Dienstplan prüfen; entfernte Schichten werden nicht automatisch wiederhergestellt.'
    )
  );

  insert into public.activity_log (
    actor_profile_id,
    actor_name,
    store_id,
    action,
    details
  ) values (
    (select auth.uid()),
    coalesce(employee_name, 'Mitarbeiter'),
    new.store_id,
    'absence_cancelled',
    jsonb_build_object('absenceId', new.id, 'employeeId', new.employee_id)
  );

  return new;
end;
$$;

revoke all on function private.notify_admin_of_absence_cancellation()
  from public, anon, authenticated;
grant execute on function private.notify_admin_of_absence_cancellation()
  to service_role;

drop trigger if exists absences_notify_admin_of_cancellation on public.absences;
create trigger absences_notify_admin_of_cancellation
  after update of status on public.absences
  for each row execute function private.notify_admin_of_absence_cancellation();

create or replace function public.cancel_own_absence(p_absence_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_absence_id uuid;
begin
  if (select auth.uid()) is null
     or public.current_employee_id() is null
     or public.is_admin() then
    raise exception 'Only linked employees may cancel their own absence';
  end if;

  update public.absences
  set status = 'cancelled'
  where id = p_absence_id
    and employee_id = public.current_employee_id()
    and status in ('pending', 'approved')
    and end_date >= current_date
  returning id into saved_absence_id;

  if saved_absence_id is null then
    raise exception 'Current or future absence not found or cannot be cancelled';
  end if;

  return saved_absence_id;
end;
$$;

revoke all on function public.cancel_own_absence(uuid) from public, anon;
grant execute on function public.cancel_own_absence(uuid) to authenticated, service_role;

commit;
