-- La Roca Operations System — initial schema, ledger trigger, and RLS policies
-- Run this once in the Supabase SQL Editor (or via `supabase db push`) against a fresh project.

create extension if not exists pgcrypto;

-- Base table-level privileges. RLS policies below are what actually restrict
-- anon/authenticated row access; without these grants Postgres denies access
-- before RLS is even consulted (service_role needs this too — bypassing RLS
-- doesn't imply table-level privileges are already granted).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------- TABLES ----------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null check (role in ('manager','waiter','sales','kitchen','barista','storekeeper')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  line text not null check (line in ('restaurant','coffeeshop','accommodations')),
  price numeric not null default 0,
  prep_minutes int not null default 5,
  created_at timestamptz not null default now()
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  line text not null check (line in ('restaurant','coffeeshop','accommodations')),
  unit text not null default 'unit',
  quantity numeric not null default 0,
  reorder_level numeric not null default 0,
  cost_per_unit numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  qty_per_unit numeric not null
);

create table public.stock_events (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete cascade,
  type text not null check (type in ('in','out')),
  reason text not null check (reason in ('restock','usage','waste','spoilage','other')),
  quantity numeric not null check (quantity > 0),
  date timestamptz not null default now(),
  user_id uuid references public.profiles(id),
  user_name text,
  note text
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  phone text,
  line text not null check (line in ('restaurant','coffeeshop','accommodations')),
  status text not null default 'placed' check (status in ('placed','served','billed','cancelled')),
  total numeric not null default 0,
  placed_at timestamptz not null default now(),
  placed_by uuid references public.profiles(id),
  placed_by_name text,
  served_at timestamptz,
  served_by uuid references public.profiles(id),
  served_by_name text,
  billed_at timestamptz,
  billed_by uuid references public.profiles(id),
  billed_by_name text,
  payment_method text,
  amount_paid numeric,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_by_name text,
  cancel_reason text,
  guest_details jsonb
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  name text not null,
  qty numeric not null default 1,
  unit_price numeric not null default 0,
  prep_minutes int not null default 0
);

create index idx_recipe_ingredients_menu_item on public.recipe_ingredients(menu_item_id);
create index idx_recipe_ingredients_inventory on public.recipe_ingredients(inventory_id);
create index idx_stock_events_inventory on public.stock_events(inventory_id, type, reason, date);
create index idx_orders_line_status on public.orders(line, status);
create index idx_order_items_order on public.order_items(order_id);

-- ---------- HELPER FUNCTIONS ----------

-- SECURITY DEFINER + owned by the migration role => bypasses RLS on profiles,
-- which avoids infinite recursion when policies below call this function.
-- Returns null (matching no policy) for deactivated accounts, so disabling a
-- user in the Users screen revokes DB access immediately, not just client-side.
create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

-- Lets the sign-up screen ask "does any account exist yet?" before the visitor is authenticated.
create or replace function public.profiles_count()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*) from public.profiles;
$$;
grant execute on function public.profiles_count() to anon, authenticated;

-- ---------- INVENTORY LEDGER TRIGGER ----------
-- stock_events is the source of truth; inventory.quantity is a derived running total.
-- SECURITY DEFINER so roles allowed to insert stock_events (storekeeper, sales for check-in
-- amenities, manager) don't also need direct UPDATE rights on inventory.
create or replace function public.apply_stock_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'in' then
    update public.inventory set quantity = quantity + new.quantity where id = new.inventory_id;
  else
    update public.inventory set quantity = greatest(0, quantity - new.quantity) where id = new.inventory_id;
  end if;
  return new;
end;
$$;

create trigger trg_apply_stock_event
after insert on public.stock_events
for each row execute function public.apply_stock_event();

-- ---------- ROW LEVEL SECURITY ----------
alter table public.profiles enable row level security;
alter table public.menu_items enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory enable row level security;
alter table public.stock_events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- profiles: everyone can read their own row (to load session/role); manager reads/updates all.
-- Inserts happen only via the admin-users edge function using the service role (bypasses RLS).
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.current_role() = 'manager');
create policy profiles_update_manager on public.profiles for update
  using (public.current_role() = 'manager')
  with check (public.current_role() = 'manager');

-- menu_items / recipe_ingredients: any signed-in staff can read (needed for order-taking,
-- check-in amenity defaults, recipe display); only manager edits.
create policy menu_items_select on public.menu_items for select using (auth.uid() is not null);
create policy menu_items_write_manager on public.menu_items for insert with check (public.current_role() = 'manager');
create policy menu_items_update_manager on public.menu_items for update using (public.current_role() = 'manager') with check (public.current_role() = 'manager');
create policy menu_items_delete_manager on public.menu_items for delete using (public.current_role() = 'manager');

create policy recipe_select on public.recipe_ingredients for select using (auth.uid() is not null);
create policy recipe_write_manager on public.recipe_ingredients for insert with check (public.current_role() = 'manager');
create policy recipe_update_manager on public.recipe_ingredients for update using (public.current_role() = 'manager') with check (public.current_role() = 'manager');
create policy recipe_delete_manager on public.recipe_ingredients for delete using (public.current_role() = 'manager');

-- inventory: manager + storekeeper only (waiter/kitchen/barista/sales have no inventory screens
-- and per spec shouldn't see cost fields — simplest correct enforcement is no row access at all).
create policy inventory_select on public.inventory for select
  using (public.current_role() in ('manager','storekeeper'));
create policy inventory_write on public.inventory for insert
  with check (public.current_role() in ('manager','storekeeper'));
create policy inventory_update on public.inventory for update
  using (public.current_role() in ('manager','storekeeper'))
  with check (public.current_role() in ('manager','storekeeper'));

-- stock_events: manager + storekeeper read/write; sales may insert only (check-in amenity usage).
create policy stock_events_select on public.stock_events for select
  using (public.current_role() in ('manager','storekeeper'));
create policy stock_events_insert on public.stock_events for insert
  with check (public.current_role() in ('manager','storekeeper','sales'));

-- orders:
--  - manager/sales: full read; sales also updates status -> billed/cancelled and does check-in.
--  - waiter/sales/manager: insert new orders.
--  - kitchen/barista: read their own department's orders, but may only update currently-placed ones.
--
-- Note on the select policy: it's scoped to `line` only, not `status`, even though kitchen/
-- barista should only ever *act on* placed orders (the app's queue screens already filter to
-- status='placed' for display). That's deliberate: Postgres requires an updated row to still
-- pass the table's SELECT policy after the write, not just WITH CHECK. If this policy also
-- required status='placed', marking an order served would make the row fail kitchen's own
-- SELECT policy mid-update and Postgres would reject the entire UPDATE — the department could
-- never transition an order away from 'placed'. The UPDATE policy below still restricts which
-- rows they can *start* from to status='placed'.
create policy orders_select on public.orders for select
  using (
    public.current_role() in ('manager','sales')
    or (public.current_role() = 'kitchen' and line = 'restaurant')
    or (public.current_role() = 'barista' and line = 'coffeeshop')
  );
create policy orders_insert on public.orders for insert
  with check (public.current_role() in ('manager','sales','waiter'));
create policy orders_update on public.orders for update
  using (
    public.current_role() in ('manager','sales')
    or (public.current_role() = 'kitchen' and line = 'restaurant' and status = 'placed')
    or (public.current_role() = 'barista' and line = 'coffeeshop' and status = 'placed')
  )
  with check (
    public.current_role() in ('manager','sales')
    or (public.current_role() = 'kitchen' and line = 'restaurant')
    or (public.current_role() = 'barista' and line = 'coffeeshop')
  );

-- order_items: visibility/mutation mirrors the parent order's policy (evaluated under the
-- caller's own privileges, so it naturally inherits the same department/status scoping).
create policy order_items_select on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_items.order_id));
-- No EXISTS-on-orders check here (unlike order_items_select): waiters can insert
-- orders but have no SELECT policy on orders, and RLS SELECT visibility, not just
-- row presence, is what EXISTS would actually test — it would always evaluate false
-- for them. The order_id foreign key constraint already guarantees referential
-- integrity without needing SELECT rights.
create policy order_items_insert on public.order_items for insert
  with check (public.current_role() in ('manager','sales','waiter'));

-- Belt-and-suspenders: grant on the tables/sequences that already exist by this point
-- in the transaction (the ALTER DEFAULT PRIVILEGES above only covers objects created
-- after it within the same role, which is everything above, but this makes it explicit).
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
