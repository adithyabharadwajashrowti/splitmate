-- SplitMate 004: save_expense cleans the description itself (collapse spaces, max 120 chars, never empty)
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
  s jsonb;
  v_desc text := coalesce(nullif(left(trim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g')), 120), ''), 'Expense');
  v_notes text := nullif(left(trim(coalesce(p_notes, '')), 500), '');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not is_member(p_group_id) then raise exception 'You are not in this group'; end if;
  if not is_member(p_group_id, p_paid_by) then raise exception 'Payer is not in this group'; end if;
  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) = 0 then
    raise exception 'At least one person must share the expense';
  end if;

  select coalesce(sum((x->>'share_paise')::bigint), 0) into total from jsonb_array_elements(p_splits) x;
  if total <> p_amount then
    raise exception 'Splits (%) do not add up to the total (%)', total, p_amount;
  end if;

  for s in select * from jsonb_array_elements(p_splits) loop
    if not is_member(p_group_id, (s->>'user_id')::uuid) then
      raise exception 'Someone in the split is not in this group';
    end if;
  end loop;

  if p_expense_id is null then
    insert into expenses (group_id, description, amount_paise, paid_by, category, split_type,
                          expense_date, notes, items, created_by)
    values (p_group_id, v_desc, p_amount, p_paid_by, coalesce(p_category,'other'),
            p_split_type, coalesce(p_date, current_date), v_notes, p_items, auth.uid())
    returning id into eid;
  else
    update expenses set description = v_desc, amount_paise = p_amount,
           paid_by = p_paid_by, category = coalesce(p_category,'other'), split_type = p_split_type,
           expense_date = coalesce(p_date, current_date), notes = v_notes, items = p_items
     where id = p_expense_id and group_id = p_group_id
       and (created_by = auth.uid() or paid_by = auth.uid() or is_admin(p_group_id))
    returning id into eid;
    if eid is null then raise exception 'Expense not found or not editable by you'; end if;
    delete from expense_splits where expense_id = eid;
  end if;

  insert into expense_splits (expense_id, user_id, share_paise)
  select eid, (x->>'user_id')::uuid, (x->>'share_paise')::bigint
  from jsonb_array_elements(p_splits) x
  where (x->>'share_paise')::bigint > 0;

  return eid;
end $$;
