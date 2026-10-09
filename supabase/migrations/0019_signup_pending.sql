-- Self-service sign-up: a new person creates their own account, but it stays inactive and
-- flagged signup_pending until a manager approves it and assigns a real role in the Users
-- panel. current_role() already returns null for inactive accounts (0001), so a pending
-- account has no access to anything but its own profile row in the meantime.
-- The role stored on a pending profile ('waiter') is only a placeholder to satisfy the
-- not-null check -- the manager picks the real one when approving.
alter table public.profiles add column if not exists signup_pending boolean not null default false;

-- Three policies only checked "is signed in" (auth.uid() is not null), which used to be
-- fine because every account was created by a manager. With open sign-up, a stranger's
-- pending account would pass that check and could read the menu and recipes or insert
-- stock alerts. Require an active role instead -- identical for every real staff account,
-- and it also closes the same gap for accounts a manager has disabled.
drop policy menu_items_select on public.menu_items;
create policy menu_items_select on public.menu_items for select using (public.current_role() is not null);

drop policy recipe_select on public.recipe_ingredients;
create policy recipe_select on public.recipe_ingredients for select using (public.current_role() is not null);

drop policy stock_alerts_insert on public.stock_alerts;
create policy stock_alerts_insert on public.stock_alerts for insert with check (public.current_role() is not null);
