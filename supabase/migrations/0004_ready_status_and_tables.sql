-- Adds a "ready" status between placed and served, so the kitchen/barista finishing
-- prep is a distinct event from the waiter actually delivering it to the guest. Also
-- adds a table/room number identifier so staff don't have to ask for (and type) a
-- client name on every walk-in order — client name becomes optional.

alter table public.orders add column if not exists table_number text;
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists ready_by uuid references public.profiles(id);
alter table public.orders add column if not exists ready_by_name text;

alter table public.orders alter column client_name drop not null;
alter table public.orders drop constraint if exists orders_identifier_present;
alter table public.orders add constraint orders_identifier_present check (client_name is not null or table_number is not null);

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('placed','ready','served','billed','cancelled'));

-- Waiters can move their own orders from ready -> served (the "I actually delivered this
-- to the table" acknowledgement). This is a separate permissive policy alongside the
-- existing orders_update policy (manager/sales/kitchen/barista) — Postgres OR's multiple
-- permissive USING clauses together, and OR's multiple WITH CHECK clauses together, so
-- this only adds capability for waiters without touching the other roles' rules.
drop policy if exists orders_update_waiter on public.orders;
create policy orders_update_waiter on public.orders for update
  using (public.current_role() = 'waiter' and placed_by = auth.uid() and status = 'ready')
  with check (public.current_role() = 'waiter' and placed_by = auth.uid() and status = 'served');
