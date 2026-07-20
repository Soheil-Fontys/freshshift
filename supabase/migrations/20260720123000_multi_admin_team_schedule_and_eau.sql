begin;

-- Multi-admin concurrency and shared awareness.
alter table public.schedules
  add column if not exists version bigint not null default 1;

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, profile_id)
);

create index if not exists notification_reads_profile_idx
  on public.notification_reads (profile_id, read_at desc);

alter table public.notification_reads enable row level security;

drop policy if exists notification_reads_select_own on public.notification_reads;
create policy notification_reads_select_own on public.notification_reads
  for select to authenticated
  using ((select auth.uid()) = profile_id);

drop policy if exists notification_reads_insert_own on public.notification_reads;
create policy notification_reads_insert_own on public.notification_reads
  for insert to authenticated
  with check ((select auth.uid()) = profile_id and public.is_admin());

drop policy if exists notification_reads_update_own on public.notification_reads;
create policy notification_reads_update_own on public.notification_reads
  for update to authenticated
  using ((select auth.uid()) = profile_id and public.is_admin())
  with check ((select auth.uid()) = profile_id and public.is_admin());

revoke all on table public.notification_reads from public, anon;
grant select, insert, update on table public.notification_reads to authenticated, service_role;

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  store_id text references public.stores(id) on delete set null,
  week_key text check (week_key is null or week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  action text not null check (action in (
    'schedule_saved',
    'schedule_released',
    'shift_response',
    'absence_approved',
    'absence_schedule_cleanup',
    'au_status_changed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(details) = 'object')
);

create index if not exists activity_log_created_idx
  on public.activity_log (created_at desc);
create index if not exists activity_log_store_week_idx
  on public.activity_log (store_id, week_key, created_at desc);

alter table public.activity_log enable row level security;

drop policy if exists activity_log_admin_select on public.activity_log;
create policy activity_log_admin_select on public.activity_log
  for select to authenticated
  using (public.is_admin());

revoke all on table public.activity_log from public, anon;
grant select on table public.activity_log to authenticated, service_role;
grant usage, select on sequence public.activity_log_id_seq to service_role;

create or replace function private.record_activity(
  p_action text,
  p_store_id text default null,
  p_week_key text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_label text;
begin
  if actor_id is null then
    return;
  end if;

  select coalesce(nullif(p.display_name, ''), nullif(p.email, ''), 'Benutzer')
  into actor_label
  from public.profiles p
  where p.id = actor_id;

  insert into public.activity_log (
    actor_profile_id,
    actor_name,
    store_id,
    week_key,
    action,
    details
  ) values (
    actor_id,
    coalesce(actor_label, 'Benutzer'),
    p_store_id,
    p_week_key,
    p_action,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function private.record_activity(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.record_activity(text, text, text, jsonb)
  to service_role;

-- Employees receive a deliberately sanitized view of released team shifts.
-- Medical notes, response reasons, actual timestamps and pay are not returned.
create or replace function public.get_released_team_shifts()
returns table (
  id uuid,
  schedule_id uuid,
  store_id text,
  week_key text,
  day_key text,
  employee_id uuid,
  employee_name text,
  start text,
  "end" text,
  deviation_json jsonb,
  request_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ss.id,
    ss.schedule_id,
    ss.store_id,
    ss.week_key,
    ss.day_key,
    ss.employee_id,
    e.name as employee_name,
    ss.start,
    ss."end",
    nullif(
      jsonb_strip_nulls(jsonb_build_object(
        'lateMinutes', ss.deviation_json -> 'lateMinutes',
        'earlyMinutes', ss.deviation_json -> 'earlyMinutes'
      )),
      '{}'::jsonb
    ) as deviation_json,
    ss.request_status
  from public.schedule_shifts ss
  join public.schedules s on s.id = ss.schedule_id and s.released
  join public.employees e on e.id = ss.employee_id and e.active
  where public.current_employee_id() is not null
    and public.employee_in_store(ss.store_id)
    and ss.request_status in ('none', 'accepted')
  order by ss.week_key, ss.day_key, ss.start, e.name;
$$;

revoke all on function public.get_released_team_shifts() from public, anon;
grant execute on function public.get_released_team_shifts() to authenticated, service_role;

-- German eAU workflow: the app stores only whether evidence is required and
-- verified. It deliberately does not store diagnoses or medical documents.
alter table public.absences
  add column if not exists au_required boolean not null default false,
  add column if not exists au_status text not null default 'not_required',
  add column if not exists au_verified_at timestamptz,
  add column if not exists au_verified_by uuid references public.profiles(id) on delete set null;

alter table public.absences
  drop constraint if exists absences_au_status_check;
alter table public.absences
  add constraint absences_au_status_check
  check (au_status in ('not_required', 'pending', 'verified'));

alter table public.absences
  drop constraint if exists absences_au_consistency_check;
alter table public.absences
  add constraint absences_au_consistency_check
  check (
    (type = 'krank' or (not au_required and au_status = 'not_required'))
    and (au_required or au_status = 'not_required')
    and (au_status = 'verified' or (au_verified_at is null and au_verified_by is null))
  );

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

  if tg_op = 'INSERT' then
    new.au_required := (new.end_date - new.start_date) >= 3;
    new.au_status := case when new.au_required then 'pending' else 'not_required' end;
    new.au_verified_at := null;
    new.au_verified_by := null;
  elsif new.type is distinct from old.type
     or new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date then
    if old.au_status <> 'verified' then
      new.au_required := (new.end_date - new.start_date) >= 3;
      new.au_status := case when new.au_required then 'pending' else 'not_required' end;
      new.au_verified_at := null;
      new.au_verified_by := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_absence_au() from public, anon, authenticated;
grant execute on function private.prepare_absence_au() to service_role;

drop trigger if exists absences_prepare_au on public.absences;
create trigger absences_prepare_au
  before insert or update of type, start_date, end_date on public.absences
  for each row execute function private.prepare_absence_au();

-- Backfill existing sick periods using the statutory default threshold.
update public.absences
set au_required = (end_date - start_date) >= 3,
    au_status = case when (end_date - start_date) >= 3 then 'pending' else 'not_required' end,
    au_verified_at = null,
    au_verified_by = null
where type = 'krank';

create or replace function public.set_absence_au_status(
  p_absence_id uuid,
  p_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_absence public.absences%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may update eAU status';
  end if;
  if p_status not in ('not_required', 'pending', 'verified') then
    raise exception 'Invalid eAU status';
  end if;

  update public.absences
  set au_required = p_status <> 'not_required',
      au_status = p_status,
      au_verified_at = case when p_status = 'verified' then now() else null end,
      au_verified_by = case when p_status = 'verified' then (select auth.uid()) else null end
  where id = p_absence_id
    and type = 'krank'
  returning * into saved_absence;

  if saved_absence.id is null then
    raise exception 'Sick absence not found';
  end if;

  perform private.record_activity(
    'au_status_changed',
    saved_absence.store_id,
    null,
    jsonb_build_object('absenceId', saved_absence.id, 'status', p_status)
  );

  return saved_absence.id;
end;
$$;

revoke all on function public.set_absence_au_status(uuid, text) from public, anon;
grant execute on function public.set_absence_au_status(uuid, text) to authenticated, service_role;

-- Approved absences atomically remove overlapping shifts and return affected
-- released schedules to draft so administrators can arrange cover.
create or replace function private.remove_shifts_for_approved_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer := 0;
  affected_count integer := 0;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  with removed as (
    delete from public.schedule_shifts ss
    where ss.employee_id = new.employee_id
      and to_date(
        ss.week_key || '-' || case ss.day_key
          when 'monday' then '1'
          when 'tuesday' then '2'
          when 'wednesday' then '3'
          when 'thursday' then '4'
          when 'friday' then '5'
          when 'saturday' then '6'
          when 'sunday' then '7'
        end,
        'IYYY-"W"IW-ID'
      ) between new.start_date and new.end_date
    returning ss.schedule_id
  ), affected as (
    select distinct schedule_id from removed
  ), changed as (
    update public.schedules s
    set released = false,
        released_at = null,
        saved_at = now(),
        version = s.version + 1
    where s.id in (select schedule_id from affected)
    returning s.id
  )
  select
    (select count(*) from removed),
    (select count(*) from changed)
  into removed_count, affected_count;

  if removed_count > 0 then
    perform private.record_activity(
      'absence_schedule_cleanup',
      new.store_id,
      null,
      jsonb_build_object(
        'absenceId', new.id,
        'employeeId', new.employee_id,
        'absenceType', new.type,
        'removedShifts', removed_count,
        'affectedSchedules', affected_count
      )
    );
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.record_activity(
      'absence_approved',
      new.store_id,
      null,
      jsonb_build_object('absenceId', new.id, 'employeeId', new.employee_id)
    );
  end if;

  return new;
end;
$$;

revoke all on function private.remove_shifts_for_approved_absence()
  from public, anon, authenticated;
grant execute on function private.remove_shifts_for_approved_absence() to service_role;

drop trigger if exists absences_remove_overlapping_shifts on public.absences;
create trigger absences_remove_overlapping_shifts
  after insert or update of status, start_date, end_date, type on public.absences
  for each row execute function private.remove_shifts_for_approved_absence();

-- Versioned schedule writes prevent one administrator from silently replacing
-- a plan another administrator saved in the meantime.
create or replace function public.save_schedule_versioned(
  p_store_id text,
  p_week_key text,
  p_saved_at timestamptz,
  p_shifts jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_schedule_id uuid;
  current_version bigint;
  next_version bigint;
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
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_shifts, '[]'::jsonb)) shift
    join public.absences a
      on a.employee_id = (shift ->> 'employee_id')::uuid
     and a.status = 'approved'
     and to_date(
       p_week_key || '-' || case shift ->> 'day_key'
         when 'monday' then '1'
         when 'tuesday' then '2'
         when 'wednesday' then '3'
         when 'thursday' then '4'
         when 'friday' then '5'
         when 'saturday' then '6'
         when 'sunday' then '7'
       end,
       'IYYY-"W"IW-ID'
     ) between a.start_date and a.end_date
  ) then
    raise exception 'An absent employee cannot be scheduled';
  end if;

  select s.id, s.version
  into saved_schedule_id, current_version
  from public.schedules s
  where s.store_id = p_store_id and s.week_key = p_week_key
  for update;

  if saved_schedule_id is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'Der Plan wurde inzwischen geändert. Bitte neu laden.';
    end if;
    insert into public.schedules (store_id, week_key, released, released_at, saved_at, version)
    values (p_store_id, p_week_key, false, null, coalesce(p_saved_at, now()), 1)
    returning id, version into saved_schedule_id, next_version;
  else
    if p_expected_version is null or p_expected_version <> current_version then
      raise exception 'Der Plan wurde von einem anderen Admin geändert. Bitte neu laden, bevor du speicherst.';
    end if;
    update public.schedules
    set released = false,
        released_at = null,
        saved_at = coalesce(p_saved_at, now()),
        version = version + 1
    where id = saved_schedule_id
    returning version into next_version;
  end if;

  delete from public.schedule_shifts where schedule_id = saved_schedule_id;

  insert into public.schedule_shifts (
    schedule_id, store_id, week_key, day_key, employee_id, start, "end",
    actual_start, actual_end, deviation_json, request_status, requested_at,
    responded_at, response_reason
  )
  select
    saved_schedule_id, p_store_id, p_week_key, shift.day_key,
    shift.employee_id, shift.start_time, shift.end_time, shift.actual_start,
    shift.actual_end, shift.deviation_json, coalesce(shift.request_status, 'none'),
    shift.requested_at, shift.responded_at, shift.response_reason
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

  perform private.record_activity(
    'schedule_saved',
    p_store_id,
    p_week_key,
    jsonb_build_object(
      'scheduleId', saved_schedule_id,
      'version', next_version,
      'shiftCount', jsonb_array_length(coalesce(p_shifts, '[]'::jsonb))
    )
  );

  return jsonb_build_object('id', saved_schedule_id, 'version', next_version);
end;
$$;

revoke all on function public.save_schedule_versioned(text, text, timestamptz, jsonb, bigint)
  from public, anon;
grant execute on function public.save_schedule_versioned(text, text, timestamptz, jsonb, bigint)
  to authenticated, service_role;

create or replace function public.release_schedule_versioned(
  p_store_id text,
  p_week_key text,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  schedule_to_release public.schedules%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may release schedules';
  end if;

  select * into schedule_to_release
  from public.schedules s
  where s.store_id = p_store_id and s.week_key = p_week_key
  for update;

  if schedule_to_release.id is null then
    raise exception 'Schedule not found';
  end if;
  if p_expected_version is null or p_expected_version <> schedule_to_release.version then
    raise exception 'Der Plan wurde von einem anderen Admin geändert. Bitte neu laden, bevor du ihn freigibst.';
  end if;
  if not exists (select 1 from public.schedule_shifts ss where ss.schedule_id = schedule_to_release.id) then
    raise exception 'An empty schedule cannot be released';
  end if;
  if exists (
    select 1 from public.schedule_shifts ss
    where ss.schedule_id = schedule_to_release.id
      and ss.request_status in ('pending', 'declined')
  ) then
    raise exception 'Resolve pending or declined shift requests before release';
  end if;
  if exists (
    select 1
    from public.schedule_shifts ss
    join public.absences a on a.employee_id = ss.employee_id and a.status = 'approved'
    where ss.schedule_id = schedule_to_release.id
      and to_date(
        ss.week_key || '-' || case ss.day_key
          when 'monday' then '1'
          when 'tuesday' then '2'
          when 'wednesday' then '3'
          when 'thursday' then '4'
          when 'friday' then '5'
          when 'saturday' then '6'
          when 'sunday' then '7'
        end,
        'IYYY-"W"IW-ID'
      ) between a.start_date and a.end_date
  ) then
    raise exception 'An absent employee cannot be released on the schedule';
  end if;

  update public.schedules
  set released = true,
      released_at = now(),
      saved_at = coalesce(saved_at, now()),
      version = version + 1
  where id = schedule_to_release.id
  returning * into schedule_to_release;

  perform private.record_activity(
    'schedule_released',
    p_store_id,
    p_week_key,
    jsonb_build_object('scheduleId', schedule_to_release.id, 'version', schedule_to_release.version)
  );

  return jsonb_build_object('id', schedule_to_release.id, 'version', schedule_to_release.version);
end;
$$;

revoke all on function public.release_schedule_versioned(text, text, bigint)
  from public, anon;
grant execute on function public.release_schedule_versioned(text, text, bigint)
  to authenticated, service_role;

-- Existing cached clients keep working but still advance the version counter.
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
  current_version bigint;
  result jsonb;
begin
  select s.version into current_version
  from public.schedules s
  where s.store_id = p_store_id and s.week_key = p_week_key;

  result := public.save_schedule_versioned(
    p_store_id,
    p_week_key,
    p_saved_at,
    p_shifts,
    current_version
  );
  return (result ->> 'id')::uuid;
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
  current_version bigint;
  result jsonb;
begin
  select s.version into current_version
  from public.schedules s
  where s.store_id = p_store_id and s.week_key = p_week_key;

  result := public.release_schedule_versioned(p_store_id, p_week_key, current_version);
  return (result ->> 'id')::uuid;
end;
$$;

revoke all on function public.release_schedule(text, text) from public, anon;
grant execute on function public.release_schedule(text, text) to authenticated, service_role;

-- Add accepted/declined employee responses to the shared admin history.
create or replace function private.record_shift_response_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.request_status = 'pending'
     and new.request_status in ('accepted', 'declined')
     and new.request_status is distinct from old.request_status then
    perform private.record_activity(
      'shift_response',
      new.store_id,
      new.week_key,
      jsonb_build_object(
        'employeeId', new.employee_id,
        'dayKey', new.day_key,
        'status', new.request_status
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function private.record_shift_response_activity()
  from public, anon, authenticated;
grant execute on function private.record_shift_response_activity() to service_role;

drop trigger if exists schedule_shifts_record_response_activity on public.schedule_shifts;
create trigger schedule_shifts_record_response_activity
  after update of request_status on public.schedule_shifts
  for each row execute function private.record_shift_response_activity();

notify pgrst, 'reload schema';

commit;
