-- SplitMate 007: auto-reset the shared demo account.
-- When the demo user (rahul.demo@example.com) signs out, the app calls reset_demo(),
-- which puts the demo "Goa Trip" back to its original state and removes anything judges added.

alter table public.groups add column if not exists is_demo boolean not null default false;
update public.groups set is_demo = true where name = 'Goa Trip' and not is_sample
  and id in (select group_id from public.group_members m join auth.users u on u.id = m.user_id where u.email = 'rahul.demo@example.com');

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

revoke all on function public.reset_demo() from public, anon;
grant execute on function public.reset_demo() to authenticated;
