-- A waiter's cart can span multiple lines (restaurant + coffee shop) — that still becomes
-- one order row per line under the hood so kitchen/barista routing, RLS, and billing all
-- stay exactly as they are today (no changes to any of that). group_id just tags every
-- order created from the same cart submission, so waiter-facing screens can display them
-- as one card instead of several, and let the waiter mark each line served independently
-- while the rest of the group stays visible until it's done too. Nullable: existing rows
-- and any other insert path are unaffected and fall back to table-number-only grouping.
alter table public.orders add column if not exists group_id uuid;
