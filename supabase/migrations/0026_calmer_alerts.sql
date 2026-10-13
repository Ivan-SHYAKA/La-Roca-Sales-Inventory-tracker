-- Calmer stock alerts.
--
--  * One open low-stock alert per item (it used to add another every time stock went out
--    while the item was already low, so the same item filled the list many times).
--  * An item that is restocked above its reorder level has its open low-stock alerts resolved
--    automatically, so the list only ever holds things that are still low.
--  * Popup-era notifications are marked resolved: staff are alerted with a toast and a bell
--    now, and nobody has to press "I've seen this" any more. Nothing is deleted.

create or replace function public.apply_stock_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  open_alert uuid;
  msg text;
begin
  if new.type = 'in' then
    update public.inventory set quantity = quantity + new.quantity
      where id = new.inventory_id
      returning * into inv;
    -- back above its reorder level: the "low stock" alerts for it are no longer true
    if inv.quantity > inv.reorder_level then
      update public.stock_alerts set resolved = true
       where inventory_id = inv.id and severity = 'low_stock' and resolved = false;
    end if;
  else
    update public.inventory set quantity = greatest(0, quantity - new.quantity)
      where id = new.inventory_id
      returning * into inv;
    if inv.quantity <= inv.reorder_level then
      msg := inv.name || ' is below reorder level (' || inv.quantity || ' ' || inv.unit || ' left).';
      select id into open_alert from public.stock_alerts
       where inventory_id = inv.id and severity = 'low_stock' and resolved = false
       order by created_at desc limit 1;
      if open_alert is null then
        insert into public.stock_alerts (inventory_id, order_id, message, severity)
        values (inv.id, new.order_id, msg, 'low_stock');
        insert into public.notifications (type, title, message, severity, target_role, inventory_id, order_id)
        select 'low_stock', 'Low stock', msg, 'high', role, inv.id, new.order_id
        from unnest(array['storekeeper','manager']) as role;
      else
        -- already flagged: keep the single alert, just bring its numbers up to date
        update public.stock_alerts set message = msg where id = open_alert;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Tidy what is already there: keep only the newest open low-stock alert per item, and drop
-- the ones for items that are back above their reorder level.
update public.stock_alerts a set resolved = true
 where a.severity = 'low_stock' and a.resolved = false and a.inventory_id is not null
   and exists (
     select 1 from public.stock_alerts b
      where b.inventory_id = a.inventory_id and b.severity = 'low_stock' and b.resolved = false
        and (b.created_at > a.created_at or (b.created_at = a.created_at and b.id > a.id))
   );
update public.stock_alerts a set resolved = true
  from public.inventory i
 where i.id = a.inventory_id and a.severity = 'low_stock' and a.resolved = false and i.quantity > i.reorder_level;

-- Popup-era notifications no longer wait to be acknowledged.
update public.notifications set resolved_at = now() where resolved_at is null;
