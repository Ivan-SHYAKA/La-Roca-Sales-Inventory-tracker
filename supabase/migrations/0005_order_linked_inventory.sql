-- Groups inventory items for the daily stock report UI (spreadsheet-style categories:
-- Coffee & Tea, Bakery, Foods, Ingredients, Vegetables, Fruits, No-food, Staff Food,
-- Daily Snacks Production, ...). Purely cosmetic grouping — no behavior depends on it.
alter table public.inventory add column if not exists category text;

-- 'missing' covers an unexplained shortfall the storekeeper reports (theft/loss),
-- distinct from 'waste'/'spoilage' which have a known cause.
alter table public.stock_events drop constraint if exists stock_events_reason_check;
alter table public.stock_events add constraint stock_events_reason_check
  check (reason in ('restock','usage','waste','spoilage','missing','other'));

-- Lets a stock-out event reference the specific order it was for, so recording can be
-- tied to the order that triggered it rather than just correlated by timing. Nullable:
-- waste/spoilage/staff-food stock-out has no order to link.
alter table public.stock_events add column if not exists order_id uuid references public.orders(id) on delete set null;
create index if not exists idx_stock_events_order on public.stock_events(order_id);
