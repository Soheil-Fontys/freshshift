begin;

-- Remote migration version: 20260719214110.
create or replace function public.save_schedule(
  p_store_id text,
  p_week_key text,
  p_released boolean,
  p_released_at timestamptz,
  p_saved_at timestamptz,
  p_shifts jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_schedule_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may save schedules';
  end if;

  if jsonb_typeof(coalesce(p_shifts, '[]'::jsonb)) <> 'array' then
    raise exception 'p_shifts must be a JSON array';
  end if;

  insert into public.schedules (
    store_id,
    week_key,
    released,
    released_at,
    saved_at
  )
  values (
    p_store_id,
    p_week_key,
    coalesce(p_released, false),
    p_released_at,
    coalesce(p_saved_at, now())
  )
  on conflict (store_id, week_key) do update
  set released = excluded.released,
      released_at = excluded.released_at,
      saved_at = excluded.saved_at
  returning id into saved_schedule_id;

  delete from public.schedule_shifts
  where schedule_id = saved_schedule_id;

  insert into public.schedule_shifts (
    schedule_id,
    store_id,
    week_key,
    day_key,
    employee_id,
    start,
    "end",
    actual_start,
    actual_end,
    deviation_json,
    request_status,
    requested_at,
    responded_at,
    response_reason
  )
  select
    saved_schedule_id,
    p_store_id,
    p_week_key,
    shift.day_key,
    shift.employee_id,
    shift.start_time,
    shift.end_time,
    shift.actual_start,
    shift.actual_end,
    shift.deviation_json,
    coalesce(shift.request_status, 'none'),
    shift.requested_at,
    shift.responded_at,
    shift.response_reason
  from jsonb_to_recordset(coalesce(p_shifts, '[]'::jsonb)) as shift (
    day_key text,
    employee_id uuid,
    start_time text,
    end_time text,
    actual_start text,
    actual_end text,
    deviation_json jsonb,
    request_status text,
    requested_at timestamptz,
    responded_at timestamptz,
    response_reason text
  );

  return saved_schedule_id;
end;
$$;

revoke all on function public.save_schedule(
  text,
  text,
  boolean,
  timestamptz,
  timestamptz,
  jsonb
) from public, anon;

grant execute on function public.save_schedule(
  text,
  text,
  boolean,
  timestamptz,
  timestamptz,
  jsonb
) to authenticated, service_role;

commit;
