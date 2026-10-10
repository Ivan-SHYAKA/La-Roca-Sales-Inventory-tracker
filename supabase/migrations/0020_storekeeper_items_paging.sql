-- storekeeper_order_items() returns one row per ordered item and the database caps any
-- response at 1000 rows, so past 1000 items the storekeeper's screens would silently work
-- from an arbitrary slice. To read it in pages reliably the rows need a fixed order and a
-- unique key (item_id) to break ties. Same columns as 0015 plus item_id; return shape
-- changed, so the function is dropped and recreated.
drop function if exists public.storekeeper_order_items();

create function public.storekeeper_order_items()
returns table (
  order_id uuid,
  table_number text,
  line text,
  status text,
  served_at timestamptz,
  placed_at timestamptz,
  placed_by_name text,
  group_id uuid,
  menu_item_id uuid,
  item_name text,
  qty numeric,
  item_id uuid
)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.table_number, o.line, o.status, o.served_at, o.placed_at, o.placed_by_name, o.group_id,
         oi.menu_item_id, oi.name, oi.qty, oi.id
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where public.current_role() = 'storekeeper'
  order by o.placed_at desc, oi.id;
$$;
grant execute on function public.storekeeper_order_items() to authenticated;
