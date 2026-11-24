-- SplitMate 009: 📡 Trip Tracking
-- While a group's tracking window is open, members collect spends (from bank/UPI SMS, bank
-- statements or cash) into a PRIVATE inbox. At wrap-up each person marks every spend as
-- Personal (stays private) or Split (becomes a normal group expense).
-- Privacy: only amount, merchant, category and time are stored, never raw SMS or account numbers.

alter table public.groups add column if not exists tracking_started_at timestamptz;
alter table public.groups add column if not exists tracking_ended_at timestamptz;

create table if not exists public.captured_txns (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  amount_paise  bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  merchant      text not null check (char_length(merchant) between 1 and 60),
  category      text not null default 'other',
  txn_at        timestamptz not null default now(),
  source        text not null default 'cash' check (source in ('sms', 'statement', 'cash', 'share')),
  status        text not null default 'pending' check (status in ('pending', 'shared', 'personal')),
  expense_id    uuid references public.expenses(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists captured_txns_user on public.captured_txns (group_id, user_id, status);

alter table public.captured_txns enable row level security;
-- Each person sees and edits ONLY their own captured spends.
drop policy if exists captured_own on public.captured_txns;
create policy captured_own on public.captured_txns for all to authenticated
  using (user_id = auth.uid() and public.is_member(group_id))
  with check (user_id = auth.uid() and public.is_member(group_id));
grant select, insert, update, delete on public.captured_txns to authenticated;
grant all on public.captured_txns to service_role;

-- Start / stop the tracking window (any member).
create or replace function public.set_tracking(p_group_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if p_on then
    update groups set tracking_started_at = now(), tracking_ended_at = null where id = p_group_id;
  else
    update groups set tracking_ended_at = now() where id = p_group_id and tracking_started_at is not null;
  end if;
end $$;

-- Add many captured spends at once; skips exact duplicates (same amount + merchant within 2 minutes).
create or replace function public.add_captured(p_group_id uuid, p_items jsonb, p_source text default 'sms')
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; x jsonb; v_amt bigint; v_m text; v_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing to add'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Add at most 200 spends at a time'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_amt := nullif(x->>'amount_paise', '')::bigint;
    v_m := coalesce(nullif(left(trim(coalesce(x->>'merchant', '')), 60), ''), 'Payment');
    v_at := coalesce(nullif(x->>'txn_at', '')::timestamptz, now());
    continue when v_amt is null or v_amt <= 0 or v_amt > 100000000000;
    continue when exists (select 1 from captured_txns c where c.user_id = auth.uid() and c.group_id = p_group_id
                          and c.amount_paise = v_amt and c.merchant = v_m and abs(extract(epoch from c.txn_at - v_at)) < 120);
    insert into captured_txns (group_id, user_id, amount_paise, merchant, category, txn_at, source)
    values (p_group_id, auth.uid(), v_amt, v_m, coalesce(nullif(left(x->>'category', 30), ''), 'other'), v_at,
            case when p_source in ('sms', 'statement', 'cash', 'share') then p_source else 'sms' end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Turn one of MY captured spends into a group expense, split equally with the chosen people.
create or replace function public.share_captured(p_txn_id uuid, p_with uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare t captured_txns; ids uuid[]; n int; base bigint; rem bigint; splits jsonb := '[]'::jsonb; i int; eid uuid;
begin
  select * into t from captured_txns where id = p_txn_id;
  if t.id is null or t.user_id <> auth.uid() then raise exception 'That spend was not found'; end if;
  if t.status = 'shared' then return t.expense_id; end if;
  select array_agg(u order by u) into ids from (select distinct unnest(p_with) u) q where is_member(t.group_id, u);
  if ids is null or array_length(ids, 1) = 0 then raise exception 'Pick at least one person to split with'; end if;
  n := array_length(ids, 1);
  base := t.amount_paise / n;
  rem := t.amount_paise - base * n;
  for i in 1..n loop
    splits := splits || jsonb_build_object('user_id', ids[i], 'share_paise', base + case when i <= rem then 1 else 0 end);
  end loop;
  eid := save_expense(t.group_id, t.merchant, t.amount_paise, t.user_id, t.category, 'equal',
                      (t.txn_at at time zone 'Asia/Kolkata')::date, splits, '📡 from trip tracking');
  update captured_txns set status = 'shared', expense_id = eid where id = t.id;
  return eid;
end $$;

-- Who still has spends to review (counts only; nobody sees anyone else's spends).
create or replace function public.tracking_status(p_group_id uuid)
returns table (user_id uuid, pending int, total int)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         (select count(*)::int from captured_txns c where c.group_id = p_group_id and c.user_id = m.user_id and c.status = 'pending'),
         (select count(*)::int from captured_txns c where c.group_id = p_group_id and c.user_id = m.user_id)
  from group_members m
  where m.group_id = p_group_id and is_member(p_group_id);
$$;

revoke all on function public.set_tracking(uuid, boolean), public.add_captured(uuid, jsonb, text),
  public.share_captured(uuid, uuid[]), public.tracking_status(uuid) from public, anon;
grant execute on function public.set_tracking(uuid, boolean), public.add_captured(uuid, jsonb, text),
  public.share_captured(uuid, uuid[]), public.tracking_status(uuid) to authenticated;

-- demo reset also clears trip-tracking data
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

