-- The handover RPC intentionally runs as the employee. Keep that model, but
-- allow an insert only when it exactly matches the caller's own released shift.
-- This preserves RLS for every other direct table write.
drop policy if exists shift_swap_requests_employee_insert on public.shift_swap_requests;
create policy shift_swap_requests_employee_insert on public.shift_swap_requests
  for insert to authenticated
  with check (
    requested_by_employee_id = public.current_employee_id()
    and status = 'open'
    and claimed_by_employee_id is null
    and claimed_at is null
    and reviewed_at is null
    and reviewed_by is null
    and admin_note is null
    and exists (
      select 1
      from public.schedule_shifts ss
      join public.schedules s on s.id = ss.schedule_id and s.released
      where ss.id = shift_swap_requests.shift_id
        and ss.employee_id = public.current_employee_id()
        and ss.store_id = shift_swap_requests.store_id
        and ss.week_key = shift_swap_requests.week_key
        and ss.day_key = shift_swap_requests.day_key
        and ss.request_status in ('none', 'accepted')
        and private.shift_date(ss.week_key, ss.day_key) >= current_date
    )
  );
