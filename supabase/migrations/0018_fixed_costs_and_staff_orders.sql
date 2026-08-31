-- Fixed costs (salaries, utilities, rent, etc.) that the manager records so they factor
-- into profit/loss alongside revenue and cost of ingredients used. 'monthly' costs are
-- counted once per calendar month they overlap, not day-prorated -- kept simple on purpose,
-- matching how a small business owner actually thinks about a recurring bill.
create table public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'other' check (category in ('salaries','utilities','rent','other')),
  amount numeric not null check (amount > 0),
  frequency text not null default 'monthly' check (frequency in ('one_time','monthly')),
  start_date date not null default current_date,
  end_date date,
  note text,
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.fixed_costs enable row level security;

create policy fixed_costs_select on public.fixed_costs for select
  using (public.current_role() = 'manager');
create policy fixed_costs_write on public.fixed_costs for insert
  with check (public.current_role() = 'manager');
create policy fixed_costs_update on public.fixed_costs for update
  using (public.current_role() = 'manager') with check (public.current_role() = 'manager');
create policy fixed_costs_delete on public.fixed_costs for delete
  using (public.current_role() = 'manager');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fixed_costs'
  ) then
    execute 'alter publication supabase_realtime add table public.fixed_costs';
  end if;
end $$;

-- A staff member's own order, recorded at a reduced price (whatever the waiter/sales
-- enters when they flag it) so reports can separate "what a paying guest brought in"
-- from "what a staff meal actually cost us" instead of quietly blending the two.
alter table public.orders add column if not exists is_staff_order boolean not null default false;
