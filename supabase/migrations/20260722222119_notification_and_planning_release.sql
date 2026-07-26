begin;

-- Older FreshShift databases were created before the private helper schema
-- was added to migrations. Keep this release compatible without exposing the
-- trigger helper through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
grant execute on function private.set_updated_at() to service_role;

-- Contact and planning limits are kept on the employee record. An admin may
-- enter a phone number, but only the employee can opt in to SMS from their own
-- signed-in account.
alter table public.employees
  add column if not exists phone_e164 text,
  add column if not exists sms_opt_in boolean not null default false,
  add column if not exists phone_confirmed_at timestamptz,
  add column if not exists weekly_target_hours numeric(5, 2),
  add column if not exists weekly_max_hours numeric(5, 2);

alter table public.employees
  drop constraint if exists employees_phone_e164_check,
  add constraint employees_phone_e164_check
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  drop constraint if exists employees_phone_consent_check,
  add constraint employees_phone_consent_check
    check (not sms_opt_in or (phone_e164 is not null and phone_confirmed_at is not null)),
  drop constraint if exists employees_weekly_target_hours_check,
  add constraint employees_weekly_target_hours_check
    check (weekly_target_hours is null or weekly_target_hours between 0 and 80),
  drop constraint if exists employees_weekly_max_hours_check,
  add constraint employees_weekly_max_hours_check
    check (weekly_max_hours is null or weekly_max_hours between 0 and 80),
  drop constraint if exists employees_weekly_hours_order_check,
  add constraint employees_weekly_hours_order_check
    check (
      weekly_target_hours is null
      or weekly_max_hours is null
      or weekly_target_hours <= weekly_max_hours
    );

update public.employees
set weekly_max_hours = 18
where type = 'aushilfe' and weekly_max_hours is null;

alter table public.stores
  add column if not exists minimum_staff integer not null default 2,
  add column if not exists opening_time text not null default '10:00',
  add column if not exists closing_time text not null default '20:00';

alter table public.stores
  drop constraint if exists stores_minimum_staff_check,
  add constraint stores_minimum_staff_check check (minimum_staff between 1 and 20),
  drop constraint if exists stores_opening_time_check,
  add constraint stores_opening_time_check check (opening_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  drop constraint if exists stores_closing_time_check,
  add constraint stores_closing_time_check check (closing_time ~ '^[0-2][0-9]:[0-5][0-9]$');

update public.stores set minimum_staff = 3 where id = 'yes_fresh';
update public.stores set minimum_staff = 2 where id = 'fresh_fries';

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 4096),
  p256dh text not null check (char_length(p256dh) between 20 and 512),
  auth text not null check (char_length(auth) between 8 and 256),
  user_agent text check (user_agent is null or char_length(user_agent) <= 1000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id) where enabled;

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function private.set_updated_at();

create table if not exists public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.schedule_shifts(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  day_key text not null check (day_key in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )),
  requested_by_employee_id uuid not null references public.employees(id) on delete cascade,
  claimed_by_employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'claimed', 'approved', 'declined', 'cancelled')),
  reason text check (reason is null or char_length(reason) <= 1000),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  claimed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shift_swap_requests_one_active_per_shift
  on public.shift_swap_requests (shift_id)
  where status in ('open', 'claimed');
create index if not exists shift_swap_requests_store_status_idx
  on public.shift_swap_requests (store_id, status, created_at desc);

drop trigger if exists shift_swap_requests_set_updated_at on public.shift_swap_requests;
create trigger shift_swap_requests_set_updated_at
  before update on public.shift_swap_requests
  for each row execute function private.set_updated_at();

create table if not exists public.open_shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  source_shift_id uuid,
  source_absence_id uuid references public.absences(id) on delete set null,
  original_employee_id uuid references public.employees(id) on delete set null,
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  day_key text not null check (day_key in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )),
  start text not null check (start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  "end" text not null check ("end" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  reason text check (reason is null or char_length(reason) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'claimed', 'assigned', 'cancelled')),
  claimed_by_employee_id uuid references public.employees(id) on delete set null,
  assigned_shift_id uuid references public.schedule_shifts(id) on delete set null,
  claimed_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists open_shifts_source_shift_unique
  on public.open_shifts (source_shift_id) where source_shift_id is not null;
create index if not exists open_shifts_store_status_idx
  on public.open_shifts (store_id, status, week_key, day_key);

drop trigger if exists open_shifts_set_updated_at on public.open_shifts;
create trigger open_shifts_set_updated_at
  before update on public.open_shifts
  for each row execute function private.set_updated_at();

create table if not exists public.shift_change_history (
  id bigint generated always as identity primary key,
  schedule_id uuid references public.schedules(id) on delete set null,
  shift_id uuid,
  store_id text references public.stores(id) on delete set null,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  day_key text not null check (day_key in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )),
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null,
  change_type text not null check (change_type in (
    'published', 'added', 'time_changed', 'removed', 'reassigned',
    'opened', 'swap_approved', 'open_shift_assigned'
  )),
  before_json jsonb,
  after_json jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (before_json is null or jsonb_typeof(before_json) = 'object'),
  check (after_json is null or jsonb_typeof(after_json) = 'object')
);

create index if not exists shift_change_history_store_week_idx
  on public.shift_change_history (store_id, week_key, created_at desc);

create table if not exists public.released_shift_snapshots (
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  shift_id uuid,
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null,
  day_key text not null,
  employee_id uuid not null,
  employee_name text not null,
  start text not null,
  "end" text not null,
  published_at timestamptz not null default now(),
  primary key (schedule_id, day_key, employee_id)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_profile_id uuid references public.profiles(id) on delete cascade,
  recipient_employee_id uuid references public.employees(id) on delete cascade,
  channel text not null check (channel in ('push', 'sms')),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  external_id text,
  error text check (error is null or char_length(error) <= 2000),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (recipient_profile_id is not null or recipient_employee_id is not null)
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (status, created_at)
  where status in ('pending', 'failed');
create unique index if not exists notification_deliveries_employee_channel_unique
  on public.notification_deliveries (notification_id, channel, recipient_employee_id)
  where recipient_employee_id is not null;
create unique index if not exists notification_deliveries_profile_channel_unique
  on public.notification_deliveries (notification_id, channel, recipient_profile_id)
  where recipient_profile_id is not null;
create index if not exists notification_deliveries_recipient_employee_idx
  on public.notification_deliveries (recipient_employee_id) where recipient_employee_id is not null;
create index if not exists notification_deliveries_recipient_profile_idx
  on public.notification_deliveries (recipient_profile_id) where recipient_profile_id is not null;
create index if not exists open_shifts_assigned_shift_idx
  on public.open_shifts (assigned_shift_id) where assigned_shift_id is not null;
create index if not exists open_shifts_claimed_employee_idx
  on public.open_shifts (claimed_by_employee_id) where claimed_by_employee_id is not null;
create index if not exists open_shifts_original_employee_idx
  on public.open_shifts (original_employee_id) where original_employee_id is not null;
create index if not exists open_shifts_reviewed_by_idx
  on public.open_shifts (reviewed_by) where reviewed_by is not null;
create index if not exists open_shifts_schedule_idx on public.open_shifts (schedule_id);
create index if not exists open_shifts_source_absence_idx
  on public.open_shifts (source_absence_id) where source_absence_id is not null;
create index if not exists released_shift_snapshots_store_idx
  on public.released_shift_snapshots (store_id);
create index if not exists shift_change_history_changed_by_idx
  on public.shift_change_history (changed_by) where changed_by is not null;
create index if not exists shift_change_history_employee_idx
  on public.shift_change_history (employee_id) where employee_id is not null;
create index if not exists shift_change_history_schedule_idx
  on public.shift_change_history (schedule_id) where schedule_id is not null;
create index if not exists shift_swap_requests_claimed_employee_idx
  on public.shift_swap_requests (claimed_by_employee_id) where claimed_by_employee_id is not null;
create index if not exists shift_swap_requests_requested_employee_idx
  on public.shift_swap_requests (requested_by_employee_id);
create index if not exists shift_swap_requests_reviewed_by_idx
  on public.shift_swap_requests (reviewed_by) where reviewed_by is not null;

alter table public.push_subscriptions enable row level security;
alter table public.shift_swap_requests enable row level security;
alter table public.open_shifts enable row level security;
alter table public.shift_change_history enable row level security;
alter table public.released_shift_snapshots enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists push_subscriptions_own_select on public.push_subscriptions;
create policy push_subscriptions_own_select on public.push_subscriptions
  for select to authenticated using (profile_id = (select auth.uid()));
drop policy if exists push_subscriptions_own_insert on public.push_subscriptions;
create policy push_subscriptions_own_insert on public.push_subscriptions
  for insert to authenticated with check (profile_id = (select auth.uid()));
drop policy if exists push_subscriptions_own_update on public.push_subscriptions;
create policy push_subscriptions_own_update on public.push_subscriptions
  for update to authenticated using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions
  for delete to authenticated using (profile_id = (select auth.uid()));

drop policy if exists shift_swap_requests_select on public.shift_swap_requests;
create policy shift_swap_requests_select on public.shift_swap_requests
  for select to authenticated using (
    public.is_admin()
    or requested_by_employee_id = public.current_employee_id()
    or claimed_by_employee_id = public.current_employee_id()
    or (status in ('open', 'claimed') and public.employee_in_store(store_id))
  );

drop policy if exists open_shifts_select on public.open_shifts;
create policy open_shifts_select on public.open_shifts
  for select to authenticated using (
    public.is_admin()
    or (status in ('open', 'claimed') and public.employee_in_store(store_id))
    or claimed_by_employee_id = public.current_employee_id()
  );

drop policy if exists shift_change_history_admin_select on public.shift_change_history;
create policy shift_change_history_admin_select on public.shift_change_history
  for select to authenticated using (public.is_admin());

drop policy if exists released_shift_snapshots_browser_deny on public.released_shift_snapshots;
create policy released_shift_snapshots_browser_deny on public.released_shift_snapshots
  for select to authenticated using (false);
drop policy if exists notification_deliveries_browser_deny on public.notification_deliveries;
create policy notification_deliveries_browser_deny on public.notification_deliveries
  for select to authenticated using (false);

revoke all on table public.push_subscriptions from public, anon;
revoke all on table public.shift_swap_requests from public, anon;
revoke all on table public.open_shifts from public, anon;
revoke all on table public.shift_change_history from public, anon;
revoke all on table public.released_shift_snapshots from public, anon, authenticated;
revoke all on table public.notification_deliveries from public, anon, authenticated;

grant select, insert, update, delete on table public.push_subscriptions to authenticated, service_role;
grant select on table public.shift_swap_requests to authenticated;
grant select on table public.open_shifts to authenticated;
grant select on table public.shift_change_history to authenticated;
grant all on table public.shift_swap_requests, public.open_shifts,
  public.shift_change_history, public.released_shift_snapshots,
  public.notification_deliveries to service_role;
grant usage, select on sequence public.shift_change_history_id_seq to authenticated, service_role;

create or replace function private.shift_date(p_week_key text, p_day_key text)
returns date
language sql
immutable
strict
set search_path = ''
as $$
  select to_date(
    p_week_key || '-' || case p_day_key
      when 'monday' then '1' when 'tuesday' then '2' when 'wednesday' then '3'
      when 'thursday' then '4' when 'friday' then '5' when 'saturday' then '6'
      when 'sunday' then '7'
    end,
    'IYYY-"W"IW-ID'
  )
$$;

revoke all on function private.shift_date(text, text) from public, anon, authenticated;
grant execute on function private.shift_date(text, text) to service_role;

create or replace function private.employee_can_take_shift(
  p_employee_id uuid,
  p_store_id text,
  p_week_key text,
  p_day_key text,
  p_start text,
  p_end text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  available_day jsonb;
  available_start integer;
  available_end integer;
  shift_start integer;
  shift_end integer;
begin
  if p_employee_id is null or not exists (
    select 1 from public.employees e
    join public.employee_stores es on es.employee_id = e.id and es.store_id = p_store_id
    where e.id = p_employee_id and e.active
  ) then return false; end if;
  if exists (
    select 1 from public.schedule_shifts ss
    where ss.employee_id = p_employee_id and ss.week_key = p_week_key
      and ss.day_key = p_day_key and ss.request_status <> 'declined'
  ) then return false; end if;
  if exists (
    select 1 from public.absences a
    where a.employee_id = p_employee_id and a.status = 'approved'
      and private.shift_date(p_week_key, p_day_key) between a.start_date and a.end_date
  ) then return false; end if;

  select a.days_json -> p_day_key into available_day
  from public.availabilities a
  where a.employee_id = p_employee_id and a.store_id = p_store_id and a.week_key = p_week_key;
  if coalesce(available_day ->> 'available', 'false') <> 'true' then return false; end if;

  begin
    available_start := extract(epoch from (available_day ->> 'start')::time) / 60;
    available_end := extract(epoch from (available_day ->> 'end')::time) / 60;
    shift_start := extract(epoch from p_start::time) / 60;
    shift_end := extract(epoch from p_end::time) / 60;
  exception when others then
    return false;
  end;
  if available_end <= available_start then available_end := available_end + 1440; end if;
  if shift_end <= shift_start then shift_end := shift_end + 1440; end if;
  return available_start <= shift_start and available_end >= shift_end;
end;
$$;

revoke all on function private.employee_can_take_shift(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function private.employee_can_take_shift(uuid, text, text, text, text, text)
  to authenticated, service_role;

create or replace function private.employee_can_take_shift_for_shift(
  p_employee_id uuid,
  p_shift_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.employee_can_take_shift(
    p_employee_id, ss.store_id, ss.week_key, ss.day_key, ss.start, ss."end"
  ), false)
  from public.schedule_shifts ss
  where ss.id = p_shift_id
$$;

revoke all on function private.employee_can_take_shift_for_shift(uuid, uuid)
  from public, anon;
grant execute on function private.employee_can_take_shift_for_shift(uuid, uuid)
  to authenticated, service_role;

drop policy if exists shift_swap_requests_select on public.shift_swap_requests;
create policy shift_swap_requests_select on public.shift_swap_requests
  for select to authenticated using (
    public.is_admin()
    or requested_by_employee_id = public.current_employee_id()
    or claimed_by_employee_id = public.current_employee_id()
    or (
      status = 'open'
      and private.employee_can_take_shift_for_shift(public.current_employee_id(), shift_id)
    )
  );

drop policy if exists open_shifts_select on public.open_shifts;
create policy open_shifts_select on public.open_shifts
  for select to authenticated using (
    public.is_admin()
    or original_employee_id = public.current_employee_id()
    or claimed_by_employee_id = public.current_employee_id()
    or (
      status = 'open'
      and private.employee_can_take_shift(
        public.current_employee_id(), store_id, week_key, day_key, start, "end"
      )
    )
  );

create or replace function public.save_employee_v2(
  p_employee_id uuid,
  p_name text,
  p_type text,
  p_hourly_rate numeric,
  p_default_availability jsonb,
  p_store_ids text[],
  p_primary_store text,
  p_phone_e164 text,
  p_weekly_target_hours numeric,
  p_weekly_max_hours numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_employee_id uuid;
  normalized_name text := btrim(coalesce(p_name, ''));
  normalized_phone text := nullif(regexp_replace(coalesce(p_phone_e164, ''), '[^+0-9]', '', 'g'), '');
  normalized_stores text[];
  old_phone text;
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
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Phone number must use international format, for example +491701234567';
  end if;
  if p_weekly_target_hours is not null and p_weekly_target_hours not between 0 and 80 then
    raise exception 'Invalid weekly target hours';
  end if;
  if p_weekly_max_hours is not null and p_weekly_max_hours not between 0 and 80 then
    raise exception 'Invalid weekly maximum hours';
  end if;
  if p_weekly_target_hours is not null and p_weekly_max_hours is not null
     and p_weekly_target_hours > p_weekly_max_hours then
    raise exception 'Weekly target hours cannot exceed maximum hours';
  end if;
  if exists (
    select 1 from unnest(normalized_stores) requested_store
    where not exists (select 1 from public.stores s where s.id = requested_store)
  ) then
    raise exception 'Unknown store assignment';
  end if;

  if p_employee_id is null then
    insert into public.employees (
      name, type, hourly_rate, default_availability_json, phone_e164,
      weekly_target_hours, weekly_max_hours
    ) values (
      normalized_name, p_type, p_hourly_rate, coalesce(p_default_availability, '{}'::jsonb),
      normalized_phone, p_weekly_target_hours,
      coalesce(p_weekly_max_hours, case when p_type = 'aushilfe' then 18 else null end)
    ) returning id into saved_employee_id;
  else
    select phone_e164 into old_phone from public.employees where id = p_employee_id for update;
    update public.employees
    set name = normalized_name,
        type = p_type,
        hourly_rate = p_hourly_rate,
        default_availability_json = coalesce(p_default_availability, '{}'::jsonb),
        phone_e164 = normalized_phone,
        sms_opt_in = case when normalized_phone is not distinct from old_phone then sms_opt_in else false end,
        phone_confirmed_at = case when normalized_phone is not distinct from old_phone then phone_confirmed_at else null end,
        weekly_target_hours = p_weekly_target_hours,
        weekly_max_hours = coalesce(p_weekly_max_hours, case when p_type = 'aushilfe' then 18 else null end)
    where id = p_employee_id and active
    returning id into saved_employee_id;
    if saved_employee_id is null then raise exception 'Active employee not found'; end if;
  end if;

  delete from public.employee_stores where employee_id = saved_employee_id;
  insert into public.employee_stores (employee_id, store_id, is_primary)
  select saved_employee_id, store_id, store_id = p_primary_store
  from unnest(normalized_stores) store_id;

  return saved_employee_id;
end;
$$;

revoke all on function public.save_employee_v2(
  uuid, text, text, numeric, jsonb, text[], text, text, numeric, numeric
) from public, anon;
grant execute on function public.save_employee_v2(
  uuid, text, text, numeric, jsonb, text[], text, text, numeric, numeric
) to authenticated, service_role;

create or replace function public.save_my_notification_settings(
  p_phone_e164 text,
  p_sms_opt_in boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_employee_id uuid := public.current_employee_id();
  normalized_phone text := nullif(regexp_replace(coalesce(p_phone_e164, ''), '[^+0-9]', '', 'g'), '');
begin
  if actor_employee_id is null then raise exception 'Active employee account required'; end if;
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Bitte eine Nummer im internationalen Format eingeben, z.B. +491701234567';
  end if;
  if coalesce(p_sms_opt_in, false) and normalized_phone is null then
    raise exception 'Für SMS wird eine Telefonnummer benötigt';
  end if;

  update public.employees
  set phone_e164 = normalized_phone,
      sms_opt_in = coalesce(p_sms_opt_in, false),
      phone_confirmed_at = case when coalesce(p_sms_opt_in, false) then now() else null end
  where id = actor_employee_id;
  return actor_employee_id;
end;
$$;

revoke all on function public.save_my_notification_settings(text, boolean) from public, anon;
grant execute on function public.save_my_notification_settings(text, boolean)
  to authenticated, service_role;

create or replace function private.enqueue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_role = 'employee' then
    insert into public.notification_deliveries (
      notification_id, recipient_profile_id, recipient_employee_id, channel
    )
    select new.id, e.profile_id, e.id, 'push'
    from public.employees e
    where e.id = new.target_employee_id and e.active and e.profile_id is not null
    on conflict do nothing;

    if coalesce((new.payload ->> 'sms')::boolean, false) then
      insert into public.notification_deliveries (
        notification_id, recipient_profile_id, recipient_employee_id, channel
      )
      select new.id, e.profile_id, e.id, 'sms'
      from public.employees e
      where e.id = new.target_employee_id
        and e.active and e.sms_opt_in and e.phone_e164 is not null
        and e.phone_confirmed_at is not null
      on conflict do nothing;
    end if;
  else
    insert into public.notification_deliveries (
      notification_id, recipient_profile_id, recipient_employee_id, channel
    )
    select new.id, p.id, e.id, 'push'
    from public.profiles p
    left join public.employees e on e.profile_id = p.id and e.active
    where p.role = 'admin'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.enqueue_notification_delivery() from public, anon, authenticated;
grant execute on function private.enqueue_notification_delivery() to service_role;

drop trigger if exists notifications_enqueue_delivery on public.notifications;
create trigger notifications_enqueue_delivery
  after insert on public.notifications
  for each row execute function private.enqueue_notification_delivery();

create or replace function public.send_availability_reminder(
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
  notification_id uuid;
begin
  if not public.is_admin() then raise exception 'Only administrators may send reminders'; end if;
  if exists (
    select 1 from public.availabilities a
    where a.employee_id = p_employee_id and a.store_id = p_store_id and a.week_key = p_week_key
  ) then raise exception 'Die Verfügbarkeit wurde bereits eingetragen'; end if;
  if exists (
    select 1 from public.notifications n
    where n.target_employee_id = p_employee_id
      and n.type = 'availability_reminder'
      and n.store_id = p_store_id
      and n.payload ->> 'weekKey' = p_week_key
      and n.created_at > now() - interval '12 hours'
  ) then raise exception 'Für diese Woche wurde in den letzten 12 Stunden bereits erinnert'; end if;

  insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
  values (
    p_store_id, 'employee', p_employee_id, 'availability_reminder',
    jsonb_build_object(
      'message', 'Bitte trage deine Verfügbarkeit für ' || p_week_key || ' ein.',
      'weekKey', p_week_key,
      'sms', true,
      'url', '/#availability'
    )
  ) returning id into notification_id;
  return notification_id;
end;
$$;

revoke all on function public.send_availability_reminder(uuid, text, text) from public, anon;
grant execute on function public.send_availability_reminder(uuid, text, text)
  to authenticated, service_role;

create or replace function public.create_shift_swap_request(p_shift_id uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_employee_id uuid := public.current_employee_id();
  shift_row public.schedule_shifts%rowtype;
  request_id uuid;
  requester_name text;
  recipient record;
  urgent boolean;
begin
  if actor_employee_id is null then raise exception 'Active employee account required'; end if;
  select ss.* into shift_row
  from public.schedule_shifts ss
  join public.schedules s on s.id = ss.schedule_id and s.released
  where ss.id = p_shift_id and ss.employee_id = actor_employee_id
  for update;
  if shift_row.id is null then raise exception 'Freigegebene eigene Schicht nicht gefunden'; end if;
  if private.shift_date(shift_row.week_key, shift_row.day_key) < current_date then
    raise exception 'Vergangene Schichten können nicht getauscht werden';
  end if;

  insert into public.shift_swap_requests (
    shift_id, store_id, week_key, day_key, requested_by_employee_id, reason
  ) values (
    shift_row.id, shift_row.store_id, shift_row.week_key, shift_row.day_key,
    actor_employee_id, nullif(btrim(coalesce(p_reason, '')), '')
  ) returning id into request_id;

  select e.name into requester_name from public.employees e where e.id = actor_employee_id;
  urgent := private.shift_date(shift_row.week_key, shift_row.day_key) <= current_date + 2;

  insert into public.notifications (store_id, target_role, type, payload)
  values (
    shift_row.store_id, 'admin', 'shift_swap_requested',
    jsonb_build_object(
      'message', coalesce(requester_name, 'Mitarbeiter') || ' möchte eine Schicht abgeben.',
      'swapRequestId', request_id,
      'weekKey', shift_row.week_key,
      'dayKey', shift_row.day_key,
      'start', shift_row.start,
      'end', shift_row."end"
    )
  );

  for recipient in
    select e.id
    from public.employees e
    join public.employee_stores es on es.employee_id = e.id and es.store_id = shift_row.store_id
    where e.active and e.id <> actor_employee_id
      and private.employee_can_take_shift(
        e.id, shift_row.store_id, shift_row.week_key, shift_row.day_key,
        shift_row.start, shift_row."end"
      )
  loop
    insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
    values (
      shift_row.store_id, 'employee', recipient.id, 'shift_swap_available',
      jsonb_build_object(
        'message', 'Tauschanfrage: ' || shift_row.start || '–' || shift_row."end",
        'swapRequestId', request_id,
        'weekKey', shift_row.week_key,
        'dayKey', shift_row.day_key,
        'sms', urgent,
        'url', '/#open-shifts'
      )
    );
  end loop;
  return request_id;
end;
$$;

revoke all on function public.create_shift_swap_request(uuid, text) from public, anon;
grant execute on function public.create_shift_swap_request(uuid, text) to authenticated, service_role;

create or replace function public.claim_shift_swap(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_employee_id uuid := public.current_employee_id();
  request_row public.shift_swap_requests%rowtype;
  shift_row public.schedule_shifts%rowtype;
  claimant_name text;
begin
  if actor_employee_id is null then raise exception 'Active employee account required'; end if;
  select * into request_row from public.shift_swap_requests where id = p_request_id for update;
  if request_row.id is null or request_row.status <> 'open' then raise exception 'Tauschanfrage ist nicht mehr offen'; end if;
  if request_row.requested_by_employee_id = actor_employee_id then raise exception 'Eigene Schicht kann nicht übernommen werden'; end if;
  if not public.employee_in_store(request_row.store_id) then raise exception 'Keine Berechtigung für dieses Geschäft'; end if;
  select * into shift_row from public.schedule_shifts where id = request_row.shift_id;
  if shift_row.id is null then raise exception 'Schicht wurde inzwischen geändert'; end if;
  if exists (
    select 1 from public.schedule_shifts ss
    where ss.employee_id = actor_employee_id and ss.week_key = shift_row.week_key
      and ss.day_key = shift_row.day_key and ss.request_status <> 'declined'
  ) then raise exception 'Du hast an diesem Tag bereits eine Schicht'; end if;
  if exists (
    select 1 from public.absences a where a.employee_id = actor_employee_id
      and a.status = 'approved'
      and private.shift_date(shift_row.week_key, shift_row.day_key) between a.start_date and a.end_date
  ) then raise exception 'Du bist an diesem Tag als abwesend eingetragen'; end if;
  if not private.employee_can_take_shift(
    actor_employee_id, shift_row.store_id, shift_row.week_key, shift_row.day_key,
    shift_row.start, shift_row."end"
  ) then raise exception 'Diese Schicht liegt nicht vollständig in deiner gemeldeten Verfügbarkeit'; end if;

  update public.shift_swap_requests
  set status = 'claimed', claimed_by_employee_id = actor_employee_id, claimed_at = now()
  where id = p_request_id;
  select name into claimant_name from public.employees where id = actor_employee_id;
  insert into public.notifications (store_id, target_role, type, payload)
  values (
    request_row.store_id, 'admin', 'shift_swap_claimed',
    jsonb_build_object(
      'message', coalesce(claimant_name, 'Mitarbeiter') || ' möchte die Tauschschicht übernehmen.',
      'swapRequestId', p_request_id
    )
  );
  return p_request_id;
end;
$$;

revoke all on function public.claim_shift_swap(uuid) from public, anon;
grant execute on function public.claim_shift_swap(uuid) to authenticated, service_role;

create or replace function public.cancel_shift_swap(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare actor_employee_id uuid := public.current_employee_id();
begin
  update public.shift_swap_requests
  set status = 'cancelled'
  where id = p_request_id
    and requested_by_employee_id = actor_employee_id
    and status in ('open', 'claimed');
  if not found then raise exception 'Tauschanfrage kann nicht storniert werden'; end if;
  return p_request_id;
end;
$$;

revoke all on function public.cancel_shift_swap(uuid) from public, anon;
grant execute on function public.cancel_shift_swap(uuid) to authenticated, service_role;

create or replace function public.review_shift_swap(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.shift_swap_requests%rowtype;
  shift_row public.schedule_shifts%rowtype;
  old_name text;
  new_name text;
begin
  if not public.is_admin() then raise exception 'Only administrators may review swaps'; end if;
  select * into request_row from public.shift_swap_requests where id = p_request_id for update;
  if request_row.id is null or request_row.status <> 'claimed' then raise exception 'Keine beanspruchte Tauschanfrage gefunden'; end if;
  select * into shift_row from public.schedule_shifts where id = request_row.shift_id for update;
  if shift_row.id is null then raise exception 'Schicht wurde inzwischen geändert'; end if;

  if not coalesce(p_approve, false) then
    update public.shift_swap_requests
    set status = 'declined', reviewed_at = now(), reviewed_by = (select auth.uid()),
        admin_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_request_id;
    insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
    values (
      request_row.store_id, 'employee', request_row.claimed_by_employee_id, 'shift_swap_declined',
      jsonb_build_object('message', 'Die Übernahme wurde nicht bestätigt.', 'swapRequestId', p_request_id)
    );
    return p_request_id;
  end if;

  if exists (
    select 1 from public.schedule_shifts ss
    where ss.employee_id = request_row.claimed_by_employee_id
      and ss.week_key = shift_row.week_key and ss.day_key = shift_row.day_key
      and ss.id <> shift_row.id and ss.request_status <> 'declined'
  ) then raise exception 'Der übernehmende Mitarbeiter hat an diesem Tag bereits eine Schicht'; end if;
  if not private.employee_can_take_shift(
    request_row.claimed_by_employee_id, shift_row.store_id, shift_row.week_key,
    shift_row.day_key, shift_row.start, shift_row."end"
  ) then raise exception 'Der Mitarbeiter ist für diese Schicht nicht mehr verfügbar'; end if;

  select name into old_name from public.employees where id = shift_row.employee_id;
  select name into new_name from public.employees where id = request_row.claimed_by_employee_id;
  update public.schedule_shifts
  set employee_id = request_row.claimed_by_employee_id,
      request_status = 'accepted', requested_at = coalesce(request_row.claimed_at, now()),
      responded_at = now(), response_reason = null
  where id = shift_row.id;
  update public.schedules set version = version + 1, saved_at = now() where id = shift_row.schedule_id;
  update public.shift_swap_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = (select auth.uid()),
      admin_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_request_id;

  update public.released_shift_snapshots
  set employee_id = request_row.claimed_by_employee_id,
      employee_name = coalesce(new_name, 'Unbekannt'), published_at = now()
  where schedule_id = shift_row.schedule_id and day_key = shift_row.day_key
    and employee_id = shift_row.employee_id;

  insert into public.shift_change_history (
    schedule_id, shift_id, store_id, week_key, day_key, employee_id, employee_name,
    change_type, before_json, after_json, changed_by
  ) values (
    shift_row.schedule_id, shift_row.id, shift_row.store_id, shift_row.week_key, shift_row.day_key,
    request_row.claimed_by_employee_id, coalesce(new_name, 'Unbekannt'), 'swap_approved',
    jsonb_build_object('employeeId', shift_row.employee_id, 'employeeName', old_name, 'start', shift_row.start, 'end', shift_row."end"),
    jsonb_build_object('employeeId', request_row.claimed_by_employee_id, 'employeeName', new_name, 'start', shift_row.start, 'end', shift_row."end"),
    (select auth.uid())
  );

  insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
  values
    (shift_row.store_id, 'employee', shift_row.employee_id, 'shift_swap_approved',
      jsonb_build_object('message', 'Deine Schicht wurde erfolgreich übernommen.', 'weekKey', shift_row.week_key, 'dayKey', shift_row.day_key, 'sms', true)),
    (shift_row.store_id, 'employee', request_row.claimed_by_employee_id, 'shift_swap_approved',
      jsonb_build_object('message', 'Die Schicht ' || shift_row.start || '–' || shift_row."end" || ' gehört jetzt dir.', 'weekKey', shift_row.week_key, 'dayKey', shift_row.day_key, 'sms', true));
  return p_request_id;
end;
$$;

revoke all on function public.review_shift_swap(uuid, boolean, text) from public, anon;
grant execute on function public.review_shift_swap(uuid, boolean, text) to authenticated, service_role;

create or replace function private.open_shift_from_row(
  p_shift public.schedule_shifts,
  p_reason text,
  p_absence_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_id uuid;
  original_name text;
  recipient record;
  urgent boolean := private.shift_date(p_shift.week_key, p_shift.day_key) <= current_date + 3;
begin
  insert into public.open_shifts (
    schedule_id, source_shift_id, source_absence_id, original_employee_id,
    store_id, week_key, day_key, start, "end", reason
  ) values (
    p_shift.schedule_id, p_shift.id, p_absence_id, p_shift.employee_id,
    p_shift.store_id, p_shift.week_key, p_shift.day_key, p_shift.start, p_shift."end", p_reason
  ) on conflict (source_shift_id) where source_shift_id is not null
    do update set reason = excluded.reason
  returning id into open_id;

  select name into original_name from public.employees where id = p_shift.employee_id;
  insert into public.shift_change_history (
    schedule_id, shift_id, store_id, week_key, day_key, employee_id, employee_name,
    change_type, before_json, after_json, changed_by
  ) values (
    p_shift.schedule_id, p_shift.id, p_shift.store_id, p_shift.week_key, p_shift.day_key,
    p_shift.employee_id, coalesce(original_name, 'Unbekannt'), 'opened',
    jsonb_build_object('employeeId', p_shift.employee_id, 'start', p_shift.start, 'end', p_shift."end"),
    jsonb_build_object('openShiftId', open_id, 'reason', p_reason), (select auth.uid())
  );

  for recipient in
    select e.id from public.employees e
    join public.employee_stores es on es.employee_id = e.id and es.store_id = p_shift.store_id
    where e.active and e.id <> p_shift.employee_id
      and private.employee_can_take_shift(
        e.id, p_shift.store_id, p_shift.week_key, p_shift.day_key,
        p_shift.start, p_shift."end"
      )
  loop
    insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
    values (
      p_shift.store_id, 'employee', recipient.id, 'open_shift_available',
      jsonb_build_object(
        'message', 'Offene Schicht: ' || p_shift.start || '–' || p_shift."end",
        'openShiftId', open_id, 'weekKey', p_shift.week_key, 'dayKey', p_shift.day_key,
        'sms', urgent, 'url', '/#open-shifts'
      )
    );
  end loop;
  return open_id;
end;
$$;

revoke all on function private.open_shift_from_row(public.schedule_shifts, text, uuid)
  from public, anon, authenticated;
grant execute on function private.open_shift_from_row(public.schedule_shifts, text, uuid)
  to service_role;

create or replace function public.create_open_shift(p_shift_id uuid, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare shift_row public.schedule_shifts%rowtype; open_id uuid;
begin
  if not public.is_admin() then raise exception 'Only administrators may open shifts'; end if;
  select * into shift_row from public.schedule_shifts where id = p_shift_id for update;
  if shift_row.id is null then raise exception 'Schicht nicht gefunden'; end if;
  open_id := private.open_shift_from_row(shift_row, coalesce(nullif(btrim(p_reason), ''), 'Ersatz gesucht'));
  delete from public.schedule_shifts where id = p_shift_id;
  delete from public.released_shift_snapshots
  where schedule_id = shift_row.schedule_id and day_key = shift_row.day_key and employee_id = shift_row.employee_id;
  update public.schedules set version = version + 1, saved_at = now() where id = shift_row.schedule_id;
  insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
  values (
    shift_row.store_id, 'employee', shift_row.employee_id, 'shift_removed',
    jsonb_build_object('message', 'Deine Schicht ' || shift_row.start || '–' || shift_row."end" || ' wurde entfernt.', 'weekKey', shift_row.week_key, 'dayKey', shift_row.day_key, 'sms', true)
  );
  return open_id;
end;
$$;

revoke all on function public.create_open_shift(uuid, text) from public, anon;
grant execute on function public.create_open_shift(uuid, text) to authenticated, service_role;

create or replace function public.claim_open_shift(p_open_shift_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare actor_employee_id uuid := public.current_employee_id(); open_row public.open_shifts%rowtype; claimant_name text;
begin
  if actor_employee_id is null then raise exception 'Active employee account required'; end if;
  select * into open_row from public.open_shifts where id = p_open_shift_id for update;
  if open_row.id is null or open_row.status <> 'open' then raise exception 'Schicht ist nicht mehr offen'; end if;
  if open_row.original_employee_id = actor_employee_id then raise exception 'Eigene abgegebene Schicht kann nicht übernommen werden'; end if;
  if not public.employee_in_store(open_row.store_id) then raise exception 'Keine Berechtigung für dieses Geschäft'; end if;
  if exists (
    select 1 from public.schedule_shifts ss where ss.employee_id = actor_employee_id
      and ss.week_key = open_row.week_key and ss.day_key = open_row.day_key
      and ss.request_status <> 'declined'
  ) then raise exception 'Du hast an diesem Tag bereits eine Schicht'; end if;
  if exists (
    select 1 from public.absences a where a.employee_id = actor_employee_id and a.status = 'approved'
      and private.shift_date(open_row.week_key, open_row.day_key) between a.start_date and a.end_date
  ) then raise exception 'Du bist an diesem Tag als abwesend eingetragen'; end if;
  if not private.employee_can_take_shift(
    actor_employee_id, open_row.store_id, open_row.week_key, open_row.day_key,
    open_row.start, open_row."end"
  ) then raise exception 'Diese Schicht liegt nicht vollständig in deiner gemeldeten Verfügbarkeit'; end if;
  update public.open_shifts set status = 'claimed', claimed_by_employee_id = actor_employee_id, claimed_at = now()
  where id = p_open_shift_id;
  select name into claimant_name from public.employees where id = actor_employee_id;
  insert into public.notifications (store_id, target_role, type, payload)
  values (
    open_row.store_id, 'admin', 'open_shift_claimed',
    jsonb_build_object('message', coalesce(claimant_name, 'Mitarbeiter') || ' möchte eine offene Schicht übernehmen.', 'openShiftId', p_open_shift_id)
  );
  return p_open_shift_id;
end;
$$;

revoke all on function public.claim_open_shift(uuid) from public, anon;
grant execute on function public.claim_open_shift(uuid) to authenticated, service_role;

create or replace function public.review_open_shift(
  p_open_shift_id uuid,
  p_approve boolean,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare open_row public.open_shifts%rowtype; new_shift_id uuid; employee_name text; schedule_released boolean;
begin
  if not public.is_admin() then raise exception 'Only administrators may review open shifts'; end if;
  select * into open_row from public.open_shifts where id = p_open_shift_id for update;
  if open_row.id is null or open_row.status <> 'claimed' then raise exception 'Keine beanspruchte offene Schicht gefunden'; end if;
  if not coalesce(p_approve, false) then
    update public.open_shifts set status = 'open', claimed_by_employee_id = null, claimed_at = null,
      reviewed_at = now(), reviewed_by = (select auth.uid()), reason = coalesce(nullif(btrim(p_note), ''), reason)
    where id = p_open_shift_id;
    insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
    values (open_row.store_id, 'employee', open_row.claimed_by_employee_id, 'open_shift_declined',
      jsonb_build_object('message', 'Die Übernahme wurde nicht bestätigt.', 'openShiftId', p_open_shift_id));
    return p_open_shift_id;
  end if;
  if exists (
    select 1 from public.schedule_shifts ss where ss.employee_id = open_row.claimed_by_employee_id
      and ss.week_key = open_row.week_key and ss.day_key = open_row.day_key and ss.request_status <> 'declined'
  ) then raise exception 'Der Mitarbeiter hat an diesem Tag bereits eine Schicht'; end if;
  if not private.employee_can_take_shift(
    open_row.claimed_by_employee_id, open_row.store_id, open_row.week_key,
    open_row.day_key, open_row.start, open_row."end"
  ) then raise exception 'Der Mitarbeiter ist für diese Schicht nicht mehr verfügbar'; end if;

  insert into public.schedule_shifts (
    schedule_id, store_id, week_key, day_key, employee_id, start, "end",
    request_status, requested_at, responded_at
  ) values (
    open_row.schedule_id, open_row.store_id, open_row.week_key, open_row.day_key,
    open_row.claimed_by_employee_id, open_row.start, open_row."end", 'accepted',
    coalesce(open_row.claimed_at, now()), now()
  ) returning id into new_shift_id;
  update public.schedules set version = version + 1, saved_at = now() where id = open_row.schedule_id
  returning released into schedule_released;
  update public.open_shifts set status = 'assigned', assigned_shift_id = new_shift_id,
    reviewed_at = now(), reviewed_by = (select auth.uid()), reason = coalesce(nullif(btrim(p_note), ''), reason)
  where id = p_open_shift_id;
  select name into employee_name from public.employees where id = open_row.claimed_by_employee_id;
  if schedule_released then
    insert into public.released_shift_snapshots (
      schedule_id, shift_id, store_id, week_key, day_key, employee_id, employee_name, start, "end"
    ) values (
      open_row.schedule_id, new_shift_id, open_row.store_id, open_row.week_key, open_row.day_key,
      open_row.claimed_by_employee_id, coalesce(employee_name, 'Unbekannt'), open_row.start, open_row."end"
    ) on conflict (schedule_id, day_key, employee_id) do update
      set shift_id = excluded.shift_id, employee_name = excluded.employee_name,
          start = excluded.start, "end" = excluded."end", published_at = now();
  end if;
  insert into public.shift_change_history (
    schedule_id, shift_id, store_id, week_key, day_key, employee_id, employee_name,
    change_type, after_json, changed_by
  ) values (
    open_row.schedule_id, new_shift_id, open_row.store_id, open_row.week_key, open_row.day_key,
    open_row.claimed_by_employee_id, coalesce(employee_name, 'Unbekannt'), 'open_shift_assigned',
    jsonb_build_object('employeeId', open_row.claimed_by_employee_id, 'start', open_row.start, 'end', open_row."end"),
    (select auth.uid())
  );
  insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
  values (
    open_row.store_id, 'employee', open_row.claimed_by_employee_id, 'open_shift_assigned',
    jsonb_build_object('message', 'Die offene Schicht ' || open_row.start || '–' || open_row."end" || ' gehört jetzt dir.', 'weekKey', open_row.week_key, 'dayKey', open_row.day_key, 'sms', true)
  );
  return p_open_shift_id;
end;
$$;

revoke all on function public.review_open_shift(uuid, boolean, text) from public, anon;
grant execute on function public.review_open_shift(uuid, boolean, text) to authenticated, service_role;

-- Replace the old sickness cleanup: a removed shift from a released plan is
-- now turned into an open replacement shift while the rest of the plan stays
-- visible to employees.
create or replace function private.remove_shifts_for_approved_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  shift_row public.schedule_shifts%rowtype;
  removed_count integer := 0;
  affected_schedule_ids uuid[] := '{}'::uuid[];
begin
  if new.status <> 'approved' then return new; end if;
  for shift_row in
    select ss.* from public.schedule_shifts ss
    where ss.employee_id = new.employee_id
      and private.shift_date(ss.week_key, ss.day_key) between new.start_date and new.end_date
    for update
  loop
    if new.type = 'krank' and exists (
      select 1 from public.schedules s where s.id = shift_row.schedule_id and s.released
    ) then
      perform private.open_shift_from_row(shift_row, 'Krankheitsvertretung', new.id);
    end if;
    delete from public.schedule_shifts where id = shift_row.id;
    delete from public.released_shift_snapshots
    where schedule_id = shift_row.schedule_id and day_key = shift_row.day_key
      and employee_id = shift_row.employee_id;
    removed_count := removed_count + 1;
    affected_schedule_ids := array_append(affected_schedule_ids, shift_row.schedule_id);
  end loop;

  update public.schedules s
  set saved_at = now(), version = version + 1
  where s.id = any(affected_schedule_ids);

  if removed_count > 0 then
    perform private.record_activity(
      'absence_schedule_cleanup', new.store_id, null,
      jsonb_build_object('absenceId', new.id, 'employeeId', new.employee_id, 'removedShifts', removed_count)
    );
  end if;
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform private.record_activity(
      'absence_approved', new.store_id, null,
      jsonb_build_object('absenceId', new.id, 'employeeId', new.employee_id)
    );
  end if;
  return new;
end;
$$;

create or replace function private.notify_released_schedule_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap record;
  current_shift record;
  has_snapshot boolean;
  urgent boolean;
  notified_employee_ids uuid[] := '{}'::uuid[];
begin
  if not new.released or (old.released and new.released) then return new; end if;
  select exists (
    select 1 from public.released_shift_snapshots rss where rss.schedule_id = new.id
  ) into has_snapshot;

  if not has_snapshot then
    for current_shift in
      select ss.*, e.name as employee_name from public.schedule_shifts ss
      join public.employees e on e.id = ss.employee_id
      where ss.schedule_id = new.id and ss.request_status in ('none', 'accepted')
    loop
      if not (current_shift.employee_id = any(notified_employee_ids)) then
        insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
        values (
          current_shift.store_id, 'employee', current_shift.employee_id, 'schedule_published',
          jsonb_build_object('message', 'Dein neuer Wochenplan wurde freigegeben.', 'weekKey', current_shift.week_key, 'sms', false, 'url', '/#schedule')
        );
        notified_employee_ids := array_append(notified_employee_ids, current_shift.employee_id);
      end if;
      insert into public.shift_change_history (
        schedule_id, shift_id, store_id, week_key, day_key, employee_id,
        employee_name, change_type, after_json, changed_by
      ) values (
        new.id, current_shift.id, current_shift.store_id, current_shift.week_key,
        current_shift.day_key, current_shift.employee_id, current_shift.employee_name,
        'published', jsonb_build_object('start', current_shift.start, 'end', current_shift."end"),
        (select auth.uid())
      );
    end loop;
  else
    for snap in select * from public.released_shift_snapshots where schedule_id = new.id loop
      select ss.*, e.name as employee_name into current_shift
      from public.schedule_shifts ss join public.employees e on e.id = ss.employee_id
      where ss.schedule_id = new.id and ss.day_key = snap.day_key
        and ss.employee_id = snap.employee_id and ss.request_status in ('none', 'accepted');
      urgent := private.shift_date(snap.week_key, snap.day_key) <= current_date + 2;
      if current_shift.id is null then
        insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
        values (
          snap.store_id, 'employee', snap.employee_id, 'shift_removed',
          jsonb_build_object('message', 'Deine Schicht ' || snap.start || '–' || snap."end" || ' wurde entfernt.', 'weekKey', snap.week_key, 'dayKey', snap.day_key, 'sms', urgent, 'url', '/#schedule')
        );
        insert into public.shift_change_history (
          schedule_id, shift_id, store_id, week_key, day_key, employee_id,
          employee_name, change_type, before_json, changed_by
        ) values (
          new.id, snap.shift_id, snap.store_id, snap.week_key, snap.day_key,
          snap.employee_id, snap.employee_name, 'removed',
          jsonb_build_object('start', snap.start, 'end', snap."end"), (select auth.uid())
        );
      elsif current_shift.start is distinct from snap.start or current_shift."end" is distinct from snap."end" then
        insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
        values (
          snap.store_id, 'employee', snap.employee_id, 'shift_changed',
          jsonb_build_object('message', 'Schicht geändert: ' || snap.start || '–' || snap."end" || ' → ' || current_shift.start || '–' || current_shift."end", 'weekKey', snap.week_key, 'dayKey', snap.day_key, 'sms', urgent, 'url', '/#schedule')
        );
        insert into public.shift_change_history (
          schedule_id, shift_id, store_id, week_key, day_key, employee_id,
          employee_name, change_type, before_json, after_json, changed_by
        ) values (
          new.id, current_shift.id, snap.store_id, snap.week_key, snap.day_key,
          snap.employee_id, current_shift.employee_name, 'time_changed',
          jsonb_build_object('start', snap.start, 'end', snap."end"),
          jsonb_build_object('start', current_shift.start, 'end', current_shift."end"),
          (select auth.uid())
        );
      end if;
    end loop;

    for current_shift in
      select ss.*, e.name as employee_name from public.schedule_shifts ss
      join public.employees e on e.id = ss.employee_id
      where ss.schedule_id = new.id and ss.request_status in ('none', 'accepted')
        and not exists (
          select 1 from public.released_shift_snapshots rss
          where rss.schedule_id = new.id and rss.day_key = ss.day_key and rss.employee_id = ss.employee_id
        )
    loop
      urgent := private.shift_date(current_shift.week_key, current_shift.day_key) <= current_date + 2;
      insert into public.notifications (store_id, target_role, target_employee_id, type, payload)
      values (
        current_shift.store_id, 'employee', current_shift.employee_id, 'shift_added',
        jsonb_build_object('message', 'Neue Schicht: ' || current_shift.start || '–' || current_shift."end", 'weekKey', current_shift.week_key, 'dayKey', current_shift.day_key, 'sms', urgent, 'url', '/#schedule')
      );
      insert into public.shift_change_history (
        schedule_id, shift_id, store_id, week_key, day_key, employee_id,
        employee_name, change_type, after_json, changed_by
      ) values (
        new.id, current_shift.id, current_shift.store_id, current_shift.week_key,
        current_shift.day_key, current_shift.employee_id, current_shift.employee_name,
        'added', jsonb_build_object('start', current_shift.start, 'end', current_shift."end"),
        (select auth.uid())
      );
    end loop;
  end if;

  delete from public.released_shift_snapshots where schedule_id = new.id;
  insert into public.released_shift_snapshots (
    schedule_id, shift_id, store_id, week_key, day_key, employee_id, employee_name, start, "end"
  )
  select ss.schedule_id, ss.id, ss.store_id, ss.week_key, ss.day_key,
    ss.employee_id, e.name, ss.start, ss."end"
  from public.schedule_shifts ss join public.employees e on e.id = ss.employee_id
  where ss.schedule_id = new.id and ss.request_status in ('none', 'accepted');
  return new;
end;
$$;

revoke all on function private.notify_released_schedule_changes() from public, anon, authenticated;
grant execute on function private.notify_released_schedule_changes() to service_role;

drop trigger if exists schedules_notify_release_changes on public.schedules;
create trigger schedules_notify_release_changes
  after update of released on public.schedules
  for each row execute function private.notify_released_schedule_changes();

drop function if exists public.claim_notification_deliveries(integer);
create or replace function public.claim_notification_deliveries(
  p_limit integer default 50,
  p_channel text default null
)
returns table (
  delivery_id uuid,
  channel text,
  recipient_profile_id uuid,
  recipient_employee_id uuid,
  notification_type text,
  title text,
  message text,
  target_url text,
  phone_e164 text,
  push_subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel is not null and p_channel not in ('push', 'sms') then
    raise exception 'Invalid notification channel';
  end if;
  return query
  with claimed as (
    select nd.id
    from public.notification_deliveries nd
    where nd.status in ('pending', 'failed') and nd.attempts < 3
      and (p_channel is null or nd.channel = p_channel)
    order by nd.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  ), updated as (
    update public.notification_deliveries nd
    set status = 'sending', attempts = attempts + 1, last_attempt_at = now(), error = null
    from claimed where nd.id = claimed.id
    returning nd.*
  )
  select
    u.id,
    u.channel,
    u.recipient_profile_id,
    u.recipient_employee_id,
    n.type,
    'FreshShift'::text,
    coalesce(n.payload ->> 'message', 'Neue FreshShift-Mitteilung'),
    coalesce(n.payload ->> 'url', '/')::text,
    e.phone_e164,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth
      )) from public.push_subscriptions ps
      where ps.profile_id = u.recipient_profile_id and ps.enabled
    ), '[]'::jsonb)
  from updated u
  join public.notifications n on n.id = u.notification_id
  left join public.employees e on e.id = u.recipient_employee_id;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, text) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer, text) to service_role;

-- Provider credentials live encrypted in Supabase Vault. The function is
-- callable only with the server-side service role and never from a browser.
create or replace function public.get_notification_service_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(ds.name, ds.decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets ds
  where ds.name in (
    'freshshift_vapid_public_key',
    'freshshift_vapid_private_key',
    'freshshift_twilio_account_sid',
    'freshshift_twilio_auth_token',
    'freshshift_twilio_messaging_service_sid',
    'freshshift_twilio_from_number'
  )
$$;

revoke all on function public.get_notification_service_config()
  from public, anon, authenticated;
grant execute on function public.get_notification_service_config() to service_role;

create or replace function public.finish_notification_delivery(
  p_delivery_id uuid,
  p_status text,
  p_external_id text default null,
  p_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'Invalid delivery status'; end if;
  update public.notification_deliveries
  set status = p_status,
      external_id = left(p_external_id, 500),
      error = left(p_error, 2000),
      sent_at = case when p_status = 'sent' then now() else null end
  where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;
  return p_delivery_id;
end;
$$;

revoke all on function public.finish_notification_delivery(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_notification_delivery(uuid, text, text, text)
  to service_role;

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check check (action in (
  'schedule_saved', 'schedule_released', 'shift_response', 'absence_approved',
  'absence_schedule_cleanup', 'absence_cancelled', 'au_status_changed',
  'employee_terminated', 'availability_reset', 'employee_email_updated',
  'availability_reminder_sent', 'shift_swap_reviewed', 'open_shift_reviewed'
));

commit;
