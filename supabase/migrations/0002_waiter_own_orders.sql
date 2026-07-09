-- Lets a waiter see the status of orders they personally placed (not anyone else's),
-- so the ordering screen can show a "your recent orders" summary after submitting.
-- Waiters still cannot update orders — this is read-only visibility into their own rows.
drop policy orders_select on public.orders;
create policy orders_select on public.orders for select
  using (
    public.current_role() in ('manager','sales')
    or (public.current_role() = 'kitchen' and line = 'restaurant')
    or (public.current_role() = 'barista' and line = 'coffeeshop')
    or (public.current_role() = 'waiter' and placed_by = auth.uid())
  );
