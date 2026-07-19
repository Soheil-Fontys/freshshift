begin;

-- Employees already saw these shift details while the request was pending.
-- Keep their own requested shift readable after they answer it so PostgreSQL
-- can validate the UPDATE and the UI can show the response until release.
drop policy if exists shifts_select on public.schedule_shifts;
create policy shifts_select on public.schedule_shifts
  for select to authenticated
  using (
    public.is_admin()
    or (
      employee_id = public.current_employee_id()
      and public.employee_in_store(store_id)
      and (
        request_status in ('pending', 'accepted', 'declined')
        or exists (
          select 1
          from public.schedules s
          where s.id = schedule_shifts.schedule_id
            and s.released
        )
      )
    )
  );

commit;
