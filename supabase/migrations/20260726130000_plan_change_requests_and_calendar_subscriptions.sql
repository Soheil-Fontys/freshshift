begin;

-- A plan change request preserves the originally published shift even if an
-- administrator later edits the draft. The employee can only request a
-- change; an administrator remains the only party that can change a plan.
create table if not exists public.shift_change_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references public.schedule_shifts(id) on delete set null,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  day_key text not null check (day_key in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  employee_id uuid not null references public.employees(id) on delete cascade,
  original_start text not null check (original_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  original_end text not null check (original_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  requested_start text not null check (requested_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  requested_end text not null check (requested_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'outdated')),
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  check (original_start <> original_end),
  check (requested_start <> requested_end)
);

create unique index if not exists shift_change_requests_one_pending_per_shift_idx
  on public.shift_change_requests (schedule_id, employee_id, day_key)
  where status = 'pending';
create index if not exists shift_change_requests_store_status_idx
  on public.shift_change_requests (store_id, status, requested_at desc);
create index if not exists shift_change_requests_employee_idx
  on public.shift_change_requests (employee_id, requested_at desc);

-- Calendar links are intentionally stored as hashes only. The real link is
-- returned once after creation and can be reset when a device is lost.
create table if not exists public.calendar_subscriptions (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

alter table public.shift_change_requests enable row level security;
alter table public.calendar_subscriptions enable row level security;

drop policy if exists shift_change_requests_select on public.shift_change_requests;
create policy shift_change_requests_select on public.shift_change_requests
  for select to authenticated
  using (
    public.is_admin()
    or employee_id = public.current_employee_id()
  );

-- Calendar subscriptions are only accessed through a tightly scoped RPC and
-- the public calendar Edge Function. Browser roles never receive hashes.
drop policy if exists calendar_subscriptions_browser_deny on public.calendar_subscriptions;
create policy calendar_subscriptions_browser_deny on public.calendar_subscriptions
  for select to authenticated using (false);

revoke all on table public.shift_change_requests from public, anon, authenticated;
grant select on table public.shift_change_requests to authenticated;
revoke all on table public.calendar_subscriptions from public, anon, authenticated;

create or replace function public.create_shift_change_request(
  p_shift_id uuid,
  p_requested_start text,
  p_requested_end text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  shift_row public.schedule_shifts%rowtype;
  schedule_released boolean;
  request_id uuid;
begin
  actor_employee_id := public.current_employee_id();
  if actor_employee_id is null then
    raise exception 'Aktiver Mitarbeiterzugang erforderlich';
  end if;
  if p_requested_start !~ '^[0-2][0-9]:[0-5][0-9]$'
    or p_requested_end !~ '^[0-2][0-9]:[0-5][0-9]$'
    or p_requested_start = p_requested_end then
    raise exception 'Bitte gib gültige unterschiedliche Zeiten ein';
  end if;

  select ss.*, s.released
  into shift_row, schedule_released
  from public.schedule_shifts ss
  join public.schedules s on s.id = ss.schedule_id
  where ss.id = p_shift_id
  for update of ss;

  if shift_row.id is null or not schedule_released then
    raise exception 'Diese Schicht ist nicht mehr veröffentlicht';
  end if;
  if shift_row.employee_id <> actor_employee_id then
    raise exception 'Du kannst nur für deine eigene Schicht eine Änderung anfragen';
  end if;
  if shift_row.request_status not in ('none', 'accepted') then
    raise exception 'Für diese Schicht ist aktuell keine Änderung möglich';
  end if;
  if shift_row.start = p_requested_start and shift_row."end" = p_requested_end then
    raise exception 'Die gewünschte Zeit entspricht bereits deiner Schicht';
  end if;

  insert into public.shift_change_requests (
    shift_id, schedule_id, store_id, week_key, day_key, employee_id,
    original_start, original_end, requested_start, requested_end, reason
  ) values (
    shift_row.id, shift_row.schedule_id, shift_row.store_id, shift_row.week_key,
    shift_row.day_key, actor_employee_id, shift_row.start, shift_row."end",
    p_requested_start, p_requested_end, nullif(btrim(coalesce(p_reason, '')), '')
  ) returning id into request_id;

  insert into public.notifications (store_id, target_role, type, payload)
  values (
    shift_row.store_id,
    'admin',
    'plan_change_requested',
    jsonb_build_object(
      'message', 'Neue Anfrage zur Planänderung',
      'requestId', request_id,
      'shiftId', shift_row.id,
      'weekKey', shift_row.week_key,
      'dayKey', shift_row.day_key,
      'url', '/#admin-dashboard'
    )
  );

  return request_id;
end;
$$;

revoke all on function public.create_shift_change_request(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_shift_change_request(uuid, text, text, text)
  to authenticated, service_role;

create or replace function public.cancel_shift_change_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  request_row public.shift_change_requests%rowtype;
begin
  actor_employee_id := public.current_employee_id();
  if actor_employee_id is null then
    raise exception 'Aktiver Mitarbeiterzugang erforderlich';
  end if;
  select * into request_row from public.shift_change_requests
  where id = p_request_id for update;
  if request_row.id is null or request_row.employee_id <> actor_employee_id then
    raise exception 'Planänderungsanfrage nicht gefunden';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Diese Anfrage kann nicht mehr zurückgezogen werden';
  end if;

  update public.shift_change_requests
  set status = 'cancelled', cancelled_at = now()
  where id = request_row.id;

  return request_row.id;
end;
$$;

revoke all on function public.cancel_shift_change_request(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_shift_change_request(uuid)
  to authenticated, service_role;

create or replace function public.review_shift_change_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.shift_change_requests%rowtype;
  current_shift public.schedule_shifts%rowtype;
  employee_name text;
  resolution_note text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may review plan change requests';
  end if;
  select * into request_row from public.shift_change_requests
  where id = p_request_id for update;
  if request_row.id is null then
    raise exception 'Planänderungsanfrage nicht gefunden';
  end if;
  if request_row.status <> 'pending' then
    raise exception 'Diese Anfrage wurde bereits bearbeitet';
  end if;

  select * into current_shift from public.schedule_shifts
  where schedule_id = request_row.schedule_id
    and employee_id = request_row.employee_id
    and day_key = request_row.day_key
    and request_status in ('none', 'accepted')
  for update;

  if current_shift.id is null
    or current_shift.start is distinct from request_row.original_start
    or current_shift."end" is distinct from request_row.original_end then
    resolution_note := coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Die ursprüngliche Schicht wurde inzwischen geändert.');
    update public.shift_change_requests
    set status = 'outdated', admin_note = resolution_note,
        reviewed_at = now(), reviewed_by = (select auth.uid())
    where id = request_row.id;
    insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
    values (
      request_row.store_id, 'employee', request_row.employee_id, 'plan_change_outdated',
      jsonb_build_object('message', resolution_note, 'requestId', request_row.id, 'url', '/#schedule')
    );
    return request_row.id;
  end if;

  resolution_note := nullif(btrim(coalesce(p_note, '')), '');
  if not p_approve then
    update public.shift_change_requests
    set status = 'rejected', admin_note = resolution_note,
        reviewed_at = now(), reviewed_by = (select auth.uid())
    where id = request_row.id;
    insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
    values (
      request_row.store_id, 'employee', request_row.employee_id, 'plan_change_rejected',
      jsonb_build_object(
        'message', coalesce(resolution_note, 'Deine Anfrage zur Planänderung wurde abgelehnt.'),
        'requestId', request_row.id, 'url', '/#schedule'
      )
    );
  else
    update public.schedule_shifts
    set start = request_row.requested_start, "end" = request_row.requested_end
    where id = current_shift.id;
    -- The published-plan trigger compares the old snapshot on the second
    -- update and creates the normal history entry plus the employee alert.
    update public.schedules
    set released = false, saved_at = now(), version = version + 1
    where id = request_row.schedule_id;
    update public.schedules
    set released = true
    where id = request_row.schedule_id;
    update public.shift_change_requests
    set status = 'approved', admin_note = resolution_note,
        reviewed_at = now(), reviewed_by = (select auth.uid())
    where id = request_row.id;
  end if;

  select name into employee_name from public.employees where id = request_row.employee_id;
  perform private.record_activity(
    'plan_change_reviewed', request_row.store_id, request_row.week_key,
    jsonb_build_object(
      'requestId', request_row.id,
      'employeeId', request_row.employee_id,
      'employeeName', employee_name,
      'approved', p_approve
    )
  );
  return request_row.id;
end;
$$;

revoke all on function public.review_shift_change_request(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_shift_change_request(uuid, boolean, text)
  to authenticated, service_role;

create or replace function public.rotate_my_calendar_subscription_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  raw_token text;
begin
  actor_employee_id := public.current_employee_id();
  if actor_employee_id is null or not exists (
    select 1 from public.employees where id = actor_employee_id and active
  ) then
    raise exception 'Aktiver Mitarbeiterzugang erforderlich';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');
  insert into public.calendar_subscriptions (employee_id, token_hash, rotated_at)
  values (actor_employee_id, encode(digest(raw_token, 'sha256'), 'hex'), now())
  on conflict (employee_id) do update
  set token_hash = excluded.token_hash, rotated_at = excluded.rotated_at;

  return raw_token;
end;
$$;

revoke all on function public.rotate_my_calendar_subscription_token()
  from public, anon, authenticated;
grant execute on function public.rotate_my_calendar_subscription_token()
  to authenticated, service_role;

-- The public calendar endpoint calls this through the service role. Keeping
-- the reads inside a function means the subscription table itself never has
-- to be exposed through the Data API.
create or replace function public.get_calendar_feed(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  feed jsonb;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select jsonb_build_object(
    'employeeName', e.name,
    'shifts', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', ss.id,
          'schedule_id', ss.schedule_id,
          'store_id', ss.store_id,
          'week_key', ss.week_key,
          'day_key', ss.day_key,
          'start', ss.start,
          'end', ss."end",
          'updated_at', ss.updated_at
        ) order by ss.week_key,
          case ss.day_key
            when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
            when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6
            when 'sunday' then 7 else 8
          end,
          ss.start
      ) filter (where s.id is not null),
      '[]'::jsonb
    )
  ) into feed
  from public.calendar_subscriptions cs
  join public.employees e on e.id = cs.employee_id and e.active
  left join public.schedule_shifts ss
    on ss.employee_id = e.id and ss.request_status in ('none', 'accepted')
  left join public.schedules s on s.id = ss.schedule_id and s.released
  where cs.token_hash = p_token_hash
  group by e.name;
  return feed;
end;
$$;

revoke all on function public.get_calendar_feed(text)
  from public, anon, authenticated;
grant execute on function public.get_calendar_feed(text) to service_role;

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check check (action in (
  'schedule_saved', 'schedule_released', 'shift_response', 'absence_approved',
  'absence_schedule_cleanup', 'absence_cancelled', 'au_status_changed',
  'employee_terminated', 'availability_reset', 'employee_email_updated',
  'availability_reminder_sent', 'shift_swap_reviewed', 'open_shift_reviewed',
  'plan_change_reviewed'
));

commit;
