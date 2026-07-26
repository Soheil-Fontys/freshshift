begin;

-- The initial table grants included a table-wide UPDATE privilege. RLS limited
-- it to the caller's own row, but did not limit which columns could be changed.
-- Keep self-service display-name edits while preventing role escalation.
revoke insert, update, delete, truncate, references, trigger
  on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Foreign-key indexes keep review and shift deletion/update operations fast.
create index if not exists shift_change_requests_reviewed_by_idx
  on public.shift_change_requests (reviewed_by)
  where reviewed_by is not null;
create index if not exists shift_change_requests_shift_id_idx
  on public.shift_change_requests (shift_id)
  where shift_id is not null;

-- Reject impossible 24:00-29:59 values even if the RPC is bypassed by a
-- service-role caller. Overnight shifts remain valid.
alter table public.shift_change_requests
  add constraint shift_change_requests_original_start_strict_check
    check (original_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint shift_change_requests_original_end_strict_check
    check (original_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint shift_change_requests_requested_start_strict_check
    check (requested_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint shift_change_requests_requested_end_strict_check
    check (requested_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint shift_change_requests_reason_length_check
    check (reason is null or char_length(reason) <= 1000),
  add constraint shift_change_requests_admin_note_length_check
    check (admin_note is null or char_length(admin_note) <= 1000);

create or replace function public.create_shift_change_request(
  p_shift_id uuid,
  p_requested_start text,
  p_requested_end text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  shift_row public.schedule_shifts%rowtype;
  schedule_released boolean;
  request_id uuid;
begin
  actor_employee_id := public.current_employee_id();
  if actor_employee_id is null then
    raise exception 'Aktiver Mitarbeiterzugang erforderlich';
  end if;
  if p_requested_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_requested_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_requested_start = p_requested_end then
    raise exception 'Bitte gib gültige unterschiedliche Zeiten ein';
  end if;
  if char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'Der Grund darf höchstens 1000 Zeichen lang sein';
  end if;

  select ss.*
  into shift_row
  from public.schedule_shifts ss
  where ss.id = p_shift_id
  for update of ss;

  select s.released
  into schedule_released
  from public.schedules s
  where s.id = shift_row.schedule_id;

  if shift_row.id is null or not schedule_released then
    raise exception 'Diese Schicht ist nicht mehr veröffentlicht';
  end if;
  if shift_row.employee_id <> actor_employee_id then
    raise exception 'Du kannst nur für deine eigene Schicht eine Änderung anfragen';
  end if;
  if shift_row.request_status not in ('none', 'accepted') then
    raise exception 'Für diese Schicht ist aktuell keine Änderung möglich';
  end if;
  if shift_row.start = p_requested_start and shift_row."end" = p_requested_end then
    raise exception 'Die gewünschte Zeit entspricht bereits deiner Schicht';
  end if;

  insert into public.shift_change_requests (
    shift_id, schedule_id, store_id, week_key, day_key, employee_id,
    original_start, original_end, requested_start, requested_end, reason
  ) values (
    shift_row.id, shift_row.schedule_id, shift_row.store_id, shift_row.week_key,
    shift_row.day_key, actor_employee_id, shift_row.start, shift_row."end",
    p_requested_start, p_requested_end, nullif(btrim(coalesce(p_reason, '')), '')
  ) returning id into request_id;

  insert into public.notifications (store_id, target_role, type, payload)
  values (
    shift_row.store_id,
    'admin',
    'plan_change_requested',
    jsonb_build_object(
      'message', 'Neue Anfrage zur Planänderung',
      'requestId', request_id,
      'shiftId', shift_row.id,
      'weekKey', shift_row.week_key,
      'dayKey', shift_row.day_key,
      'url', '/#admin-dashboard'
    )
  );

  return request_id;
end;
$$;

revoke all on function public.create_shift_change_request(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_shift_change_request(uuid, text, text, text)
  to authenticated, service_role;

-- Keep a fresh clone consistent with the production crypto hotfix.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.rotate_my_calendar_subscription_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_employee_id uuid;
  raw_token text;
begin
  actor_employee_id := public.current_employee_id();
  if actor_employee_id is null or not exists (
    select 1 from public.employees where id = actor_employee_id and active
  ) then
    raise exception 'Aktiver Mitarbeiterzugang erforderlich';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.calendar_subscriptions (employee_id, token_hash, rotated_at)
  values (
    actor_employee_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    now()
  )
  on conflict (employee_id) do update
  set token_hash = excluded.token_hash, rotated_at = excluded.rotated_at;

  return raw_token;
end;
$$;

revoke all on function public.rotate_my_calendar_subscription_token()
  from public, anon, authenticated;
grant execute on function public.rotate_my_calendar_subscription_token()
  to authenticated, service_role;

commit;
