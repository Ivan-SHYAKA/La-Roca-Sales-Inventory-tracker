-- Must-acknowledge notifications, delivered live via realtime and re-shown on next login
-- if missed. Scoped to what actually needs an interruption: stock shortages (which used to
-- reject the order outright -- now the order goes through and this notifies manager, the
-- responsible department, and the storekeeper instead), low stock, and new orders reaching
-- kitchen/barista. Routine status changes stay as the existing toast notifications.
--
-- Broadcast to a role (not a specific user) because multiple staff can share a role at once
-- (two waiters, two kitchen staff) and each needs to acknowledge independently -- hence the
-- separate per-user acks table rather than a single acknowledged_at column on the row itself.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('stock_shortage','low_stock','new_order')),
  title text not null,
  message text not null,
  severity text not null default 'medium' check (severity in ('medium','high')),
  target_role text not null check (target_role in ('manager','kitchen','barista','storekeeper','waiter','sales')),
  order_id uuid references public.orders(id) on delete set null,
  inventory_id uuid references public.inventory(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;

-- No insert/update/delete policy for clients: every row is written by a SECURITY DEFINER
-- trigger below, which bypasses RLS on its own -- nothing else should be writing here.
create policy notifications_select on public.notifications for select
  using (target_role = public.current_role());

create table public.notification_acks (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
alter table public.notification_acks enable row level security;

create policy notification_acks_select on public.notification_acks for select
  using (user_id = auth.uid() or public.current_role() = 'manager');
create policy notification_acks_insert on public.notification_acks for insert
  with check (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end $$;

-- One notification per order row (i.e. per department, not per item) so a table's order
-- with many items still produces exactly one popup for whoever has to act on it.
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dept text;
begin
  dept := case new.line when 'restaurant' then 'kitchen' when 'coffeeshop' then 'barista' else null end;
  if dept is not null then
    -- Message intentionally doesn't include the table/section label -- the client
    -- renders that via orderLabel() (which knows the floor-section lookup) using order_id.
    insert into public.notifications (type, title, message, severity, target_role, order_id)
    values ('new_order', 'New order', 'A new order has come in.', 'medium', dept, new.id);
  end if;
  return new;
end;
$$;

create trigger trg_notify_new_order
after insert on public.orders
for each row execute function public.notify_new_order();

-- Replaces the old blocking trigger: stock shortages no longer reject the order, they
-- notify manager + the responsible department + storekeeper instead. Statement-level (not
-- row-level) so a cart with several short ingredients across several dishes still produces
-- one bundled notification per line, not one per item.
drop trigger if exists trg_block_order_item_if_short on public.order_items;
drop function if exists public.block_order_item_if_short();

create or replace function public.notify_order_item_if_short()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shortage record;
  lines text[] := '{}';
  ord record;
  dept text;
begin
  for shortage in
    select inv.name as inv_name, inv.unit, sum(ri.qty_per_unit * ni.qty) as needed, inv.quantity as available
    from new_table ni
    join public.recipe_ingredients ri on ri.menu_item_id = ni.menu_item_id
    join public.inventory inv on inv.id = ri.inventory_id
    where ni.menu_item_id is not null
    group by inv.id, inv.name, inv.unit, inv.quantity
    having inv.quantity < sum(ri.qty_per_unit * ni.qty)
  loop
    lines := array_append(lines, shortage.inv_name || ' (need ' || shortage.needed || ' ' || shortage.unit || ', have ' || shortage.available || ' ' || shortage.unit || ')');
  end loop;

  if array_length(lines, 1) is null then
    return null;
  end if;

  select o.id, o.line, o.table_number, o.client_name into ord
  from public.orders o
  where o.id = (select order_id from new_table limit 1);

  dept := case ord.line when 'restaurant' then 'kitchen' when 'coffeeshop' then 'barista' else null end;

  -- Message intentionally doesn't include the table/section label -- the client renders
  -- that via orderLabel() (which knows the floor-section lookup) using order_id.
  insert into public.notifications (type, title, message, severity, target_role, order_id)
  select 'stock_shortage', 'Stock shortage', 'Short on: ' || array_to_string(lines, '; ') || '.', 'high', role, ord.id
  from unnest(array_remove(array['manager', dept, 'storekeeper'], null)) as role;

  return null;
end;
$$;

create trigger trg_notify_order_item_if_short
after insert on public.order_items
referencing new table as new_table
for each statement execute function public.notify_order_item_if_short();

-- Low-stock alerts (already fired on manual stock-out, migration 0014) now also raise a
-- must-acknowledge notification to storekeeper + manager, alongside the existing
-- resolve-later stock_alerts banner entry.
create or replace function public.apply_stock_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  if new.type = 'in' then
    update public.inventory set quantity = quantity + new.quantity where id = new.inventory_id;
  else
    update public.inventory set quantity = greatest(0, quantity - new.quantity)
      where id = new.inventory_id
      returning * into inv;
    if inv.quantity <= inv.reorder_level then
      insert into public.stock_alerts (inventory_id, order_id, message, severity)
      values (inv.id, new.order_id, inv.name || ' is below reorder level (' || inv.quantity || ' ' || inv.unit || ' left).', 'low_stock');
      insert into public.notifications (type, title, message, severity, target_role, inventory_id, order_id)
      select 'low_stock', 'Low stock', inv.name || ' is below reorder level (' || inv.quantity || ' ' || inv.unit || ' left).', 'high', role, inv.id, new.order_id
      from unnest(array['storekeeper','manager']) as role;
    end if;
  end if;
  return new;
end;
$$;
