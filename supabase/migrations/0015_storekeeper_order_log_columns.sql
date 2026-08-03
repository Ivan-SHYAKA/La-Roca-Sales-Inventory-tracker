-- The storekeeper's persistent by-date order/ingredient log (business.js's
-- ordersForStorekeeperLog) needs placed_at (to scope "this day"), group_id (to show a
-- mixed restaurant+coffee-shop cart as the single order the waiter placed), and
-- placed_by_name (who placed it, as requested) -- none of which storekeeper_order_items()
-- exposed before now. These are staff-facing fields already stored plainly on orders
-- (placed_by_name is set at insert time, not a join to anything sensitive), unlike the
-- guest_details/phone/payment fields 0007 deliberately keeps out of this function.
-- Return shape changed, so the function has to be dropped and recreated, not just replaced.
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
  qty numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.table_number, o.line, o.status, o.served_at, o.placed_at, o.placed_by_name, o.group_id, oi.menu_item_id, oi.name, oi.qty
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where public.current_role() = 'storekeeper';
$$;
grant execute on function public.storekeeper_order_items() to authenticated;
