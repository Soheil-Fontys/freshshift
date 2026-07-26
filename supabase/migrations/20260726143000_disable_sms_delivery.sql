begin;

-- Existing preview databases already received the earlier notification
-- migration. This migration makes their delivery path Web Push-only as well.
delete from public.notification_deliveries where channel <> 'push';

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_channel_check,
  add constraint notification_deliveries_channel_check check (channel = 'push');

create or replace function private.enqueue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.target_role = 'employee' then
    insert into public.notification_deliveries (
      notification_id, recipient_profile_id, recipient_employee_id, channel
    )
    select new.id, e.profile_id, e.id, 'push'
    from public.employees e
    where e.id = new.target_employee_id and e.active and e.profile_id is not null
    on conflict do nothing;
  else
    insert into public.notification_deliveries (
      notification_id, recipient_profile_id, recipient_employee_id, channel
    )
    select new.id, p.id, e.id, 'push'
    from public.profiles p
    left join public.employees e on e.profile_id = p.id and e.active
    where p.role = 'admin'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop function if exists public.claim_notification_deliveries(integer, text);
create function public.claim_notification_deliveries(
  p_limit integer default 50,
  p_channel text default null
)
returns table (
  delivery_id uuid,
  channel text,
  recipient_profile_id uuid,
  recipient_employee_id uuid,
  notification_type text,
  title text,
  message text,
  target_url text,
  push_subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel is not null and p_channel <> 'push' then
    raise exception 'Invalid notification channel';
  end if;
  return query
  with claimed as (
    select nd.id
    from public.notification_deliveries nd
    where nd.status in ('pending', 'failed')
      and nd.attempts < 3
      and nd.channel = 'push'
      and (p_channel is null or p_channel = 'push')
    order by nd.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  ), updated as (
    update public.notification_deliveries nd
    set status = 'sending', attempts = attempts + 1, last_attempt_at = now(), error = null
    from claimed where nd.id = claimed.id
    returning nd.*
  )
  select
    u.id,
    u.channel,
    u.recipient_profile_id,
    u.recipient_employee_id,
    n.type,
    'FreshShift'::text,
    coalesce(n.payload ->> 'message', 'Neue FreshShift-Mitteilung'),
    coalesce(n.payload ->> 'url', '/')::text,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth
      )) from public.push_subscriptions ps
      where ps.profile_id = u.recipient_profile_id and ps.enabled
    ), '[]'::jsonb)
  from updated u
  join public.notifications n on n.id = u.notification_id;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer, text)
  to service_role;

create or replace function public.get_notification_service_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(ds.name, ds.decrypted_secret), '{}'::jsonb)
  from vault.decrypted_secrets ds
  where ds.name in ('freshshift_vapid_public_key', 'freshshift_vapid_private_key')
$$;

revoke all on function public.get_notification_service_config()
  from public, anon, authenticated;
grant execute on function public.get_notification_service_config() to service_role;

commit;
