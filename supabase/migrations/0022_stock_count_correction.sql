-- Stock count corrections: the manager sets an item to the quantity actually counted,
-- without recording it as usage, missing or spoiled. The difference is stored as an ordinary
-- stock entry with reason 'adjustment' (type 'in' when the count is higher than the system
-- thought, 'out' when it is lower), so the ledger stays append-only and the Staff Activity
-- log shows who changed what and why. The daily report folds an adjustment into that day's
-- Opening figure rather than its In/Out, so corrections never look like consumption.
alter table public.stock_events drop constraint if exists stock_events_reason_check;
alter table public.stock_events add constraint stock_events_reason_check
  check (reason in ('restock','usage','waste','spoilage','missing','other','adjustment'));
