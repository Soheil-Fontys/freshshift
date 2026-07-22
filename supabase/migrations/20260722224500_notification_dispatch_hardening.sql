begin;

-- Only an authenticated admin-triggered dispatcher may claim the paid SMS
-- channel. Employee calls are restricted to free Web Push jobs by the Edge
-- Function and this server-side channel filter.
drop function if exists public.claim_notification_deliveries(integer);
create or replace function public.claim_notification_deliveries(
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
  phone_e164 text,
  push_subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel is not null and p_channel not in ('push', 'sms') then
    raise exception 'Invalid notification channel';
  end if;
  return query
  with claimed as (
    select nd.id
    from public.notification_deliveries nd
    where nd.status in ('pending', 'failed') and nd.attempts < 3
      and (p_channel is null or nd.channel = p_channel)
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
    e.phone_e164,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth
      )) from public.push_subscriptions ps
      where ps.profile_id = u.recipient_profile_id and ps.enabled
    ), '[]'::jsonb)
  from updated u
  join public.notifications n on n.id = u.notification_id
  left join public.employees e on e.id = u.recipient_employee_id;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer, text)
  to service_role;

commit;
