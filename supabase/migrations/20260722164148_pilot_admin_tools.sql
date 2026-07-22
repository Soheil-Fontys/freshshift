begin;

-- Record the two new admin actions in the shared multi-admin history.
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
      'employee_terminated',
      'availability_reset',
      'employee_email_updated'
    ));

-- Delete exactly one submitted availability for the selected store/week.
-- RLS and this explicit role check both require an authenticated admin.
create or replace function public.reset_employee_availability(
  p_employee_id uuid,
  p_store_id text,
  p_week_key text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted_id uuid;
  employee_name text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may reset availability';
  end if;

  if p_store_id is null
     or btrim(p_store_id) = ''
     or p_week_key is null
     or p_week_key !~ '^[0-9]{4}-W[0-9]{2}$' then
    raise exception 'A valid store and week are required';
  end if;

  delete from public.availabilities
  where employee_id = p_employee_id
    and store_id = btrim(p_store_id)
    and week_key = p_week_key
  returning id into deleted_id;

  if deleted_id is null then
    raise exception 'Availability was already removed or does not exist';
  end if;

  select e.name into employee_name
  from public.employees e
  where e.id = p_employee_id;

  perform private.record_activity(
    'availability_reset',
    btrim(p_store_id),
    p_week_key,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'employeeName', coalesce(employee_name, 'Unbekannt'),
      'availabilityId', deleted_id
    )
  );

  return deleted_id;
end;
$$;

revoke all on function public.reset_employee_availability(uuid, text, text)
  from public, anon;
grant execute on function public.reset_employee_availability(uuid, text, text)
  to authenticated, service_role;

-- The email Edge Function changes Auth first, then calls this service-role-only
-- function so the employee and profile rows change together with the audit log.
create or replace function public.sync_employee_email_from_auth(
  p_employee_id uuid,
  p_profile_id uuid,
  p_email text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  employee_name text;
  previous_email text;
  actor_name text;
begin
  if p_actor_profile_id is null or not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.role = 'admin'
  ) then
    raise exception 'A valid administrator is required';
  end if;

  if normalized_email = ''
     or char_length(normalized_email) > 254
     or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Invalid email';
  end if;

  select e.name, e.email
  into employee_name, previous_email
  from public.employees e
  where e.id = p_employee_id
    and e.profile_id = p_profile_id
    and e.active
  for update;

  if employee_name is null then
    raise exception 'Active linked employee not found';
  end if;

  update public.employees
  set email = normalized_email
  where id = p_employee_id;

  update public.profiles
  set email = normalized_email
  where id = p_profile_id;

  select coalesce(nullif(p.display_name, ''), nullif(p.email, ''), 'Administrator')
  into actor_name
  from public.profiles p
  where p.id = p_actor_profile_id;

  insert into public.activity_log (
    actor_profile_id,
    actor_name,
    action,
    details
  ) values (
    p_actor_profile_id,
    actor_name,
    'employee_email_updated',
    jsonb_build_object(
      'employeeId', p_employee_id,
      'employeeName', employee_name,
      'previousEmail', previous_email,
      'newEmail', normalized_email
    )
  );

  return p_employee_id;
end;
$$;

revoke all on function public.sync_employee_email_from_auth(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.sync_employee_email_from_auth(uuid, uuid, text, uuid)
  to service_role;

commit;
