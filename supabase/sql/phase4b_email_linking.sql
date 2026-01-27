-- Phase 4B: email columns + auto-link employees to profiles
-- Run this in the Supabase SQL editor.

-- 1) Add email columns
alter table public.employees
  add column if not exists email text;

alter table public.profiles
  add column if not exists email text;

-- 2) Enforce unique employee emails (case-insensitive), but allow NULL
create unique index if not exists employees_email_unique
  on public.employees (lower(email))
  where email is not null;

-- 3) Backfill profiles.email from auth.users
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id
  and (p.email is null or p.email = '');

-- 4) Helper: link a profile to an employee row by matching email
create or replace function public.link_employee_by_email(p_profile_id uuid, p_profile_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_email is null or p_profile_email = '' then
    return;
  end if;

  update public.employees
  set profile_id = p_profile_id
  where public.employees.profile_id is null
    and public.employees.email is not null
    and lower(public.employees.email) = lower(p_profile_email);
end;
$$;

-- 5) Add a second trigger for email + employee auto-linking
-- This avoids overwriting an existing handle_new_user() trigger you may already have.
create or replace function public.handle_new_user_email_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;

  perform public.link_employee_by_email(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_link on auth.users;

create trigger on_auth_user_email_link
  after insert on auth.users
  for each row execute function public.handle_new_user_email_link();
