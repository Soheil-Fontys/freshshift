begin;

-- Explicit browser-deny policies document that these two tables are consumed
-- exclusively through service-role functions.
drop policy if exists released_shift_snapshots_browser_deny on public.released_shift_snapshots;
create policy released_shift_snapshots_browser_deny on public.released_shift_snapshots
  for select to authenticated using (false);
drop policy if exists notification_deliveries_browser_deny on public.notification_deliveries;
create policy notification_deliveries_browser_deny on public.notification_deliveries
  for select to authenticated using (false);

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

commit;
