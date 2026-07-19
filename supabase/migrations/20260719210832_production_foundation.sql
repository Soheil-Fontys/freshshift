begin;

-- Remote migration version: 20260719210832.
-- FreshShift production foundation, rebuilt from the January 2026 backup.
-- Auth's system tables are intentionally not restored; users will be invited
-- into the new project so they receive fresh sessions and tokens.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin, service_role;

create table public.stores (
  id text primary key,
  name text not null unique
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'employee'
    check (role in ('admin', 'employee')),
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'aushilfe'
    check (type in ('aushilfe', 'festangestellt')),
  hourly_rate numeric(10, 2)
    check (hourly_rate is null or hourly_rate >= 0),
  profile_id uuid unique references public.profiles(id) on delete set null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index employees_email_unique
  on public.employees (lower(email))
  where email is not null;

create table public.employee_stores (
  employee_id uuid not null references public.employees(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (employee_id, store_id)
);

create table public.availabilities (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  days_json jsonb not null,
  notes text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, employee_id, week_key)
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  released boolean not null default false,
  released_at timestamptz,
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, week_key)
);

create table public.schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  day_key text not null
    check (day_key in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  employee_id uuid not null references public.employees(id) on delete cascade,
  start text not null check (start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  "end" text not null check ("end" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  actual_start text check (actual_start is null or actual_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  actual_end text check (actual_end is null or actual_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  deviation_json jsonb,
  request_status text not null default 'none'
    check (request_status in ('none', 'pending', 'accepted', 'declined')),
  requested_at timestamptz,
  responded_at timestamptz,
  response_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, day_key, employee_id)
);

create index schedule_shifts_employee_week_idx
  on public.schedule_shifts (employee_id, week_key);

create table public.absences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  store_id text references public.stores(id) on delete set null,
  start_date date not null,
  end_date date not null,
  type text not null check (type in ('urlaub', 'krank', 'sonstiges')),
  note text,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'declined')),
  requested_by text not null default 'employee'
    check (requested_by in ('employee', 'admin')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  response_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index absences_employee_dates_idx
  on public.absences (employee_id, start_date, end_date);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  store_id text references public.stores(id) on delete set null,
  target_role text check (target_role in ('admin', 'employee')),
  target_employee_id uuid references public.employees(id) on delete cascade,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_employee_unread_idx
  on public.notifications (target_employee_id, created_at desc)
  where read_at is null;

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
grant execute on function private.set_updated_at() to supabase_auth_admin, service_role;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function private.set_updated_at();
create trigger availabilities_set_updated_at
  before update on public.availabilities
  for each row execute function private.set_updated_at();
create trigger schedules_set_updated_at
  before update on public.schedules
  for each row execute function private.set_updated_at();
create trigger schedule_shifts_set_updated_at
  before update on public.schedule_shifts
  for each row execute function private.set_updated_at();
create trigger absences_set_updated_at
  before update on public.absences
  for each row execute function private.set_updated_at();

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
  limit 1
$$;

create or replace function public.employee_in_store(requested_store text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_stores es
    where es.employee_id = public.current_employee_id()
      and es.store_id = requested_store
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  )
$$;

revoke all on function public.current_employee_id() from public, anon;
revoke all on function public.employee_in_store(text) from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.current_employee_id() to authenticated, service_role;
grant execute on function public.employee_in_store(text) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name, email)
  values (
    new.id,
    'employee',
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email;

  update public.employees
  set profile_id = new.id
  where profile_id is null
    and email is not null
    and new.email is not null
    and lower(email) = lower(new.email);

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.handle_new_user() to supabase_auth_admin, service_role;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.guard_shift_employee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  if old.employee_id <> public.current_employee_id()
     or old.request_status <> 'pending'
     or new.request_status not in ('accepted', 'declined')
     or new.schedule_id is distinct from old.schedule_id
     or new.store_id is distinct from old.store_id
     or new.week_key is distinct from old.week_key
     or new.day_key is distinct from old.day_key
     or new.employee_id is distinct from old.employee_id
     or new.start is distinct from old.start
     or new."end" is distinct from old."end"
     or new.actual_start is distinct from old.actual_start
     or new.actual_end is distinct from old.actual_end
     or new.deviation_json is distinct from old.deviation_json
     or new.requested_at is distinct from old.requested_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the response to an assigned pending shift may be changed';
  end if;

  new.responded_at = coalesce(new.responded_at, now());
  return new;
end;
$$;

revoke all on function private.guard_shift_employee_update() from public, anon, authenticated;
grant execute on function private.guard_shift_employee_update() to service_role;

create trigger schedule_shifts_guard_employee_update
  before update on public.schedule_shifts
  for each row execute function private.guard_shift_employee_update();

-- Store identifiers are stable application configuration. Recovered employee
-- records are restored separately and deliberately excluded from Git history.
insert into public.stores (id, name) values
  ('fresh_fries', 'Fresh Fries'),
  ('yes_fresh', 'Yes Fresh');

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.employee_stores enable row level security;
alter table public.availabilities enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_shifts enable row level security;
alter table public.absences enable row level security;
alter table public.notifications enable row level security;

create policy stores_select_authenticated on public.stores
  for select to authenticated using (true);
create policy stores_admin_all on public.stores
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy employees_select_own on public.employees
  for select to authenticated using (profile_id = (select auth.uid()));
create policy employees_admin_all on public.employees
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy employee_stores_select_own on public.employee_stores
  for select to authenticated
  using (employee_id = public.current_employee_id());
create policy employee_stores_admin_all on public.employee_stores
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy availabilities_employee_own on public.availabilities
  to authenticated
  using (
    employee_id = public.current_employee_id()
    and public.employee_in_store(store_id)
  )
  with check (
    employee_id = public.current_employee_id()
    and public.employee_in_store(store_id)
  );
create policy availabilities_admin_all on public.availabilities
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy schedules_employee_released on public.schedules
  for select to authenticated
  using (released and public.employee_in_store(store_id));
create policy schedules_admin_all on public.schedules
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy shifts_employee_select on public.schedule_shifts
  for select to authenticated
  using (
    employee_id = public.current_employee_id()
    and public.employee_in_store(store_id)
    and (
      request_status = 'pending'
      or exists (
        select 1 from public.schedules s
        where s.id = schedule_shifts.schedule_id
          and s.released
      )
    )
  );
create policy shifts_employee_respond on public.schedule_shifts
  for update to authenticated
  using (
    employee_id = public.current_employee_id()
    and request_status = 'pending'
    and public.employee_in_store(store_id)
  )
  with check (
    employee_id = public.current_employee_id()
    and request_status in ('accepted', 'declined')
    and public.employee_in_store(store_id)
  );
create policy shifts_admin_all on public.schedule_shifts
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy absences_employee_select_own on public.absences
  for select to authenticated
  using (employee_id = public.current_employee_id());
create policy absences_employee_insert_own on public.absences
  for insert to authenticated
  with check (
    employee_id = public.current_employee_id()
    and requested_by = 'employee'
    and status = 'pending'
    and (store_id is null or public.employee_in_store(store_id))
  );
create policy absences_admin_all on public.absences
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy notifications_employee_select_own on public.notifications
  for select to authenticated
  using (
    target_role = 'employee'
    and target_employee_id = public.current_employee_id()
  );
create policy notifications_employee_mark_read on public.notifications
  for update to authenticated
  using (
    target_role = 'employee'
    and target_employee_id = public.current_employee_id()
  )
  with check (
    target_role = 'employee'
    and target_employee_id = public.current_employee_id()
  );
create policy notifications_admin_all on public.notifications
  to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.employees,
  public.employee_stores,
  public.availabilities,
  public.schedules,
  public.schedule_shifts,
  public.absences,
  public.notifications
to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant all on all tables in schema public to service_role;

commit;
