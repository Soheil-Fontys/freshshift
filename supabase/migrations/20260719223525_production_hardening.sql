begin;

-- Preserve employee history. Staff are archived instead of being deleted,
-- because the related schedules, availability and absence records are business
-- records that must survive roster changes.
alter table public.employees
  add column active boolean not null default true,
  add column archived_at timestamptz;

alter table public.employees
  add constraint employees_archive_state_check
    check ((active and archived_at is null) or (not active and archived_at is not null)),
  add constraint employees_name_length_check
    check (char_length(btrim(name)) between 1 and 120),
  add constraint employees_email_length_check
    check (email is null or char_length(email) <= 254),
  add constraint employees_default_availability_object_check
    check (
      jsonb_typeof(default_availability_json) = 'object'
      and octet_length(default_availability_json::text) <= 32768
    );

alter table public.availabilities
  add constraint availabilities_days_object_check
    check (jsonb_typeof(days_json) = 'object' and octet_length(days_json::text) <= 32768),
  add constraint availabilities_notes_length_check
    check (notes is null or char_length(notes) <= 2000);

alter table public.absences
  add constraint absences_note_length_check
    check (note is null or char_length(note) <= 2000),
  add constraint absences_response_reason_length_check
    check (response_reason is null or char_length(response_reason) <= 2000);

alter table public.notifications
  add constraint notifications_payload_size_check
    check (octet_length(payload::text) <= 16384);

alter table public.schedule_shifts
  add constraint schedule_shifts_valid_times_check
    check (
      start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and "end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and (actual_start is null or actual_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      and (actual_end is null or actual_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      and start <> "end"
    ),
  add constraint schedule_shifts_deviation_size_check
    check (deviation_json is null or octet_length(deviation_json::text) <= 8192),
  add constraint schedule_shifts_response_reason_length_check
    check (response_reason is null or char_length(response_reason) <= 2000),
  add constraint schedule_shifts_request_state_check
    check (
      (request_status = 'none' and requested_at is null and responded_at is null)
      or (request_status = 'pending' and requested_at is not null and responded_at is null)
      or (request_status in ('accepted', 'declined') and requested_at is not null and responded_at is not null)
    );

alter table public.schedules
  add constraint schedules_release_state_check
    check (
      (released and released_at is not null)
      or (not released and released_at is null)
    );

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.profile_id = (select auth.uid())
    and e.active
  limit 1
$$;

revoke all on function public.current_employee_id() from public, anon;
grant execute on function public.current_employee_id() to authenticated, service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_role text := 'employee';
begin
  if new.email is not null and exists (
    select 1
    from private.admin_invites ai
    where ai.email = lower(trim(new.email))
      and ai.claimed_at is null
  ) then
    initial_role := 'admin';
  end if;

  insert into public.profiles (id, role, display_name, email)
  values (
    new.id,
    initial_role,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;

  update public.employees
  set profile_id = new.id
  where profile_id is null
    and active
    and email is not null
    and new.email is not null
    and lower(email) = lower(new.email);

  if initial_role = 'admin' then
    update private.admin_invites
    set claimed_at = now()
    where email = lower(trim(new.email))
      and claimed_at is null;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.handle_new_user() to supabase_auth_admin, service_role;

-- Save the employee row and all store assignments in one transaction.
create or replace function public.save_employee(
  p_employee_id uuid,
  p_name text,
  p_type text,
  p_hourly_rate numeric,
  p_default_availability jsonb,
  p_store_ids text[],
  p_primary_store text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_employee_id uuid;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_stores text[];
begin
  if not public.is_admin() then
    raise exception 'Only administrators may save employees';
  end if;

  select array_agg(distinct btrim(store_id) order by btrim(store_id))
  into normalized_stores
  from unnest(coalesce(p_store_ids, '{}'::text[])) as store_id
  where store_id is not null and btrim(store_id) <> '';

  if normalized_name = '' or char_length(normalized_name) > 120 then
    raise exception 'Employee name must contain 1 to 120 characters';
  end if;

  if coalesce(cardinality(normalized_stores), 0) = 0
     or not (p_primary_store = any(normalized_stores)) then
    raise exception 'At least one store and a valid primary store are required';
  end if;

  if exists (
    select 1
    from unnest(normalized_stores) requested_store
    where not exists (
      select 1 from public.stores s where s.id = requested_store
    )
  ) then
    raise exception 'Unknown store assignment';
  end if;

  if p_employee_id is null then
    insert into public.employees (
      name,
      type,
      hourly_rate,
      default_availability_json
    )
    values (
      normalized_name,
      p_type,
      p_hourly_rate,
      coalesce(p_default_availability, '{}'::jsonb)
    )
    returning id into saved_employee_id;
  else
    update public.employees
    set name = normalized_name,
        type = p_type,
        hourly_rate = p_hourly_rate,
        default_availability_json = coalesce(p_default_availability, '{}'::jsonb)
    where id = p_employee_id
      and active
    returning id into saved_employee_id;

    if saved_employee_id is null then
      raise exception 'Active employee not found';
    end if;
  end if;

  delete from public.employee_stores
  where employee_id = saved_employee_id;

  insert into public.employee_stores (employee_id, store_id, is_primary)
  select saved_employee_id, store_id, store_id = p_primary_store
  from unnest(normalized_stores) store_id;

  return saved_employee_id;
end;
$$;

revoke all on function public.save_employee(uuid, text, text, numeric, jsonb, text[], text)
  from public, anon;
grant execute on function public.save_employee(uuid, text, text, numeric, jsonb, text[], text)
  to authenticated, service_role;

create or replace function public.archive_employee(p_employee_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  archived_employee_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may archive employees';
  end if;

  update public.employees
  set active = false,
      archived_at = now()
  where id = p_employee_id
    and active
  returning id into archived_employee_id;

  if archived_employee_id is null then
    raise exception 'Active employee not found';
  end if;

  return archived_employee_id;
end;
$$;

revoke all on function public.archive_employee(uuid) from public, anon;
grant execute on function public.archive_employee(uuid) to authenticated, service_role;

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
  returning id into restored_employee_id;

  if restored_employee_id is null then
    raise exception 'Archived employee not found';
  end if;

  return restored_employee_id;
end;
$$;

revoke all on function public.restore_employee(uuid) from public, anon;
grant execute on function public.restore_employee(uuid) to authenticated, service_role;

-- Every plan edit returns the schedule to draft. Releasing is a separate,
-- validated action so employees never see half-finished edits.
create or replace function public.save_schedule(
  p_store_id text,
  p_week_key text,
  p_released boolean,
  p_released_at timestamptz,
  p_saved_at timestamptz,
  p_shifts jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_schedule_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may save schedules';
  end if;

  if jsonb_typeof(coalesce(p_shifts, '[]'::jsonb)) <> 'array' then
    raise exception 'p_shifts must be a JSON array';
  end if;

  if jsonb_array_length(coalesce(p_shifts, '[]'::jsonb)) > 500 then
    raise exception 'A schedule cannot contain more than 500 shifts';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_shifts, '[]'::jsonb)) shift
    where not exists (
      select 1
      from public.employee_stores es
      join public.employees e on e.id = es.employee_id and e.active
      where es.employee_id = (shift ->> 'employee_id')::uuid
        and es.store_id = p_store_id
    )
  ) then
    raise exception 'Every shift employee must be active in the selected store';
  end if;

  insert into public.schedules (
    store_id,
    week_key,
    released,
    released_at,
    saved_at
  )
  values (
    p_store_id,
    p_week_key,
    false,
    null,
    coalesce(p_saved_at, now())
  )
  on conflict (store_id, week_key) do update
  set released = false,
      released_at = null,
      saved_at = excluded.saved_at
  returning id into saved_schedule_id;

  delete from public.schedule_shifts
  where schedule_id = saved_schedule_id;

  insert into public.schedule_shifts (
    schedule_id,
    store_id,
    week_key,
    day_key,
    employee_id,
    start,
    "end",
    actual_start,
    actual_end,
    deviation_json,
    request_status,
    requested_at,
    responded_at,
    response_reason
  )
  select
    saved_schedule_id,
    p_store_id,
    p_week_key,
    shift.day_key,
    shift.employee_id,
    shift.start_time,
    shift.end_time,
    shift.actual_start,
    shift.actual_end,
    shift.deviation_json,
    coalesce(shift.request_status, 'none'),
    shift.requested_at,
    shift.responded_at,
    shift.response_reason
  from jsonb_to_recordset(coalesce(p_shifts, '[]'::jsonb)) as shift (
    day_key text,
    employee_id uuid,
    start_time text,
    end_time text,
    actual_start text,
    actual_end text,
    deviation_json jsonb,
    request_status text,
    requested_at timestamptz,
    responded_at timestamptz,
    response_reason text
  );

  return saved_schedule_id;
end;
$$;

revoke all on function public.save_schedule(text, text, boolean, timestamptz, timestamptz, jsonb)
  from public, anon;
grant execute on function public.save_schedule(text, text, boolean, timestamptz, timestamptz, jsonb)
  to authenticated, service_role;

create or replace function public.release_schedule(p_store_id text, p_week_key text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  schedule_id_to_release uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may release schedules';
  end if;

  select s.id
  into schedule_id_to_release
  from public.schedules s
  where s.store_id = p_store_id
    and s.week_key = p_week_key;

  if schedule_id_to_release is null then
    raise exception 'Schedule not found';
  end if;

  if not exists (
    select 1 from public.schedule_shifts ss
    where ss.schedule_id = schedule_id_to_release
  ) then
    raise exception 'An empty schedule cannot be released';
  end if;

  if exists (
    select 1 from public.schedule_shifts ss
    where ss.schedule_id = schedule_id_to_release
      and ss.request_status in ('pending', 'declined')
  ) then
    raise exception 'Resolve pending or declined shift requests before release';
  end if;

  update public.schedules
  set released = true,
      released_at = now(),
      saved_at = coalesce(saved_at, now())
  where id = schedule_id_to_release;

  return schedule_id_to_release;
end;
$$;

revoke all on function public.release_schedule(text, text) from public, anon;
grant execute on function public.release_schedule(text, text) to authenticated, service_role;

commit;
