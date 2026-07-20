begin;

create index if not exists activity_log_actor_profile_idx
  on public.activity_log (actor_profile_id);
create index if not exists absences_au_verified_by_idx
  on public.absences (au_verified_by)
  where au_verified_by is not null;

drop policy if exists activity_log_admin_insert on public.activity_log;
create policy activity_log_admin_insert on public.activity_log
  for insert to authenticated
  with check (
    public.is_admin()
    and actor_profile_id = (select auth.uid())
    and actor_name = (
      select coalesce(nullif(p.display_name, ''), nullif(p.email, ''), 'Benutzer')
      from public.profiles p
      where p.id = (select auth.uid())
    )
  );

grant insert on table public.activity_log to authenticated;
grant usage, select on sequence public.activity_log_id_seq to authenticated;

-- The private schema is not exposed by the Data API. Granting only USAGE and
-- this one function lets invoker RPCs record authenticated activity while the
-- activity table's RLS policy verifies the actor identity.
grant usage on schema private to authenticated;
alter function private.record_activity(text, text, text, jsonb)
  security invoker;
grant execute on function private.record_activity(text, text, text, jsonb)
  to authenticated;

alter function public.save_schedule_versioned(text, text, timestamptz, jsonb, bigint)
  security invoker;
alter function public.release_schedule_versioned(text, text, bigint)
  security invoker;
alter function public.set_absence_au_status(uuid, text)
  security invoker;

commit;
