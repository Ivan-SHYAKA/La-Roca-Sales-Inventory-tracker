-- Daily operations improvements:
--   * split payments: a bill can be paid part MoMo, part cash (orders.payments)
--   * staff & management loans, with repayments and a remaining balance
--   * cash book: opening balance and end-of-day count of cash and MoMo, per day
-- Loans and the cash book are manager-only.

-- ---------------------------------------------------------------------------------------
-- Split payments. payments = [{ "method": "cash", "amount": 5000 }, { "method": "mobile_money", "amount": 10000 }]
-- on each order of the bill (each method's amount is shared across the bill's orders in
-- proportion to their totals, like amount_paid already is). payment_method becomes 'split'
-- when more than one method was used. Older orders keep payment_method / amount_paid only.
-- ---------------------------------------------------------------------------------------
alter table public.orders add column if not exists payments jsonb;

-- ---------------------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------------------
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  person_name text not null check (length(btrim(person_name)) > 0),
  amount numeric not null check (amount > 0),
  loan_date date not null default current_date,
  note text,
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_on date not null default current_date,
  note text,
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index idx_loan_repayments_loan on public.loan_repayments (loan_id, paid_on);

alter table public.loans enable row level security;
alter table public.loan_repayments enable row level security;
create policy loans_manager on public.loans for all
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');
create policy loan_repayments_manager on public.loan_repayments for all
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

-- A repayment can't be larger than what is still owed.
create or replace function public.check_loan_repayment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_loan numeric;
  v_paid numeric;
begin
  select amount into v_loan from public.loans where id = new.loan_id for update;
  select coalesce(sum(amount), 0) into v_paid from public.loan_repayments
   where loan_id = new.loan_id and id is distinct from new.id;
  if v_paid + new.amount > v_loan then
    raise exception 'That repayment is more than what is still owed (RWF % remaining).', (v_loan - v_paid);
  end if;
  return new;
end;
$$;
create trigger trg_check_loan_repayment before insert or update on public.loan_repayments
for each row execute function public.check_loan_repayment();

-- ---------------------------------------------------------------------------------------
-- Cash book: one row per day. Opening is what was in the till / on the MoMo line at the start
-- of the day; closing is what was counted at the end. Both are optional so a day can be
-- filled in over time. What the system expects comes from the day's billed payments.
-- ---------------------------------------------------------------------------------------
create table public.cash_book_days (
  day date primary key,
  opening_cash numeric check (opening_cash >= 0),
  opening_momo numeric check (opening_momo >= 0),
  closing_cash numeric check (closing_cash >= 0),
  closing_momo numeric check (closing_momo >= 0),
  note text,
  updated_by uuid references public.profiles(id),
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table public.cash_book_days enable row level security;
create policy cash_book_manager on public.cash_book_days for all
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');

do $$
declare t text;
begin
  foreach t in array array['loans', 'loan_repayments', 'cash_book_days'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- Activity log: a "money" kind, and the new events
-- ---------------------------------------------------------------------------------------
alter table public.audit_log drop constraint if exists audit_log_category_check;
alter table public.audit_log add constraint audit_log_category_check
  check (category in ('order', 'stock', 'menu', 'account', 'money'));

create or replace function public.audit_loan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('money', 'loan_added',
      'Recorded a loan of RWF ' || to_char(new.amount, 'FM999G999G999') || ' to ' || new.person_name,
      jsonb_build_object('name', new.person_name, 'amount', new.amount, 'date', new.loan_date, 'note', new.note));
  elsif tg_op = 'DELETE' then
    perform public.log_activity('money', 'loan_removed',
      'Removed the loan of RWF ' || to_char(old.amount, 'FM999G999G999') || ' to ' || old.person_name,
      jsonb_build_object('name', old.person_name, 'amount', old.amount, 'date', old.loan_date));
  end if;
  return null;
end;
$$;
create trigger trg_audit_loan after insert or delete on public.loans
for each row execute function public.audit_loan();

create or replace function public.audit_loan_repayment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  l public.loans%rowtype;
  v_paid numeric;
begin
  if tg_op = 'INSERT' then
    select * into l from public.loans where id = new.loan_id;
    select coalesce(sum(amount), 0) into v_paid from public.loan_repayments where loan_id = new.loan_id;
    perform public.log_activity('money', 'loan_repayment',
      'Recorded a repayment of RWF ' || to_char(new.amount, 'FM999G999G999') || ' from ' || l.person_name,
      jsonb_build_object('name', l.person_name, 'amount', new.amount, 'date', new.paid_on,
                         'remaining', l.amount - v_paid, 'borrowed', l.amount, 'note', new.note));
  end if;
  return null;
end;
$$;
create trigger trg_audit_loan_repayment after insert on public.loan_repayments
for each row execute function public.audit_loan_repayment();

create or replace function public.audit_cash_book()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_what text;
begin
  v_what := case
    when tg_op = 'INSERT' and new.opening_cash is not null then 'the opening balance'
    when tg_op = 'UPDATE' and (new.opening_cash is distinct from old.opening_cash or new.opening_momo is distinct from old.opening_momo)
         and (new.closing_cash is not distinct from old.closing_cash and new.closing_momo is not distinct from old.closing_momo) then 'the opening balance'
    else 'the closing count' end;
  perform public.log_activity('money', 'cash_book_saved',
    'Entered ' || v_what || ' for ' || to_char(new.day, 'DD Mon YYYY'),
    jsonb_build_object('day', new.day, 'opening_cash', new.opening_cash, 'opening_momo', new.opening_momo,
                       'closing_cash', new.closing_cash, 'closing_momo', new.closing_momo, 'note', new.note));
  return null;
end;
$$;
create trigger trg_audit_cash_book after insert or update on public.cash_book_days
for each row execute function public.audit_cash_book();

-- Billing entries in the log now carry the split.
create or replace function public.audit_order_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_verb text;
  v_label text := coalesce(nullif(new.table_number, ''), nullif(new.client_name, ''), 'a guest');
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'voided' then
    perform public.log_activity('order', 'order_voided', 'Removed the invoice for ' || v_label,
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
                       'payments', new.payments, 'cancel_reason', new.cancel_reason),
    case when new.group_id is not null then 'order_' || new.status || ':' || new.group_id::text end
  );
  return new;
end;
$$;

-- log_activity: when entries of one bill are merged, their payment lists are added up per method.
create or replace function public.log_activity(
  p_category text, p_action text, p_summary text,
  p_details jsonb default '{}'::jsonb, p_dedupe text default null, p_summary_many text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
  v_key text;
  v_existing public.audit_log%rowtype;
  v_d jsonb;
  v_n int;
begin
  if v_uid is not null then
    select name, role into v_name, v_role from public.profiles where id = v_uid;
  end if;
  v_key := case when p_dedupe is null then null else coalesce(v_uid::text, 'system') || ':' || p_dedupe end;

  if v_key is not null then
    select * into v_existing from public.audit_log
     where dedupe_key = v_key and created_at > now() - interval '3 minutes'
     order by created_at desc limit 1;
    if found then
      v_d := v_existing.details;
      if p_details ? 'items' then
        v_d := jsonb_set(v_d, '{items}', coalesce(v_d->'items', '[]'::jsonb) || (p_details->'items'));
      end if;
      if p_details ? 'total' then
        v_d := jsonb_set(v_d, '{total}', to_jsonb(coalesce((v_d->>'total')::numeric, 0) + coalesce((p_details->>'total')::numeric, 0)));
      end if;
      if p_details ? 'amount_paid' and p_details->>'amount_paid' is not null then
        v_d := jsonb_set(v_d, '{amount_paid}', to_jsonb(coalesce((v_d->>'amount_paid')::numeric, 0) + (p_details->>'amount_paid')::numeric));
      end if;
      if jsonb_typeof(p_details->'payments') = 'array' then
        v_d := jsonb_set(v_d, '{payments}', (
          select coalesce(jsonb_agg(jsonb_build_object('method', m, 'amount', a)), '[]'::jsonb)
          from (
            select x->>'method' as m, sum((x->>'amount')::numeric) as a
            from jsonb_array_elements(
              case when jsonb_typeof(v_d->'payments') = 'array' then v_d->'payments' else '[]'::jsonb end || (p_details->'payments')
            ) as t(x)
            group by 1
          ) s
        ));
      end if;
      if p_details ? 'lines' then
        v_d := jsonb_set(v_d, '{lines}', (
          select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(v_d->'lines', '[]'::jsonb) || (p_details->'lines')) as t(x)
        ));
      end if;
      v_n := coalesce(jsonb_array_length(v_d->'items'), 0);
      update public.audit_log
         set created_at = now(),
             details = v_d,
             summary = case when p_summary_many is not null and v_n > 0 then replace(p_summary_many, '{n}', v_n::text) else p_summary end
       where id = v_existing.id;
      return;
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_name, actor_role, category, action, summary, details, dedupe_key)
  values (v_uid, coalesce(v_name, 'System'), v_role, p_category, p_action, p_summary, coalesce(p_details, '{}'::jsonb), v_key);
end;
$$;
