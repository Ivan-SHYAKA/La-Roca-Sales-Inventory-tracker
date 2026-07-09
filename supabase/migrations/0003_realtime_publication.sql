-- Enables live updates (no page reload needed) for queues/dashboards. The app already
-- subscribes to postgres_changes on these tables via Supabase Realtime, but a table only
-- emits change events if it's added to the `supabase_realtime` publication — creating the
-- table alone doesn't do this. Without this, every screen only ever refreshes on its own
-- actions or a manual reload, which is why the kitchen/barista queues looked "stuck" until
-- the page was reloaded.
--
-- Written as a loop that adds each table only if it isn't already a publication member,
-- since `alter publication ... add table a, b, c` fails entirely if even one of them is
-- already present (Supabase sometimes pre-adds a few tables to this publication by default).
do $$
declare
  t text;
begin
  foreach t in array array['orders','order_items','menu_items','recipe_ingredients','inventory','stock_events','profiles']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
