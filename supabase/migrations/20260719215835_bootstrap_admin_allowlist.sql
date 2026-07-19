begin;

-- Admin bootstrap addresses are operational secrets. Keep them in this private
-- table and insert them through a trusted administration channel, never in a
-- migration committed to source control.
create table private.admin_invites (
  email text primary key check (email = lower(trim(email))),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

revoke all on table private.admin_invites from public, anon, authenticated;
grant all on table private.admin_invites to service_role;

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

commit;
