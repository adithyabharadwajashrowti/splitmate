-- SplitMate 005: hardening — every write path validates input and returns a friendly message
-- (instead of raw "violates check constraint" / "row-level security" errors).

-- ---------------------------------------------------------------- profiles
-- Clean up names / UPI IDs on every insert or update.
create or replace function public.clean_profile()
returns trigger language plpgsql set search_path = public as $$
begin
  new.display_name := left(trim(regexp_replace(coalesce(new.display_name, ''), '\s+', ' ', 'g')), 40);
  if new.display_name = '' then
    if tg_op = 'UPDATE' then raise exception 'Name can''t be empty'; end if;
    new.display_name := 'Friend';
  end if;
  new.upi_id := nullif(lower(trim(coalesce(new.upi_id, ''))), '');
  if new.upi_id is not null and new.upi_id !~ '^[a-z0-9._-]{2,64}@[a-z][a-z0-9.-]{1,64}$' then
    raise exception 'UPI ID looks wrong — it should look like name@okaxis';
  end if;
  if new.diet is not null and new.diet not in ('veg','nonveg','egg','vegan') then new.diet := null; end if;
  if tg_op = 'UPDATE' then new.id := old.id; new.created_at := old.created_at; end if;
  return new;
end $$;

drop trigger if exists clean_profile on public.profiles;
create trigger clean_profile before insert or update on public.profiles
  for each row execute function public.clean_profile();

-- ---------------------------------------------------------------- groups
create or replace function public.create_group(p_name text, p_emoji text default '👥')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
  v_name text := left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 60);
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if v_name = '' then raise exception 'Give the group a name'; end if;
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'Your profile is missing — sign out and in again'; end if;
  insert into groups (name, emoji, created_by)
  values (v_name, coalesce(nullif(left(trim(coalesce(p_emoji, '')), 8), ''), '👥'), auth.uid())
  returning id into gid;
  return gid;
end $$;

create or replace function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
  v_code text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if v_code = '' then raise exception 'Enter an invite code'; end if;
  select id into gid from groups where invite_code = v_code;
  if gid is null then raise exception 'That invite code doesn''t exist — check it with your friend'; end if;
  insert into group_members (group_id, user_id) values (gid, auth.uid()) on conflict do nothing;
  return gid;
end $$;

-- Budget: admins only, friendly errors.
create or replace function public.set_budget(p_group_id uuid, p_budget bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_group_id) then raise exception 'Only the group admin can set the budget'; end if;
  if p_budget is not null and (p_budget <= 0 or p_budget > 100000000000) then raise exception 'Enter a budget between ₹1 and ₹100 crore'; end if;
  update groups set budget_paise = p_budget where id = p_group_id;
end $$;

-- Leave / remove a member: blocks if they still owe or are owed money, keeps an admin around.
create or replace function public.remove_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  bal bigint;
  admins int;
begin
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if p_user_id <> auth.uid() and not is_admin(p_group_id) then raise exception 'Only the admin can remove people'; end if;
  if not is_member(p_group_id, p_user_id) then return; end if;

  select coalesce((select sum(amount_paise) from expenses where group_id = p_group_id and paid_by = p_user_id), 0)
       - coalesce((select sum(s.share_paise) from expense_splits s join expenses e on e.id = s.expense_id
                   where e.group_id = p_group_id and s.user_id = p_user_id), 0)
       + coalesce((select sum(amount_paise) from settlements where group_id = p_group_id and from_user = p_user_id), 0)
       - coalesce((select sum(amount_paise) from settlements where group_id = p_group_id and to_user = p_user_id), 0)
    into bal;
  if bal <> 0 then raise exception 'Settle up first — balance must be ₹0 before leaving'; end if;

  delete from group_members where group_id = p_group_id and user_id = p_user_id;

  -- if the last admin left, promote the longest-standing member
  select count(*) into admins from group_members where group_id = p_group_id and role = 'admin';
  if admins = 0 then
    update group_members set role = 'admin'
     where (group_id, user_id) = (select group_id, user_id from group_members where group_id = p_group_id order by joined_at limit 1);
  end if;
end $$;

-- ---------------------------------------------------------------- expenses
create or replace function public.save_expense(
  p_group_id     uuid,
  p_description  text,
  p_amount       bigint,
  p_paid_by      uuid,
  p_category     text,
  p_split_type   text,
  p_date         date,
  p_splits       jsonb,
  p_notes        text default null,
  p_expense_id   uuid default null,
  p_items        jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  eid uuid;
  total bigint;
  bad int;
  v_desc  text := coalesce(nullif(left(trim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g')), 120), ''), 'Expense');
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 500), '');
  v_type  text := case when p_split_type in ('equal','exact','percent','shares','itemized') then p_split_type else 'exact' end;
  v_cat   text := coalesce(nullif(left(trim(coalesce(p_category, '')), 30), ''), 'other');
  v_date  date := least(coalesce(p_date, current_date), current_date + 1);
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above ₹0'; end if;
  if p_amount > 100000000000 then raise exception 'That amount is too large'; end if;
  if p_paid_by is null or not is_member(p_group_id, p_paid_by) then raise exception 'The person who paid is not in this group'; end if;
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'Pick at least one person to split with';
  end if;

  -- every row needs a valid user + non-negative whole-paise share
  select count(*) into bad from jsonb_array_elements(p_splits) x
   where (x->>'user_id') is null
      or (x->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (x->>'share_paise') is null
      or (x->>'share_paise') !~ '^\d+$';
  if bad > 0 then raise exception 'Split amounts look invalid — please re-enter them'; end if;

  select count(*) into bad from jsonb_array_elements(p_splits) x
   where not is_member(p_group_id, (x->>'user_id')::uuid);
  if bad > 0 then raise exception 'Someone in the split has left this group — untick them and try again'; end if;

  select coalesce(sum((x->>'share_paise')::bigint), 0) into total from jsonb_array_elements(p_splits) x;
  if total <> p_amount then
    raise exception 'Shares add up to ₹% but the total is ₹%', round(total / 100.0, 2), round(p_amount / 100.0, 2);
  end if;

  if p_expense_id is null then
    insert into expenses (group_id, description, amount_paise, paid_by, category, split_type,
                          expense_date, notes, items, created_by)
    values (p_group_id, v_desc, p_amount, p_paid_by, v_cat, v_type, v_date, v_notes, p_items, auth.uid())
    returning id into eid;
  else
    update expenses set description = v_desc, amount_paise = p_amount, paid_by = p_paid_by, category = v_cat,
           split_type = v_type, expense_date = v_date, notes = v_notes, items = p_items
     where id = p_expense_id and group_id = p_group_id
       and (created_by = auth.uid() or paid_by = auth.uid() or is_admin(p_group_id))
    returning id into eid;
    if eid is null then raise exception 'Only the person who added or paid for this (or the admin) can edit it'; end if;
    delete from expense_splits where expense_id = eid;
  end if;

  -- merge duplicate rows for the same person instead of failing on the primary key
  insert into expense_splits (expense_id, user_id, share_paise)
  select eid, (x->>'user_id')::uuid, sum((x->>'share_paise')::bigint)
  from jsonb_array_elements(p_splits) x
  group by (x->>'user_id')::uuid
  having sum((x->>'share_paise')::bigint) > 0;

  return eid;
end $$;

create or replace function public.delete_expense(p_expense_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid; cb uuid; pb uuid;
begin
  select group_id, created_by, paid_by into gid, cb, pb from expenses where id = p_expense_id;
  if gid is null then return; end if; -- already gone
  if not is_member(gid) then raise exception 'You are not in this group'; end if;
  if not (cb = auth.uid() or pb = auth.uid() or is_admin(gid)) then
    raise exception 'Only the person who added or paid for this (or the admin) can delete it';
  end if;
  delete from expenses where id = p_expense_id;
end $$;

-- ---------------------------------------------------------------- settlements
create or replace function public.record_settlement(
  p_group_id uuid, p_from uuid, p_to uuid, p_amount bigint, p_method text default 'cash', p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Pick two different people'; end if;
  if auth.uid() not in (p_from, p_to) then raise exception 'You can only record payments you made or received'; end if;
  if not is_member(p_group_id, p_from) or not is_member(p_group_id, p_to) then raise exception 'Both people must be in this group'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above ₹0'; end if;
  if p_amount > 100000000000 then raise exception 'That amount is too large'; end if;
  insert into settlements (group_id, from_user, to_user, amount_paise, method, note, created_by)
  values (p_group_id, p_from, p_to, p_amount,
          case when p_method in ('cash','upi','bank','other') then p_method else 'other' end,
          nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid())
  returning id into sid;
  return sid;
end $$;

-- ---------------------------------------------------------------- permissions
revoke all on function public.set_budget(uuid, bigint) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.delete_expense(uuid) from public, anon;
revoke all on function public.record_settlement(uuid, uuid, uuid, bigint, text, text) from public, anon;
grant execute on function public.set_budget(uuid, bigint), public.remove_member(uuid, uuid),
  public.delete_expense(uuid), public.record_settlement(uuid, uuid, uuid, bigint, text, text) to authenticated;
