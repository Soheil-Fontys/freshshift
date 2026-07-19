begin;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_role text := 'employee';
  admin_authorized boolean := false;
  employee_authorized boolean := false;
begin
  if new.email is null then
    raise exception 'FreshShift accounts require an invited email address';
  end if;

  select exists (
    select 1
    from private.admin_invites ai
    where ai.email = lower(trim(new.email))
  ) into admin_authorized;

  select exists (
    select 1
    from public.employees e
    where e.active
      and e.profile_id is null
      and e.email is not null
      and lower(e.email) = lower(trim(new.email))
  ) into employee_authorized;

  if not admin_authorized and not employee_authorized then
    raise exception 'FreshShift accounts are invitation-only';
  end if;

  if admin_authorized then
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
    and lower(email) = lower(new.email);

  if admin_authorized then
    update private.admin_invites
    set claimed_at = coalesce(claimed_at, now())
    where email = lower(trim(new.email));
  end if;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
grant execute on function private.handle_new_user() to supabase_auth_admin, service_role;

commit;
