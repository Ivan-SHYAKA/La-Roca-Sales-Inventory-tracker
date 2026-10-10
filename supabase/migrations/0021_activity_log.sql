-- Activity log: a record of who did what, written by the database itself so no screen can
-- skip it. Only the manager can read it; nobody can write to it from the browser (there are
-- no insert/update/delete policies) -- rows come from the triggers below and from the
-- admin-users edge function (service role).
--
-- Rows close together from the same person for the same kind of change are merged into one
-- (a whole table's order across restaurant + coffee shop, a session of price edits, a menu
-- import), so the feed reads as "what happened", not as one line per database row.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_name text not null default 'System',
  actor_role text,
  category text not null check (category in ('order','stock','menu','account')),
  action text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text
);
create index idx_audit_log_created on public.audit_log (created_at desc);
create index idx_audit_log_dedupe on public.audit_log (dedupe_key, created_at desc) where dedupe_key is not null;

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select
  using (public.current_role() = 'manager');

-- How far the manager has read, so the unread badge survives a refresh and a device change.
alter table public.profiles add column if not exists activity_seen_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_log'
  ) then
    execute 'alter publication supabase_realtime add table public.audit_log';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- Writer. The actor is whoever's signed in on this request (auth.uid()); runs with no
-- signed-in user (SQL run directly, service role) are recorded as "System".
-- p_dedupe: when set, a row with the same key from the same actor in the last 3 minutes is
-- updated instead of adding another: details.items are appended, details.total and details.amount_paid are added up,
-- details.lines are united, and the summary becomes p_summary_many ({n} = number of items).
-- ---------------------------------------------------------------------------------------
create or replace function public.log_activity(
  p_category text, p_action text, p_summary text,
  p_details jsonb default '{}'::jsonb, p_dedupe text default null, p_summary_many text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
  v_key text;
  v_existing public.audit_log%rowtype;
  v_d jsonb;
  v_n int;
begin
  if v_uid is not null then
    select name, role into v_name, v_role from public.profiles where id = v_uid;
  end if;
  v_key := case when p_dedupe is null then null else coalesce(v_uid::text, 'system') || ':' || p_dedupe end;

  if v_key is not null then
    select * into v_existing from public.audit_log
     where dedupe_key = v_key and created_at > now() - interval '3 minutes'
     order by created_at desc limit 1;
    if found then
      v_d := v_existing.details;
      if p_details ? 'items' then
        v_d := jsonb_set(v_d, '{items}', coalesce(v_d->'items', '[]'::jsonb) || (p_details->'items'));
      end if;
      if p_details ? 'total' then
        v_d := jsonb_set(v_d, '{total}', to_jsonb(coalesce((v_d->>'total')::numeric, 0) + coalesce((p_details->>'total')::numeric, 0)));
      end if;
      if p_details ? 'amount_paid' and p_details->>'amount_paid' is not null then
        v_d := jsonb_set(v_d, '{amount_paid}', to_jsonb(coalesce((v_d->>'amount_paid')::numeric, 0) + (p_details->>'amount_paid')::numeric));
      end if;
      if p_details ? 'lines' then
        v_d := jsonb_set(v_d, '{lines}', (
          select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(v_d->'lines', '[]'::jsonb) || (p_details->'lines')) as t(x)
        ));
      end if;
      v_n := coalesce(jsonb_array_length(v_d->'items'), 0);
      update public.audit_log
         set created_at = now(),
             details = v_d,
             summary = case when p_summary_many is not null and v_n > 0 then replace(p_summary_many, '{n}', v_n::text) else p_summary end
       where id = v_existing.id;
      return;
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_name, actor_role, category, action, summary, details, dedupe_key)
  values (v_uid, coalesce(v_name, 'System'), v_role, p_category, p_action, p_summary, coalesce(p_details, '{}'::jsonb), v_key);
end;
$$;

revoke all on function public.log_activity(text, text, text, jsonb, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------------------
create or replace function public.audit_order_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(
    'order', 'order_placed',
    'Placed an order for ' || coalesce(nullif(new.table_number, ''), nullif(new.client_name, ''), 'a guest'),
    jsonb_build_object('table', new.table_number, 'client', new.client_name, 'lines', jsonb_build_array(new.line),
                       'total', new.total, 'staff_order', coalesce(new.is_staff_order, false)),
    case when new.group_id is not null then 'placed:' || new.group_id::text end
  );
  return new;
end;
$$;
create trigger trg_audit_order_insert after insert on public.orders
for each row execute function public.audit_order_insert();

create or replace function public.audit_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_verb text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_verb := case new.status
    when 'ready' then 'Marked ready' when 'served' then 'Served' when 'billed' then 'Billed'
    when 'cancelled' then 'Cancelled' else 'Changed' end;
  perform public.log_activity(
    'order', 'order_' || new.status,
    v_verb || ' the order for ' || coalesce(nullif(new.table_number, ''), nullif(new.client_name, ''), 'a guest'),
    jsonb_build_object('table', new.table_number, 'client', new.client_name, 'lines', jsonb_build_array(new.line),
                       'total', new.total, 'payment_method', new.payment_method, 'amount_paid', new.amount_paid,
                       'cancel_reason', new.cancel_reason),
    case when new.group_id is not null then 'order_' || new.status || ':' || new.group_id::text end
  );
  return new;
end;
$$;
create trigger trg_audit_order_status after update on public.orders
for each row execute function public.audit_order_status();

-- ---------------------------------------------------------------------------------------
-- Stock: one entry per save (a whole daily sheet is one row), listing every item touched.
-- Corrections show up as the opposite entry under the same reason, as they are in the ledger.
-- ---------------------------------------------------------------------------------------
create or replace function public.audit_stock_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_items jsonb;
  v_n int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'unit', i.unit, 'type', n.type, 'reason', n.reason,
                                               'quantity', n.quantity, 'note', n.note) order by i.name), '[]'::jsonb),
         count(distinct n.inventory_id)
    into v_items, v_n
    from new_rows n join public.inventory i on i.id = n.inventory_id
   where n.source <> 'auto_deduction';
  if v_n = 0 then return null; end if;
  perform public.log_activity(
    'stock', 'stock_recorded',
    'Recorded stock for ' || v_n || case when v_n = 1 then ' item' else ' items' end,
    jsonb_build_object('items', v_items, 'count', v_n)
  );
  return null;
end;
$$;
create trigger trg_audit_stock_events after insert on public.stock_events
referencing new table as new_rows for each statement execute function public.audit_stock_events();

-- ---------------------------------------------------------------------------------------
-- Menu, recipes, stock list details (names, prices, reorder levels) and fixed costs
-- ---------------------------------------------------------------------------------------
create or replace function public.audit_menu_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb := '[]'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('menu', 'dish_added', 'Added "' || new.name || '" to the menu',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('name', new.name, 'line', new.line, 'price', new.price))),
      'dish_added', 'Added {n} dishes to the menu');
  elsif tg_op = 'DELETE' then
    perform public.log_activity('menu', 'dish_deleted', 'Deleted "' || old.name || '" from the menu',
      jsonb_build_object('name', old.name, 'price', old.price));
  else
    if new.name is distinct from old.name then v_changes := v_changes || jsonb_build_object('field', 'Name', 'from', old.name, 'to', new.name); end if;
    if new.line is distinct from old.line then v_changes := v_changes || jsonb_build_object('field', 'Line', 'from', old.line, 'to', new.line); end if;
    if new.price is distinct from old.price then v_changes := v_changes || jsonb_build_object('field', 'Price', 'from', old.price, 'to', new.price); end if;
    if new.prep_minutes is distinct from old.prep_minutes then v_changes := v_changes || jsonb_build_object('field', 'Prep time (min)', 'from', old.prep_minutes, 'to', new.prep_minutes); end if;
    if new.active is distinct from old.active and jsonb_array_length(v_changes) = 0 then
      perform public.log_activity('menu', case when new.active then 'dish_shown' else 'dish_hidden' end,
        case when new.active then 'Showed "' else 'Hid "' end || new.name || '" ' || case when new.active then 'on the menu' else 'from the menu' end,
        jsonb_build_object('name', new.name));
    elsif jsonb_array_length(v_changes) > 0 then
      if new.active is distinct from old.active then
        v_changes := v_changes || jsonb_build_object('field', 'Visible', 'from', old.active, 'to', new.active);
      end if;
      perform public.log_activity('menu', 'dish_edited', 'Edited "' || new.name || '"',
        jsonb_build_object('name', new.name, 'changes', v_changes));
    end if;
  end if;
  return null;
end;
$$;
create trigger trg_audit_menu_item after insert or update or delete on public.menu_items
for each row execute function public.audit_menu_item();

-- A recipe is replaced by deleting its rows and inserting the new ones, so only the inserting
-- statement is recorded: it carries the full new recipe.
create or replace function public.audit_recipe_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select m.name as dish,
           jsonb_agg(jsonb_build_object('name', i.name, 'unit', i.unit, 'quantity', n.qty_per_unit) order by i.name) as items
      from new_rows n
      join public.menu_items m on m.id = n.menu_item_id
      join public.inventory i on i.id = n.inventory_id
     group by m.id, m.name
  loop
    perform public.log_activity('menu', 'recipe_set', 'Updated the recipe of "' || r.dish || '"',
      jsonb_build_object('name', r.dish, 'items', r.items));
  end loop;
  return null;
end;
$$;
create trigger trg_audit_recipe_insert after insert on public.recipe_ingredients
referencing new table as new_rows for each statement execute function public.audit_recipe_insert();

create or replace function public.audit_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb := '[]'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('menu', 'item_added', 'Added "' || new.name || '" to the stock list',
      jsonb_build_object('items', jsonb_build_array(jsonb_build_object('name', new.name, 'unit', new.unit, 'category', new.category))),
      'item_added', 'Added {n} items to the stock list');
  elsif tg_op = 'DELETE' then
    perform public.log_activity('menu', 'item_deleted', 'Removed "' || old.name || '" from the stock list',
      jsonb_build_object('name', old.name));
  else
    -- Quantity changes come from stock entries (already recorded as such); only the item's
    -- own details are listed here.
    if new.name is distinct from old.name then v_changes := v_changes || jsonb_build_object('field', 'Name', 'from', old.name, 'to', new.name); end if;
    if new.category is distinct from old.category then v_changes := v_changes || jsonb_build_object('field', 'Heading', 'from', old.category, 'to', new.category); end if;
    if new.unit is distinct from old.unit then v_changes := v_changes || jsonb_build_object('field', 'Units', 'from', old.unit, 'to', new.unit); end if;
    if new.line is distinct from old.line then v_changes := v_changes || jsonb_build_object('field', 'Used by', 'from', old.line, 'to', new.line); end if;
    if new.reorder_level is distinct from old.reorder_level then v_changes := v_changes || jsonb_build_object('field', 'Reorder level', 'from', old.reorder_level, 'to', new.reorder_level); end if;
    if new.cost_per_unit is distinct from old.cost_per_unit then v_changes := v_changes || jsonb_build_object('field', 'Cost per unit', 'from', old.cost_per_unit, 'to', new.cost_per_unit); end if;
    if jsonb_array_length(v_changes) > 0 then
      perform public.log_activity('menu', 'item_edited', 'Edited "' || new.name || '" in the stock list',
        jsonb_build_object('items', jsonb_build_array(jsonb_build_object('name', new.name, 'changes', v_changes))),
        'item_edited', 'Edited {n} items in the stock list');
    end if;
  end if;
  return null;
end;
$$;
create trigger trg_audit_inventory after insert or update or delete on public.inventory
for each row execute function public.audit_inventory();

create or replace function public.audit_fixed_cost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('menu', 'cost_added', 'Added the fixed cost "' || new.name || '"',
      jsonb_build_object('name', new.name, 'amount', new.amount, 'frequency', new.frequency, 'category', new.category));
  elsif tg_op = 'DELETE' then
    perform public.log_activity('menu', 'cost_removed', 'Removed the fixed cost "' || old.name || '"',
      jsonb_build_object('name', old.name, 'amount', old.amount, 'frequency', old.frequency));
  else
    perform public.log_activity('menu', 'cost_edited', 'Edited the fixed cost "' || new.name || '"',
      jsonb_build_object('name', new.name, 'amount', new.amount, 'frequency', new.frequency));
  end if;
  return null;
end;
$$;
create trigger trg_audit_fixed_cost after insert or update or delete on public.fixed_costs
for each row execute function public.audit_fixed_cost();

-- ---------------------------------------------------------------------------------------
-- Accounts: approving / switching on / switching off, done by a signed-in manager. Creating,
-- editing and rejecting go through the admin-users function, which records those itself
-- (it runs as the service role, where there's no signed-in user for a trigger to see).
-- ---------------------------------------------------------------------------------------
create or replace function public.audit_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return null; end if;
  if old.signup_pending and not new.signup_pending and new.active then
    perform public.log_activity('account', 'signup_approved', 'Approved ' || new.name || ' as ' || new.role,
      jsonb_build_object('name', new.name, 'username', new.username, 'role', new.role));
  elsif new.active is distinct from old.active then
    perform public.log_activity('account', case when new.active then 'account_enabled' else 'account_disabled' end,
      case when new.active then 'Switched on the account of ' else 'Switched off the account of ' end || new.name,
      jsonb_build_object('name', new.name, 'username', new.username, 'role', new.role));
  end if;
  return null;
end;
$$;
create trigger trg_audit_profile_change after update on public.profiles
for each row execute function public.audit_profile_change();
