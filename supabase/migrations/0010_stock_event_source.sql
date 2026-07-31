-- Distinguishes stock_events a human actually recorded (storekeeper/manager via Stock
-- In/Out, or sales logging check-in amenities) from ones the system auto-generated when
-- an order was placed (0009's deduct_inventory_on_order_item). Both share reason='usage'
-- and type='out', so without this the Daily Stock Report's "Out (recorded)" column
-- silently absorbed the system's own auto-deductions alongside the storekeeper's manual
-- entries — defeating the point of comparing what the storekeeper recorded against what
-- the system independently expects. 'manual' is the default, so every existing row and
-- every non-order-driven insert path is unaffected.
alter table public.stock_events add column if not exists source text not null default 'manual' check (source in ('manual','auto_deduction'));

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
    new_qty := ing.quantity - used;

    insert into public.stock_events
      (inventory_id, type, reason, quantity, order_id, note, source)
    values
      (ing.inventory_id, 'out', 'usage', used, new.order_id,
       'Auto-deducted for order item ' || new.id, 'auto_deduction');

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
