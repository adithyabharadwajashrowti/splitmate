-- SplitMate 010: 📲 Live Table Mode
-- The host enters the bill once; everyone at the table opens the QR link and taps
-- their OWN dishes on their own phone. The host finalises it into a normal itemized expense.

create table if not exists public.live_bills (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  host        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title       text not null default 'Live bill' check (char_length(title) between 1 and 120),
  items       jsonb not null,           -- [{key, name, qty, amount_paise}]
  extras      jsonb not null default '{}'::jsonb,  -- {tax_paise, service_paise, tip_paise, discount_paise}
  status      text not null default 'open' check (status in ('open', 'closed')),
  expense_id  uuid references public.expenses(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists live_bills_group on public.live_bills (group_id, status);

create table if not exists public.live_claims (
  bill_id   uuid not null references public.live_bills(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  item_key  text not null,
  weight    numeric not null check (weight > 0 and weight <= 5),
  primary key (bill_id, user_id, item_key)
);

alter table public.live_bills enable row level security;
alter table public.live_claims enable row level security;
drop policy if exists live_bills_read on public.live_bills;
create policy live_bills_read on public.live_bills for select to authenticated using (public.is_member(group_id));
drop policy if exists live_claims_read on public.live_claims;
create policy live_claims_read on public.live_claims for select to authenticated
  using (exists (select 1 from public.live_bills b where b.id = bill_id and public.is_member(b.group_id)));
grant select on public.live_bills, public.live_claims to authenticated;
grant all on public.live_bills, public.live_claims to service_role;

-- Host opens a live bill.
create or replace function public.create_live_bill(p_group_id uuid, p_title text, p_items jsonb, p_extras jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item with a price'; end if;
  if jsonb_array_length(p_items) > 80 then raise exception 'Too many items for one bill'; end if;
  insert into live_bills (group_id, host, title, items, extras)
  values (p_group_id, auth.uid(), coalesce(nullif(left(trim(coalesce(p_title, '')), 120), ''), 'Live bill'), p_items, coalesce(p_extras, '{}'::jsonb))
  returning id into bid;
  return bid;
end $$;

-- Anyone in the group taps a dish for THEMSELVES (weight 0 = untap).
create or replace function public.claim_item(p_bill_id uuid, p_item_key text, p_weight numeric)
returns void language plpgsql security definer set search_path = public as $$
declare b live_bills;
begin
  select * into b from live_bills where id = p_bill_id;
  if b.id is null or not is_member(b.group_id) then raise exception 'Bill not found'; end if;
  if b.status <> 'open' then raise exception 'This bill is already saved'; end if;
  if not exists (select 1 from jsonb_array_elements(b.items) x where x->>'key' = p_item_key) then raise exception 'That dish is not on the bill'; end if;
  if coalesce(p_weight, 0) <= 0 then
    delete from live_claims where bill_id = p_bill_id and user_id = auth.uid() and item_key = p_item_key;
  else
    insert into live_claims (bill_id, user_id, item_key, weight) values (p_bill_id, auth.uid(), p_item_key, least(p_weight, 5))
    on conflict (bill_id, user_id, item_key) do update set weight = excluded.weight;
  end if;
end $$;

-- Host updates GST / service / tip while people are tapping.
create or replace function public.set_live_extras(p_bill_id uuid, p_extras jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update live_bills set extras = coalesce(p_extras, '{}'::jsonb) where id = p_bill_id and host = auth.uid() and status = 'open';
  if not found then raise exception 'Only the host can change this bill'; end if;
end $$;

-- Host closes the bill after saving the expense (or cancels it).
create or replace function public.close_live_bill(p_bill_id uuid, p_expense_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update live_bills set status = 'closed', expense_id = p_expense_id where id = p_bill_id and host = auth.uid();
  if not found then raise exception 'Only the host can close this bill'; end if;
end $$;

revoke all on function public.create_live_bill(uuid, text, jsonb, jsonb), public.claim_item(uuid, text, numeric),
  public.set_live_extras(uuid, jsonb), public.close_live_bill(uuid, uuid) from public, anon;
grant execute on function public.create_live_bill(uuid, text, jsonb, jsonb), public.claim_item(uuid, text, numeric),
  public.set_live_extras(uuid, jsonb), public.close_live_bill(uuid, uuid) to authenticated;

-- demo reset also clears live bills
create or replace function public.reset_demo()
returns void language plpgsql security definer set search_path = public as $$
declare
  r uuid; s uuid; d uuid; a uuid; g uuid; e uuid;
begin
  select id into r from auth.users where email = 'rahul.demo@example.com';
  select id into s from auth.users where email = 'asha.demo@example.com';
  select id into d from auth.users where email = 'dev.demo@example.com';
  if auth.uid() is null or auth.uid() <> r then raise exception 'Only the demo account can reset the demo'; end if;

  select id, created_by into g, a from groups where is_demo order by created_at limit 1;
  if g is null then raise exception 'Demo group not found'; end if;

  -- 1. anything the demo users created elsewhere goes away; demo users leave groups they joined
  delete from groups where created_by in (r, s, d) and not is_demo;
  delete from group_members where user_id in (r, s, d) and group_id <> g
    and group_id not in (select id from groups where is_sample); -- keep other people's sample trips intact

  -- 2. demo group back to its original shape
  update groups set name = 'Goa Trip', emoji = '🏖️', budget_paise = 2500000 where id = g;
  delete from group_members where group_id = g and user_id not in (a, r, s, d);
  insert into group_members (group_id, user_id, role) values (g, a, 'admin'), (g, r, 'member'), (g, s, 'member'), (g, d, 'member')
    on conflict (group_id, user_id) do update set role = excluded.role;
  delete from live_bills where group_id = g or host in (r, s, d);
  delete from captured_txns where group_id = g or user_id in (r, s, d);
  update groups set tracking_started_at = null, tracking_ended_at = null where id = g;
  delete from settlements where group_id = g;
  delete from expenses where group_id = g;

  -- 3. demo profiles back to defaults
  update profiles set display_name = 'Rahul', diet = 'nonveg', upi_id = null where id = r;
  update profiles set display_name = 'Asha',  diet = 'veg',    upi_id = null where id = s;
  update profiles set display_name = 'Dev',   diet = 'nonveg', upi_id = null where id = d;

  -- 4. original expenses (dates stay recent: a few days before today)
  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by, items)
  values (g, 'Dinner at Fisherman''s Wharf', 241500, a, 'food', 'itemized', current_date - 3, a,
    jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('name','Paneer butter masala','qty',1,'amount_paise',38000,'weights',jsonb_build_object(a,1,s,1)),
      jsonb_build_object('name','Chicken biryani','qty',2,'amount_paise',64000,'weights',jsonb_build_object(r,1,d,1)),
      jsonb_build_object('name','Butter naan','qty',6,'amount_paise',36000,'weights',jsonb_build_object(a,1,s,1,r,2,d,2)),
      jsonb_build_object('name','Kingfisher beer','qty',3,'amount_paise',54000,'weights',jsonb_build_object(r,2,d,1)),
      jsonb_build_object('name','Fresh lime soda','qty',2,'amount_paise',18000,'weights',jsonb_build_object(a,1,s,1))),
      'tax_paise',10500,'service_paise',21000,'tip_paise',0,'discount_paise',0))
  returning id into e;
  insert into expense_splits values (e,a,39100),(e,s,39100),(e,r,92000),(e,d,71300);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Uber to Baga Beach', 84000, r, 'travel', 'equal', current_date - 4, r) returning id into e;
  insert into expense_splits values (e,a,21000),(e,r,21000),(e,s,21000),(e,d,21000);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Airbnb in Anjuna (2 nights)', 1200000, d, 'stay', 'equal', current_date - 5, d) returning id into e;
  insert into expense_splits values (e,a,300000),(e,r,300000),(e,s,300000),(e,d,300000);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Groceries & snacks', 126000, s, 'groceries', 'equal', current_date - 4, s) returning id into e;
  insert into expense_splits values (e,a,31500),(e,r,31500),(e,s,31500),(e,d,31500);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Parasailing', 600000, a, 'fun', 'equal', current_date - 2, a) returning id into e;
  insert into expense_splits values (e,a,200000),(e,r,200000),(e,d,200000);

  insert into settlements (group_id, from_user, to_user, amount_paise, method, note, created_by)
  values (g, s, a, 100000, 'upi', 'Part payment', s);
end $$;

