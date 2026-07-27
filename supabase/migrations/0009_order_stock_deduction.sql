-- Order -> inventory auto-deduction + low-stock/blocked-order alerts.
--
-- This reworks a spec someone drafted externally (inventory-auto-deduction-spec.md).
-- Several things in that draft didn't hold up against this project's actual schema and
-- were fixed here rather than copied as-is:
--   - It claimed recipe_ingredients had no RLS policies yet. It already does (0001);
--     no new policies added for that table here.
--   - Its check_order_item_availability() and block_order_item_if_short() weren't
--     `security definer`. Both need to read `inventory`, but inventory_select only
--     allows manager/storekeeper — for a waiter or sales caller (who place nearly all
--     real orders), the join would've silently returned zero rows under RLS, so
--     insufficient stock would never be detected for the roles that actually place
--     orders. Matches this app's existing current_role()/storekeeper_order_items()
--     pattern instead.
--   - Its deduction trigger read inventory.quantity then blindly wrote a computed
--     absolute value back — a classic lost-update race under concurrent orders for the
--     same ingredient. Fixed below by not writing to inventory.quantity directly at
--     all: this app's stock_events table already has its own AFTER INSERT trigger
--     (apply_stock_event, from 0001/0008) that applies the delta and does its own
--     locked, checked update. Discovered by actually testing this migration locally —
--     the first draft here also wrote inventory.quantity directly *and* inserted the
--     stock_events row, which silently double-deducted every order (confirmed via a
--     live test: a single order dropped a test item by 6 units instead of 3).
--   - Its blocking trigger read inventory.quantity without locking the row, so two
--     concurrent orders could both read the same pre-decrement quantity and both pass —
--     exactly the race the spec's own testing checklist asks to verify is blocked.
--     Added `for update` so the second concurrent insert waits for the first to commit
--     and re-reads the post-deduction quantity.
--   - Two-step order placement (insert orders, then insert order_items) means a
--     mid-batch trigger failure leaves a real, itemless "placed" order behind — the
--     trigger firing rejects the order_items insert but the orders row already
--     committed as a separate request. Added delete_empty_order() as a targeted
--     cleanup the client calls in that case, rather than rewriting the whole
--     order-placement path into one RPC (bigger, riskier change for a rare path that
--     the client-side availability pre-check already avoids in the common case).

-- ---------- STOCK ALERTS ----------
create table public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid references public.inventory(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  message text not null,
  severity text not null check (severity in ('low_stock','blocked_order')),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.stock_alerts enable row level security;

create policy stock_alerts_select on public.stock_alerts for select
  using (public.current_role() in ('kitchen','storekeeper','manager'));
create policy stock_alerts_insert on public.stock_alerts for insert
  with check (auth.uid() is not null);
create policy stock_alerts_update on public.stock_alerts for update
  using (public.current_role() in ('storekeeper','manager'));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_alerts'
  ) then
    execute 'alter publication supabase_realtime add table public.stock_alerts';
  end if;
end $$;

-- ---------- READ-ONLY AVAILABILITY CHECK (app calls before placing an order) ----------
create or replace function public.check_order_item_availability(
  p_menu_item_id uuid,
  p_qty numeric
)
returns table (
  inventory_id uuid,
  name text,
  unit text,
  needed numeric,
  available numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select inv.id, inv.name, inv.unit,
         ri.qty_per_unit * p_qty as needed,
         inv.quantity as available
  from public.recipe_ingredients ri
  join public.inventory inv on inv.id = ri.inventory_id
  where ri.menu_item_id = p_menu_item_id
  and inv.quantity < ri.qty_per_unit * p_qty;
$$;
grant execute on function public.check_order_item_availability(uuid, numeric) to authenticated;

-- ---------- BLOCKING TRIGGER (DB-level safety net for races) ----------
create or replace function public.block_order_item_if_short()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ing record;
  needed numeric;
begin
  if new.menu_item_id is null then
    return new;
  end if;

  -- Locks every recipe-linked inventory row for this dish before checking anything —
  -- locking only rows that already *look* short (as the original draft did) doesn't
  -- prevent the race: two concurrent orders could both read "not short yet" before
  -- either commits. Locking unconditionally, in a fixed order (by id, to avoid
  -- deadlocking against a concurrent order for a dish sharing the same ingredients in
  -- different order), makes the second concurrent insert wait for the first
  -- transaction's deduction to actually land before it evaluates availability.
  for ing in
    select inv.id, inv.name, inv.unit, inv.quantity, ri.qty_per_unit
    from public.recipe_ingredients ri
    join public.inventory inv on inv.id = ri.inventory_id
    where ri.menu_item_id = new.menu_item_id
    order by inv.id
    for update of inv
  loop
    needed := ing.qty_per_unit * new.qty;
    if ing.quantity < needed then
      raise exception 'Insufficient stock: % (need %, have %)', ing.name, needed, ing.quantity;
    end if;
  end loop;

  return new;
end;
$$;

create trigger trg_block_order_item_if_short
before insert on public.order_items
for each row execute function public.block_order_item_if_short();

-- ---------- DEDUCTION + LOW-STOCK ALERT (runs only when the insert wasn't blocked) ----------
create or replace function public.deduct_inventory_on_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ing record;
  new_qty numeric;
  used numeric;
begin
  if new.menu_item_id is null then
    return new;
  end if;

  for ing in
    select ri.inventory_id, ri.qty_per_unit, inv.name, inv.quantity, inv.reorder_level, inv.unit
    from public.recipe_ingredients ri
    join public.inventory inv on inv.id = ri.inventory_id
    where ri.menu_item_id = new.menu_item_id
  loop
    used := ing.qty_per_unit * new.qty;
    -- Computed only to evaluate the reorder-level check below, never written back here —
    -- the stock_events insert's own trigger is what actually applies it to inventory.
    -- Safe to trust ing.quantity as current/consistent: this transaction already holds
    -- the row lock taken by block_order_item_if_short (BEFORE INSERT, same transaction),
    -- so nothing else could have changed it since.
    new_qty := ing.quantity - used;

    insert into public.stock_events
      (inventory_id, type, reason, quantity, order_id, note)
    values
      (ing.inventory_id, 'out', 'usage', used, new.order_id,
       'Auto-deducted for order item ' || new.id);

    if new_qty <= ing.reorder_level then
      insert into public.stock_alerts
        (inventory_id, order_id, menu_item_id, message, severity)
      values
        (ing.inventory_id, new.order_id, new.menu_item_id,
         ing.name || ' is below reorder level (' || new_qty || ' ' || ing.unit || ' left).',
         'low_stock');
    end if;
  end loop;

  return new;
end;
$$;

create trigger trg_deduct_inventory_on_order_item
after insert on public.order_items
for each row execute function public.deduct_inventory_on_order_item();

-- ---------- ORPHAN CLEANUP (client calls this if the order_items insert above got blocked) ----------
create or replace function public.delete_empty_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.orders
  where id = p_order_id
    and placed_by = auth.uid()
    and not exists (select 1 from public.order_items where order_id = p_order_id);
end;
$$;
grant execute on function public.delete_empty_order(uuid) to authenticated;
