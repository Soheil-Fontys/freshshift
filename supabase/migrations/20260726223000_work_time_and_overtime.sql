begin;

-- This stores only the accounting decision. Planned and actual durations stay
-- on the existing shift records, so a later correction is always visible.
create table if not exists public.work_time_settlements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  week_key text not null check (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
  status text not null default 'open'
    check (status in ('open', 'paid', 'time_off', 'corrected')),
  note text check (note is null or char_length(note) <= 500),
  settled_at timestamptz,
  settled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, store_id, week_key)
);

create index if not exists work_time_settlements_week_store_idx
  on public.work_time_settlements (week_key, store_id);

alter table public.work_time_settlements enable row level security;

create policy "Admins manage work time settlements"
  on public.work_time_settlements
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.work_time_settlements from anon, authenticated;
grant select on table public.work_time_settlements to authenticated;

create or replace function public.save_work_time_entry(
  p_shift_id uuid,
  p_actual_start text default null,
  p_actual_end text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  shift_row public.schedule_shifts%rowtype;
  planned_start_minutes integer;
  planned_end_minutes integer;
  actual_start_minutes integer;
  actual_end_minutes integer;
  next_deviation jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may record work times';
  end if;
  if (p_actual_start is null) <> (p_actual_end is null) then
    raise exception 'Bitte Start und Ende zusammen angeben oder beide leeren';
  end if;
  if p_actual_start is not null and (
    p_actual_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_actual_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_actual_start = p_actual_end
  ) then
    raise exception 'Bitte gültige unterschiedliche Zeiten angeben';
  end if;

  select * into shift_row from public.schedule_shifts where id = p_shift_id for update;
  if shift_row.id is null then
    raise exception 'Schicht wurde nicht gefunden';
  end if;

  if p_actual_start is null then
    update public.schedule_shifts
    set actual_start = null, actual_end = null, deviation_json = null
    where id = p_shift_id;
    return;
  end if;

  planned_start_minutes := split_part(shift_row.start, ':', 1)::integer * 60 + split_part(shift_row.start, ':', 2)::integer;
  planned_end_minutes := split_part(shift_row."end", ':', 1)::integer * 60 + split_part(shift_row."end", ':', 2)::integer;
  actual_start_minutes := split_part(p_actual_start, ':', 1)::integer * 60 + split_part(p_actual_start, ':', 2)::integer;
  actual_end_minutes := split_part(p_actual_end, ':', 1)::integer * 60 + split_part(p_actual_end, ':', 2)::integer;
  if planned_end_minutes < planned_start_minutes then planned_end_minutes := planned_end_minutes + 1440; end if;
  if actual_end_minutes < actual_start_minutes then actual_end_minutes := actual_end_minutes + 1440; end if;

  next_deviation := jsonb_strip_nulls(jsonb_build_object(
    'lateMinutes', case when actual_start_minutes > planned_start_minutes then actual_start_minutes - planned_start_minutes end,
    'earlyMinutes', case when actual_end_minutes < planned_end_minutes then planned_end_minutes - actual_end_minutes end,
    'overtimeMinutes', case when actual_end_minutes > planned_end_minutes then actual_end_minutes - planned_end_minutes end
  ));

  update public.schedule_shifts
  set actual_start = p_actual_start,
      actual_end = p_actual_end,
      deviation_json = next_deviation
  where id = p_shift_id;
end;
$$;

revoke all on function public.save_work_time_entry(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_work_time_entry(uuid, text, text) to authenticated, service_role;

create or replace function public.save_work_time_settlement(
  p_employee_id uuid,
  p_week_key text,
  p_store_id text,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators may settle work time';
  end if;
  if p_week_key !~ '^[0-9]{4}-W[0-9]{2}$' or p_status not in ('open', 'paid', 'time_off', 'corrected') then
    raise exception 'Ungültiger Abrechnungsstatus';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'Die Notiz darf höchstens 500 Zeichen lang sein';
  end if;
  if not exists (
    select 1 from public.employee_stores
    where employee_id = p_employee_id and store_id = p_store_id
  ) then
    raise exception 'Mitarbeiter gehört nicht zu diesem Betrieb';
  end if;

  insert into public.work_time_settlements (employee_id, store_id, week_key, status, note, settled_at, settled_by)
  values (
    p_employee_id, p_store_id, p_week_key, p_status,
    nullif(btrim(coalesce(p_note, '')), ''),
    case when p_status = 'open' then null else now() end,
    case when p_status = 'open' then null else auth.uid() end
  )
  on conflict (employee_id, store_id, week_key) do update
  set status = excluded.status,
      note = excluded.note,
      settled_at = excluded.settled_at,
      settled_by = excluded.settled_by,
      updated_at = now();
end;
$$;

revoke all on function public.save_work_time_settlement(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_work_time_settlement(uuid, text, text, text, text) to authenticated, service_role;

commit;
