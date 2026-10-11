-- Removing a billed invoice.
--
--  * The manager can remove ("void") a billed invoice directly, always with a reason.
--  * Sales / receptionist can only ASK for it; nothing changes until the manager approves.
--  * A removed invoice is kept, marked 'voided': it drops out of billing lists, revenue,
--    the dashboard and Insights (they all count status 'billed'), it can be restored, and
--    the Staff Activity log records who asked, who approved and why.
--
-- Everything goes through the functions below so the rule can't be skipped from a screen:
-- a sales account cannot set 'voided' on an order itself (see guard trigger).

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('placed','ready','served','billed','cancelled','voided'));

alter table public.orders add column if not exists voided_at timestamptz;
alter table public.orders add column if not exists voided_by uuid references public.profiles(id);
alter table public.orders add column if not exists voided_by_name text;
alter table public.orders add column if not exists void_reason text;

-- Only the manager may move an order into or out of 'voided'. Runs for every client write;
-- SQL run directly on the server (no signed-in user) is left alone.
create or replace function public.guard_order_void()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and (new.status = 'voided' or old.status = 'voided')
     and auth.uid() is not null
     and coalesce(public.current_role(), '') <> 'manager' then
    raise exception 'Only the manager can remove or restore an invoice.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_order_void on public.orders;
create trigger trg_guard_order_void before update on public.orders
for each row execute function public.guard_order_void();

-- ---------------------------------------------------------------------------------------
-- Requests from sales / receptionist
-- ---------------------------------------------------------------------------------------
create table public.invoice_removal_requests (
  id uuid primary key default gen_random_uuid(),
  order_ids uuid[] not null,
  label text not null,
  total numeric not null default 0,
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid references public.profiles(id),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_by_name text,
  decided_at timestamptz,
  decision_note text
);
create index idx_removal_requests_status on public.invoice_removal_requests (status, requested_at desc);

alter table public.invoice_removal_requests enable row level security;
-- The manager sees every request; sales sees only their own. Nobody writes to the table
-- directly: requests are created and answered by the functions below.
create policy removal_requests_select on public.invoice_removal_requests for select
  using (public.current_role() = 'manager' or (public.current_role() = 'sales' and requested_by = auth.uid()));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoice_removal_requests'
  ) then
    execute 'alter publication supabase_realtime add table public.invoice_removal_requests';
  end if;
end $$;

-- Sales / receptionist: ask for an invoice (all its orders) to be removed.
create or replace function public.request_invoice_removal(p_order_ids uuid[], p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.current_role();
  v_uid uuid := auth.uid();
  v_name text;
  v_n int;
  v_billed int;
  v_total numeric;
  v_label text;
  v_id uuid;
begin
  if v_role not in ('sales', 'manager') then
    raise exception 'Only sales or the manager can ask for an invoice to be removed.';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'No invoice selected.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason.'; end if;

  select count(*), count(*) filter (where status = 'billed'), coalesce(sum(total), 0),
         max(coalesce(nullif(table_number, ''), nullif(client_name, ''), 'a guest'))
    into v_n, v_billed, v_total, v_label
    from public.orders where id = any(p_order_ids);
  if v_n <> array_length(p_order_ids, 1) or v_billed <> v_n then
    raise exception 'Only billed invoices can be removed.';
  end if;
  if exists (select 1 from public.invoice_removal_requests r where r.status = 'pending' and r.order_ids && p_order_ids) then
    raise exception 'A removal request for this invoice is already waiting for approval.';
  end if;

  select name into v_name from public.profiles where id = v_uid;
  insert into public.invoice_removal_requests (order_ids, label, total, reason, requested_by, requested_by_name)
  values (p_order_ids, v_label, v_total, btrim(p_reason), v_uid, v_name)
  returning id into v_id;

  perform public.log_activity('order', 'invoice_removal_requested',
    'Asked to remove the invoice for ' || v_label,
    jsonb_build_object('table', v_label, 'total', v_total, 'reason', btrim(p_reason)));
  return v_id;
end;
$$;

-- Manager: remove billed invoice(s) now.
create or replace function public.void_invoices(p_order_ids uuid[], p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_n int;
begin
  if public.current_role() is distinct from 'manager' then
    raise exception 'Only the manager can remove an invoice.';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'No invoice selected.'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Please give a reason.'; end if;
  select count(*) into v_n from public.orders where id = any(p_order_ids) and status = 'billed';
  if v_n <> array_length(p_order_ids, 1) then raise exception 'Only billed invoices can be removed.'; end if;

  select name into v_name from public.profiles where id = v_uid;
  update public.orders
     set status = 'voided', voided_at = now(), voided_by = v_uid, voided_by_name = v_name, void_reason = btrim(p_reason)
   where id = any(p_order_ids);

  -- a request that was waiting for these invoices is answered by this
  update public.invoice_removal_requests
     set status = 'approved', decided_by = v_uid, decided_by_name = v_name, decided_at = now()
   where status = 'pending' and order_ids && p_order_ids;
end;
$$;

-- Manager: put a removed invoice back.
create or replace function public.restore_invoices(p_order_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if public.current_role() is distinct from 'manager' then
    raise exception 'Only the manager can restore an invoice.';
  end if;
  select count(*) into v_n from public.orders where id = any(p_order_ids) and status = 'voided';
  if coalesce(array_length(p_order_ids, 1), 0) = 0 or v_n <> array_length(p_order_ids, 1) then
    raise exception 'Only removed invoices can be restored.';
  end if;
  update public.orders
     set status = 'billed', voided_at = null, voided_by = null, voided_by_name = null, void_reason = null
   where id = any(p_order_ids);
end;
$$;

-- Manager: answer a request from sales / receptionist.
create or replace function public.decide_invoice_removal(p_request_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  r public.invoice_removal_requests%rowtype;
  v_n int;
begin
  if public.current_role() is distinct from 'manager' then
    raise exception 'Only the manager can answer a removal request.';
  end if;
  select * into r from public.invoice_removal_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'This request has already been answered.';
  end if;
  select name into v_name from public.profiles where id = v_uid;

  if p_approve then
    select count(*) into v_n from public.orders where id = any(r.order_ids) and status = 'billed';
    if v_n <> array_length(r.order_ids, 1) then
      raise exception 'This invoice is no longer billed, so it can''t be removed.';
    end if;
    update public.orders
       set status = 'voided', voided_at = now(), voided_by = v_uid, voided_by_name = v_name,
           void_reason = r.reason || ' (asked by ' || coalesce(r.requested_by_name, 'sales') || ')'
     where id = any(r.order_ids);
    update public.invoice_removal_requests
       set status = 'approved', decided_by = v_uid, decided_by_name = v_name, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_request_id;
  else
    update public.invoice_removal_requests
       set status = 'rejected', decided_by = v_uid, decided_by_name = v_name, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_request_id;
    perform public.log_activity('order', 'invoice_removal_rejected',
      'Rejected the request to remove the invoice for ' || r.label,
      jsonb_build_object('table', r.label, 'total', r.total, 'reason', r.reason, 'asked_by', r.requested_by_name,
                         'note', nullif(btrim(coalesce(p_note, '')), '')));
  end if;
end;
$$;

revoke all on function public.request_invoice_removal(uuid[], text) from public, anon;
revoke all on function public.void_invoices(uuid[], text) from public, anon;
revoke all on function public.restore_invoices(uuid[]) from public, anon;
revoke all on function public.decide_invoice_removal(uuid, boolean, text) from public, anon;
grant execute on function public.request_invoice_removal(uuid[], text) to authenticated;
grant execute on function public.void_invoices(uuid[], text) to authenticated;
grant execute on function public.restore_invoices(uuid[]) to authenticated;
grant execute on function public.decide_invoice_removal(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Activity log wording for the new status changes
-- ---------------------------------------------------------------------------------------
create or replace function public.audit_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_verb text;
  v_action text;
  v_label text := coalesce(nullif(new.table_number, ''), nullif(new.client_name, ''), 'a guest');
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'voided' then
    v_action := 'order_voided';
    perform public.log_activity('order', v_action, 'Removed the invoice for ' || v_label,
      jsonb_build_object('table', new.table_number, 'client', new.client_name, 'lines', jsonb_build_array(new.line),
                         'total', new.total, 'payment_method', new.payment_method, 'amount_paid', new.amount_paid,
                         'void_reason', new.void_reason),
      case when new.group_id is not null then 'order_voided:' || new.group_id::text end);
    return new;
  end if;
  if old.status = 'voided' and new.status = 'billed' then
    perform public.log_activity('order', 'order_restored', 'Restored the invoice for ' || v_label,
      jsonb_build_object('table', new.table_number, 'client', new.client_name, 'lines', jsonb_build_array(new.line),
                         'total', new.total),
      case when new.group_id is not null then 'order_restored:' || new.group_id::text end);
    return new;
  end if;
  v_verb := case new.status
    when 'ready' then 'Marked ready' when 'served' then 'Served' when 'billed' then 'Billed'
    when 'cancelled' then 'Cancelled' else 'Changed' end;
  perform public.log_activity(
    'order', 'order_' || new.status,
    v_verb || ' the order for ' || v_label,
    jsonb_build_object('table', new.table_number, 'client', new.client_name, 'lines', jsonb_build_array(new.line),
                       'total', new.total, 'payment_method', new.payment_method, 'amount_paid', new.amount_paid,
                       'cancel_reason', new.cancel_reason),
    case when new.group_id is not null then 'order_' || new.status || ':' || new.group_id::text end
  );
  return new;
end;
$$;
