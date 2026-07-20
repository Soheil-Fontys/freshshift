begin;

-- These RPCs validate public.is_admin() before any write and use an empty
-- search_path. SECURITY DEFINER lets them call the private activity helper
-- without exposing the private schema to browser roles.
alter function public.save_schedule_versioned(text, text, timestamptz, jsonb, bigint)
  security definer;
alter function public.release_schedule_versioned(text, text, bigint)
  security definer;
alter function public.set_absence_au_status(uuid, text)
  security definer;

commit;
