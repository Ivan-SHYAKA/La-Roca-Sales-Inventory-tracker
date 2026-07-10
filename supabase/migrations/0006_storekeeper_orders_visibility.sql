-- Storekeeper needs to see orders (all lines, not just one department) to compute
-- recipe-driven ingredient needs and the day's expected usage. Without this, storekeeper
-- had no SELECT policy on orders at all, so fetchOrders() silently returned nothing for
-- that role and the "ingredients needed" alert / daily stock report's system estimate
-- were always empty. Read-only, same breadth as manager/sales.
drop policy orders_select on public.orders;
create policy orders_select on public.orders for select
  using (
    public.current_role() in ('manager','sales','storekeeper')
    or (public.current_role() = 'kitchen' and line = 'restaurant')
    or (public.current_role() = 'barista' and line = 'coffeeshop')
    or (public.current_role() = 'waiter' and placed_by = auth.uid())
  );
