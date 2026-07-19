begin;

-- Employee actions and their admin notification are committed together. This
-- avoids a saved absence/response being shown as failed when a second browser
-- request for the notification loses connectivity.
create or replace function private.notify_admin_of_employee_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_name text;
  notification_type text;
  type_label text;
begin
  if (select auth.uid()) is null or public.is_admin() or new.requested_by <> 'employee' then
    return new;
  end if;

  select e.name into employee_name
  from public.employees e
  where e.id = new.employee_id;

  notification_type := case when new.type = 'krank' then 'absence_notice' else 'absence_request' end;
  type_label := case
    when new.type = 'urlaub' then 'Urlaub'
    when new.type = 'krank' then 'Krankheit'
    else 'Sonstiges'
  end;

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
    notification_type,
    jsonb_build_object(
      'employeeId', new.employee_id::text,
      'employeeName', coalesce(employee_name, 'Unbekannt'),
      'absenceId', new.id::text,
      'message', type_label || ': ' || new.start_date::text
        || case when new.end_date <> new.start_date then ' bis ' || new.end_date::text else '' end,
      'reason', new.note
    )
  );

  return new;
end;
$$;

revoke all on function private.notify_admin_of_employee_absence()
  from public, anon, authenticated;
grant execute on function private.notify_admin_of_employee_absence()
  to service_role;

drop trigger if exists absences_notify_admin on public.absences;
create trigger absences_notify_admin
  after insert on public.absences
  for each row execute function private.notify_admin_of_employee_absence();

create or replace function private.notify_admin_of_shift_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_name text;
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  select e.name into employee_name
  from public.employees e
  where e.id = new.employee_id;

  if old.request_status = 'pending'
     and new.request_status in ('accepted', 'declined')
     and new.request_status is distinct from old.request_status then
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
      'shift_request_response',
      jsonb_build_object(
        'employeeId', new.employee_id::text,
        'employeeName', coalesce(employee_name, 'Unbekannt'),
        'message', case
          when new.request_status = 'accepted' then 'Schichtanfrage angenommen'
          else 'Schichtanfrage abgelehnt'
        end,
        'reason', new.response_reason,
        'weekKey', new.week_key,
        'dayKey', new.day_key
      )
    );
  end if;

  if new.deviation_json ->> 'lateMinutes'
       is distinct from old.deviation_json ->> 'lateMinutes'
     and new.deviation_json ? 'lateMinutes' then
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
      'late',
      jsonb_build_object(
        'employeeId', new.employee_id::text,
        'employeeName', coalesce(employee_name, 'Unbekannt'),
        'message', 'Kommt ' || (new.deviation_json ->> 'lateMinutes') || ' Minuten später',
        'reason', new.deviation_json ->> 'reason',
        'weekKey', new.week_key,
        'dayKey', new.day_key
      )
    );
  end if;

  if new.deviation_json ->> 'earlyMinutes'
       is distinct from old.deviation_json ->> 'earlyMinutes'
     and new.deviation_json ? 'earlyMinutes' then
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
      'early',
      jsonb_build_object(
        'employeeId', new.employee_id::text,
        'employeeName', coalesce(employee_name, 'Unbekannt'),
        'message', 'Geht ' || (new.deviation_json ->> 'earlyMinutes') || ' Minuten früher',
        'reason', new.deviation_json ->> 'reason',
        'weekKey', new.week_key,
        'dayKey', new.day_key
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function private.notify_admin_of_shift_update()
  from public, anon, authenticated;
grant execute on function private.notify_admin_of_shift_update()
  to service_role;

drop trigger if exists schedule_shifts_notify_admin on public.schedule_shifts;
create trigger schedule_shifts_notify_admin
  after update on public.schedule_shifts
  for each row execute function private.notify_admin_of_shift_update();

drop policy if exists notifications_insert on public.notifications;
drop policy if exists notifications_admin_insert on public.notifications;
create policy notifications_admin_insert on public.notifications
  for insert to authenticated
  with check (public.is_admin());

commit;
