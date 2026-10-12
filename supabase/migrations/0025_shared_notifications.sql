-- Notifications are for the role as a whole, not for each person separately.
--
--  * Once one person in a role has acknowledged a notification, it no longer interrupts anyone
--    else in that role: colleagues can now see each other's acknowledgements for notifications
--    addressed to their role.
--  * When an order has been processed (it moves on from "placed" -- marked ready, or
--    cancelled), the "new order" notification, and a shortage notice sent to the kitchen or
--    barista for it, are resolved for everyone. They stay in the table (so the order's
--    history is intact); they just stop being shown.
--
-- Nothing is deleted. A notification's details remain where they belong: on the order, in the
-- stock alerts, and in the activity log.

alter table public.notifications add column if not exists resolved_at timestamptz;
create index if not exists idx_notifications_unresolved on public.notifications (target_role, created_at) where resolved_at is null;

-- Colleagues in the same role can see each other's acknowledgements of the role's notifications.
drop policy if exists notification_acks_select on public.notification_acks;
create policy notification_acks_select on public.notification_acks for select
  using (
    user_id = auth.uid()
    or public.current_role() = 'manager'
    or exists (
      select 1 from public.notifications n
      where n.id = notification_acks.notification_id and n.target_role = public.current_role()
    )
  );

-- An order that has been handled no longer needs its department's popup.
create or replace function public.resolve_order_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'placed' and new.status <> 'placed' then
    update public.notifications
       set resolved_at = now()
     where order_id = new.id
       and resolved_at is null
       and (type = 'new_order' or (type = 'stock_shortage' and target_role in ('kitchen', 'barista')));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_resolve_order_notifications on public.orders;
create trigger trg_resolve_order_notifications after update of status on public.orders
for each row execute function public.resolve_order_notifications();

-- Clear the backlog: orders that were already handled but still have an open notification.
update public.notifications n
   set resolved_at = now()
  from public.orders o
 where n.order_id = o.id
   and n.resolved_at is null
   and o.status <> 'placed'
   and (n.type = 'new_order' or (n.type = 'stock_shortage' and n.target_role in ('kitchen', 'barista')));
