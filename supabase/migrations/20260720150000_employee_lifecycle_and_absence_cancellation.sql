begin;

-- Keep employment history while making a termination visibly and
-- semantically different from a reversible archive.
alter table public.employees
  add column if not exists terminated_at timestamptz,
  add column if not exists terminated_by uuid references public.profiles(id) on delete set null;

alter table public.employees
  drop constraint if exists employees_archive_state_check;

alter table public.employees
  add constraint employees_archive_state_check
    check (
      (active and archived_at is null and terminated_at is null)
      or (not active and archived_at is not null)
    );

create index if not exists employees_terminated_by_idx
  on public.employees (terminated_by)
  where terminated_by is not null;

-- A terminated employee may not be restored through the reversible archive
-- workflow. Re-hiring requires a deliberate new employee/invitation flow.
create or replace function public.restore_employee(p_employee_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  restored_employee_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may restore employees';
  end if;

  update public.employees
  set active = true,
      archived_at = null
  where id = p_employee_id
    and not active
    and terminated_at is null
  returning id into restored_employee_id;

  if restored_employee_id is null then
    raise exception 'Archived employee not found or employee was terminated';
  end if;

  return restored_employee_id;
end;
$$;

revoke all on function public.restore_employee(uuid) from public, anon;
grant execute on function public.restore_employee(uuid) to authenticated, service_role;

-- Cancellations remain in the history rather than deleting medical/leave
-- records. Only the employee who owns a pending or approved record may cancel.
alter table public.absences
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

alter table public.absences
  drop constraint if exists absences_status_check;

alter table public.absences
  add constraint absences_status_check
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  add constraint absences_cancellation_state_check
    check (
      (status = 'cancelled' and cancelled_at is not null)
      or (status <> 'cancelled' and cancelled_at is null and cancelled_by is null)
    );

create index if not exists absences_cancelled_by_idx
  on public.absences (cancelled_by)
  where cancelled_by is not null;

alter table public.activity_log
  drop constraint if exists activity_log_action_check;

alter table public.activity_log
  add constraint activity_log_action_check
    check (action in (
      'schedule_saved',
      'schedule_released',
      'shift_response',
      'absence_approved',
      'absence_schedule_cleanup',
      'absence_cancelled',
      'au_status_changed',
      'employee_terminated'
    ));

create or replace function public.cancel_own_absence(p_absence_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_employee uuid := public.current_employee_id();
  saved_absence public.absences%rowtype;
  employee_name text;
begin
  if (select auth.uid()) is null or current_employee is null or public.is_admin() then
    raise exception 'Only linked employees may cancel their own absence';
  end if;

  update public.absences
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = (select auth.uid()),
      responded_at = now(),
      response_reason = 'Vom Mitarbeiter storniert'
  where id = p_absence_id
    and employee_id = current_employee
    and status in ('pending', 'approved')
    and end_date >= current_date
  returning * into saved_absence;

  if saved_absence.id is null then
    raise exception 'Current or future absence not found or cannot be cancelled';
  end if;

  select e.name into employee_name
  from public.employees e
  where e.id = current_employee;

  insert into public.notifications (
    store_id,
    target_role,
    target_employee_id,
    type,
    payload
  ) values (
    saved_absence.store_id,
    'admin',
    null,
    'absence_cancelled',
    jsonb_build_object(
      'employeeId', current_employee::text,
      'employeeName', coalesce(employee_name, 'Unbekannt'),
      'absenceId', saved_absence.id::text,
      'message', 'Abwesenheit storniert: ' || saved_absence.start_date::text
        || case when saved_absence.end_date <> saved_absence.start_date
          then ' bis ' || saved_absence.end_date::text else '' end,
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
    saved_absence.store_id,
    'absence_cancelled',
    jsonb_build_object(
      'absenceId', saved_absence.id,
      'employeeId', current_employee
    )
  );

  return saved_absence.id;
end;
$$;

revoke all on function public.cancel_own_absence(uuid) from public, anon;
grant execute on function public.cancel_own_absence(uuid) to authenticated, service_role;

commit;
