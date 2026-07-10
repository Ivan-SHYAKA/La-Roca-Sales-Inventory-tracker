-- Supersedes 0006: that migration gave storekeeper the same full-column, full-row
-- access to orders as manager/sales, which turned out to be broader than needed —
-- storekeeper only needs enough to track ingredient usage against orders, not guest
-- names, phone numbers, payment details, cancellation reasons, or check-in details.
--
-- Row-level security only controls which ROWS a role can see, not which COLUMNS, so
-- "give storekeeper a narrower orders policy" can't express column-level limits. The
-- fix is a SECURITY DEFINER function (same pattern as current_role()/profiles_count()
-- below) that runs with the migration owner's privileges — bypassing orders' RLS
-- entirely — and only ever returns the specific columns listed in its SELECT, with an
-- explicit role check standing in for what a row policy would normally do.

-- Revert the storekeeper clause 0006 added — narrow orders back down to the pre-0006 set.
drop policy orders_select on public.orders;
create policy orders_select on public.orders for select
  using (
    public.current_role() in ('manager','sales')
    or (public.current_role() = 'kitchen' and line = 'restaurant')
    or (public.current_role() = 'barista' and line = 'coffeeshop')
    or (public.current_role() = 'waiter' and placed_by = auth.uid())
  );

-- Exposes exactly: order id, table/room number, line, status, served-at (needed to
-- scope "today's" usage), menu item id + name, and quantity ordered. Nothing else —
-- no client_name, phone, payment_method, amount_paid, cancel_reason, or guest_details.
create or replace function public.storekeeper_order_items()
returns table (
  order_id uuid,
  table_number text,
  line text,
  status text,
  served_at timestamptz,
  menu_item_id uuid,
  item_name text,
  qty numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select o.id, o.table_number, o.line, o.status, o.served_at, oi.menu_item_id, oi.name, oi.qty
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where public.current_role() = 'storekeeper';
$$;
grant execute on function public.storekeeper_order_items() to authenticated;
