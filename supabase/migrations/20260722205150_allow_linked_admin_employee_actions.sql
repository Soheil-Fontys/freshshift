begin;

-- An administrator may also have a linked employee record. The UI can switch
-- views without changing the authenticated account, so this narrowly scoped
-- RPC must permit that person to cancel only their own current/future absence.
create or replace function public.cancel_own_absence(p_absence_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_absence_id uuid;
  current_employee uuid := public.current_employee_id();
  actor_is_admin boolean := public.is_admin();
  employee_name text;
  saved_store_id text;
begin
  if (select auth.uid()) is null or current_employee is null then
    raise exception 'Only linked employees may cancel their own absence';
  end if;

  update public.absences
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = (select auth.uid()),
    responded_at = now(),
    response_reason = 'Vom Mitarbeiter storniert'
  where id = p_absence_id
    and employee_id = current_employee
    and status in ('pending', 'approved')
    and end_date >= current_date
  returning id, store_id into saved_absence_id, saved_store_id;

  if saved_absence_id is null then
    raise exception 'Current or future absence not found or cannot be cancelled';
  end if;

  -- Employee-role cancellations are logged by the existing trigger. That
  -- trigger intentionally ignores admins, so record the dual-role case here.
  if actor_is_admin then
    select e.name into employee_name
    from public.employees e
    where e.id = current_employee;

    insert into public.notifications (
      store_id, target_role, target_employee_id, type, payload
    ) values (
      saved_store_id,
      'admin',
      null,
      'absence_cancelled',
      jsonb_build_object(
        'employeeId', current_employee::text,
        'employeeName', coalesce(employee_name, 'Unbekannt'),
        'absenceId', saved_absence_id::text,
        'message', 'Abwesenheit storniert',
        'reason', 'Bitte den Dienstplan prüfen; entfernte Schichten werden nicht automatisch wiederhergestellt.'
      )
    );

    insert into public.activity_log (
      actor_profile_id, actor_name, store_id, action, details
    ) values (
      (select auth.uid()),
      coalesce(employee_name, 'Mitarbeiter'),
      saved_store_id,
      'absence_cancelled',
      jsonb_build_object('absenceId', saved_absence_id, 'employeeId', current_employee)
    );
  end if;

  return saved_absence_id;
end;
$$;

revoke all on function public.cancel_own_absence(uuid) from public, anon;
grant execute on function public.cancel_own_absence(uuid) to authenticated, service_role;

commit;
