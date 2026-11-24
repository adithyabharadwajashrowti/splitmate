-- SplitMate 006: one-tap "sample trip" for first-time users.
-- Uses the three demo friend accounts (Rahul, Asha, Dev) as members.
-- Sample groups are hidden from the demo accounts' own dashboards so they don't pile up.

alter table public.groups add column if not exists is_sample boolean not null default false;

create or replace function public.my_groups()
returns table (id uuid, name text, emoji text, invite_code text, member_count int,
               my_balance bigint, last_activity timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.emoji, g.invite_code,
    (select count(*)::int from group_members m where m.group_id = g.id),
      coalesce((select sum(e.amount_paise) from expenses e where e.group_id = g.id and e.paid_by = auth.uid()), 0)
    - coalesce((select sum(s.share_paise) from expense_splits s join expenses e on e.id = s.expense_id
                where e.group_id = g.id and s.user_id = auth.uid()), 0)
    + coalesce((select sum(amount_paise) from settlements where group_id = g.id and from_user = auth.uid()), 0)
    - coalesce((select sum(amount_paise) from settlements where group_id = g.id and to_user = auth.uid()), 0),
    greatest(g.created_at,
             (select max(created_at) from expenses where group_id = g.id),
             (select max(created_at) from settlements where group_id = g.id))
  from groups g
  join group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
  where not (g.is_sample and g.created_by <> auth.uid())
  order by 7 desc;
$$;

create or replace function public.create_sample_group()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  a uuid := auth.uid(); r uuid; s uuid; d uuid; g uuid; e uuid;
begin
  if a is null then raise exception 'Please sign in again'; end if;
  select id into g from groups where created_by = a and is_sample limit 1;
  if g is not null then return g; end if; -- one sample per person

  select id into r from auth.users where email = 'rahul.demo@example.com';
  select id into s from auth.users where email = 'asha.demo@example.com';
  select id into d from auth.users where email = 'dev.demo@example.com';
  if r is null or s is null or d is null then raise exception 'Sample trip is not available right now'; end if;
  if a in (r, s, d) then raise exception 'You are already in the demo trip'; end if;

  insert into groups (name, emoji, created_by, is_sample, budget_paise) values ('Goa Trip (sample)', '🏖️', a, true, 2500000) returning id into g;
  insert into group_members (group_id, user_id) values (g, r), (g, s), (g, d) on conflict do nothing;

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
  values (g, 'Uber to Baga Beach', 84000, r, 'travel', 'equal', current_date - 4, a) returning id into e;
  insert into expense_splits values (e,a,21000),(e,r,21000),(e,s,21000),(e,d,21000);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Airbnb in Anjuna (2 nights)', 1200000, d, 'stay', 'equal', current_date - 5, a) returning id into e;
  insert into expense_splits values (e,a,300000),(e,r,300000),(e,s,300000),(e,d,300000);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Groceries & snacks', 126000, s, 'groceries', 'equal', current_date - 4, a) returning id into e;
  insert into expense_splits values (e,a,31500),(e,r,31500),(e,s,31500),(e,d,31500);

  insert into expenses (group_id, description, amount_paise, paid_by, category, split_type, expense_date, created_by)
  values (g, 'Parasailing', 600000, a, 'fun', 'equal', current_date - 2, a) returning id into e;
  insert into expense_splits values (e,a,200000),(e,r,200000),(e,d,200000);

  insert into settlements (group_id, from_user, to_user, amount_paise, method, note, created_by)
  values (g, s, a, 100000, 'upi', 'Part payment', a);
  return g;
end $$;

revoke all on function public.create_sample_group() from public, anon;
grant execute on function public.create_sample_group() to authenticated;
