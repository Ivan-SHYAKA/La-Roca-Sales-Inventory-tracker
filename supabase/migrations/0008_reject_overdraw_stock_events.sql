-- apply_stock_event() used to floor at 0 (greatest(0, quantity - new.quantity)) for stock-out,
-- which silently let anyone log removing more than what's actually in stock — the ledger would
-- just clamp to 0 and quietly disagree with reality forever after. Reject the insert instead,
-- so "not enough stock" is a visible error rather than a silently wrong running total. The app
-- also checks this client-side (StockForm) for a friendlier message before it ever gets here;
-- this is the backstop that holds regardless of which client is writing.
create or replace function public.apply_stock_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_qty numeric;
begin
  if new.type = 'in' then
    update public.inventory set quantity = quantity + new.quantity where id = new.inventory_id;
  else
    select quantity into current_qty from public.inventory where id = new.inventory_id for update;
    if current_qty - new.quantity < 0 then
      raise exception 'Not enough stock: only % available, tried to remove %', current_qty, new.quantity;
    end if;
    update public.inventory set quantity = current_qty - new.quantity where id = new.inventory_id;
  end if;
  return new;
end;
$$;
