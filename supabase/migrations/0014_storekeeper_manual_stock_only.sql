-- Placing an order no longer touches real inventory numbers at all: the storekeeper is
-- now the only one who records stock in/out (via Stock In / Stock Out), so those numbers
-- can be trusted as "what a human actually counted" rather than a mix of that and silent
-- order-time deductions. The system's own estimate of what orders *should* have used is
-- still available -- computed straight from orders x recipes (business.js's
-- expectedUsageForDay/dailyStockReport) -- and shown to manager/admin only as a comparison,
-- without needing any stock_events rows of its own.
--
-- block_order_item_if_short() is left as-is: it's a safety net against overselling relative
-- to whatever the storekeeper has most recently recorded, which is an independent concern
-- from who updates that recorded number.
drop trigger if exists trg_deduct_inventory_on_order_item on public.order_items;
drop function if exists public.deduct_inventory_on_order_item();

-- Low-stock alerting moves here so it still fires -- now on whatever actually changes
-- inventory (the storekeeper's manual stock-out), instead of the removed auto-deduction.
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
    end if;
  end if;
  return new;
end;
$$;
