-- Lets the manager hide a menu item from the waiter's ordering screen without deleting it --
-- recipe, order history, and everything else stays intact; it just stops being offered.
alter table public.menu_items add column if not exists active boolean not null default true;
