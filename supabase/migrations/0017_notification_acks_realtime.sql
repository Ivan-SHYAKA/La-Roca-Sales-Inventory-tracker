-- 0016 added `notifications` to the realtime publication but missed `notification_acks` --
-- without it, one user acknowledging a shared-role notification never live-updates any
-- other open session watching the same data (they'd only see it clear on next reload).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_acks'
  ) then
    execute 'alter publication supabase_realtime add table public.notification_acks';
  end if;
end $$;
