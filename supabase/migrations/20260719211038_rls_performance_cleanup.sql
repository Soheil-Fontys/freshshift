begin;

-- Remote migration version: 20260719211038.
create index if not exists absences_store_id_idx
  on public.absences (store_id);
create index if not exists availabilities_employee_week_idx
  on public.availabilities (employee_id, week_key);
create index if not exists employee_stores_store_id_idx
  on public.employee_stores (store_id);
create index if not exists notifications_store_id_idx
  on public.notifications (store_id);
create index if not exists schedule_shifts_store_id_idx
  on public.schedule_shifts (store_id);

create or replace function private.guard_notification_employee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  if old.target_employee_id <> public.current_employee_id()
     or new.store_id is distinct from old.store_id
     or new.target_role is distinct from old.target_role
     or new.target_employee_id is distinct from old.target_employee_id
     or new.type is distinct from old.type
     or new.payload is distinct from old.payload
     or new.created_at is distinct from old.created_at then
    raise exception 'Employees may only mark their own notifications as read';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_notification_employee_update()
  from public, anon, authenticated;
grant execute on function private.guard_notification_employee_update()
  to service_role;

create trigger notifications_guard_employee_update
  before update on public.notifications
  for each row execute function private.guard_notification_employee_update();

drop policy if exists stores_select_authenticated on public.stores;
drop policy if exists stores_admin_all on public.stores;
create policy stores_select_authenticated on public.stores
  for select to authenticated using (true);
create policy stores_admin_insert on public.stores
  for insert to authenticated with check (public.is_admin());
create policy stores_admin_update on public.stores
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy stores_admin_delete on public.stores
  for delete to authenticated using (public.is_admin());

drop policy if exists employees_select_own on public.employees;
drop policy if exists employees_admin_all on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_admin());
create policy employees_admin_insert on public.employees
  for insert to authenticated with check (public.is_admin());
create policy employees_admin_update on public.employees
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy employees_admin_delete on public.employees
  for delete to authenticated using (public.is_admin());

drop policy if exists employee_stores_select_own on public.employee_stores;
drop policy if exists employee_stores_admin_all on public.employee_stores;
create policy employee_stores_select on public.employee_stores
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_admin());
create policy employee_stores_admin_insert on public.employee_stores
  for insert to authenticated with check (public.is_admin());
create policy employee_stores_admin_update on public.employee_stores
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy employee_stores_admin_delete on public.employee_stores
  for delete to authenticated using (public.is_admin());

drop policy if exists availabilities_employee_own on public.availabilities;
drop policy if exists availabilities_admin_all on public.availabilities;
create policy availabilities_select on public.availabilities
  for select to authenticated
  using (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
    )
  );
create policy availabilities_insert on public.availabilities
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
    )
  );
create policy availabilities_update on public.availabilities
  for update to authenticated
  using (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
    )
  )
  with check (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
    )
  );
create policy availabilities_delete on public.availabilities
  for delete to authenticated
  using (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
    )
  );

drop policy if exists schedules_employee_released on public.schedules;
drop policy if exists schedules_admin_all on public.schedules;
create policy schedules_select on public.schedules
  for select to authenticated
  using (
    public.is_admin()
    or (released and public.employee_in_store(store_id))
  );
create policy schedules_admin_insert on public.schedules
  for insert to authenticated with check (public.is_admin());
create policy schedules_admin_update on public.schedules
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy schedules_admin_delete on public.schedules
  for delete to authenticated using (public.is_admin());

drop policy if exists shifts_employee_select on public.schedule_shifts;
drop policy if exists shifts_employee_respond on public.schedule_shifts;
drop policy if exists shifts_admin_all on public.schedule_shifts;
create policy shifts_select on public.schedule_shifts
  for select to authenticated
  using (
    public.is_admin()
    or (
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
    )
  );
create policy shifts_insert on public.schedule_shifts
  for insert to authenticated with check (public.is_admin());
create policy shifts_update on public.schedule_shifts
  for update to authenticated
  using (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and request_status = 'pending'
      and public.employee_in_store(store_id)
    )
  )
  with check (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and request_status in ('accepted', 'declined')
      and public.employee_in_store(store_id)
    )
  );
create policy shifts_delete on public.schedule_shifts
  for delete to authenticated using (public.is_admin());

drop policy if exists absences_employee_select_own on public.absences;
drop policy if exists absences_employee_insert_own on public.absences;
drop policy if exists absences_admin_all on public.absences;
create policy absences_select on public.absences
  for select to authenticated
  using (employee_id = public.current_employee_id() or public.is_admin());
create policy absences_insert on public.absences
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and requested_by = 'employee'
      and status = 'pending'
      and (store_id is null or public.employee_in_store(store_id))
    )
  );
create policy absences_admin_update on public.absences
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy absences_admin_delete on public.absences
  for delete to authenticated using (public.is_admin());

drop policy if exists notifications_employee_select_own on public.notifications;
drop policy if exists notifications_employee_mark_read on public.notifications;
drop policy if exists notifications_admin_all on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    public.is_admin()
    or (
      target_role = 'employee'
      and target_employee_id = public.current_employee_id()
    )
  );
create policy notifications_admin_insert on public.notifications
  for insert to authenticated with check (public.is_admin());
create policy notifications_update on public.notifications
  for update to authenticated
  using (
    public.is_admin()
    or (
      target_role = 'employee'
      and target_employee_id = public.current_employee_id()
    )
  )
  with check (
    public.is_admin()
    or (
      target_role = 'employee'
      and target_employee_id = public.current_employee_id()
    )
  );
create policy notifications_admin_delete on public.notifications
  for delete to authenticated using (public.is_admin());

commit;
