-- =====================================================================
-- SplitMate — initial schema
-- Run this ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run
--
-- What it creates:
--   profiles         one row per user (name, UPI ID). Auto-created on sign-up.
--   groups           a trip / flat / friend group. Has a short invite code.
--   group_members    who is in which group.
--   expenses         one bill (amount stored in PAISE as an integer — no float errors).
--   expense_splits   how much of that bill each person owes.
--   settlements      "A paid B ₹500" repayments.
--
-- Security: Row Level Security (RLS) is ON for every table, so a user can
-- only ever read/write data for groups they belong to — even if someone
-- copies your public anon key.
-- Writes that touch several tables (adding an expense, joining a group)
-- go through database functions so they are all-or-nothing.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  diet          text check (diet is null or diet in ('veg','nonveg','egg','vegan')),
  upi_id        text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,64}$'),
  created_at    timestamptz not null default now()
);

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  emoji        text not null default '👥',
  currency     text not null default 'INR',
  invite_code  text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);

create table public.group_members (
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin','member')),
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  description   text not null check (char_length(description) between 1 and 120),
  amount_paise  bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  paid_by       uuid not null references public.profiles(id),
  category      text not null default 'other',
  split_type    text not null check (split_type in ('equal','exact','percent','shares','itemized')),
  expense_date  date not null default current_date,
  notes         text check (notes is null or char_length(notes) <= 500),
  -- itemized bills: {"items":[{"name","amount_paise","weights":{uid:n}}],"tax_paise","service_paise","tip_paise","discount_paise"}
  items         jsonb,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index on public.expenses (group_id, expense_date desc);

create table public.expense_splits (
  expense_id   uuid not null references public.expenses(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  share_paise  bigint not null check (share_paise >= 0),
  primary key (expense_id, user_id)
);

create table public.settlements (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  from_user     uuid not null references public.profiles(id),
  to_user       uuid not null references public.profiles(id),
  amount_paise  bigint not null check (amount_paise > 0),
  method        text not null default 'cash' check (method in ('cash','upi','bank','other')),
  note          text check (note is null or char_length(note) <= 200),
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  check (from_user <> to_user)
);
create index on public.settlements (group_id, created_at desc);

-- ------------------------------------------------- helper functions (RLS)
-- SECURITY DEFINER so policies can check membership without recursion.

create or replace function public.is_member(gid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = uid);
$$;

create or replace function public.is_admin(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members
                 where group_id = gid and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.shares_group_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members a
                 join group_members b on a.group_id = b.group_id
                 where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ---------------------------------------------------------------- triggers

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id,
          left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
                        split_part(new.email, '@', 1), 'Friend'), 40));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The person who creates a group becomes its admin.
create or replace function public.handle_new_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into group_members (group_id, user_id, role) values (new.id, new.created_by, 'admin');
  return new;
end $$;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- ---------------------------------------------------------------- RLS

alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements    enable row level security;

-- profiles: see yourself + people you share a group with; edit only yourself
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- groups
create policy groups_select on public.groups for select to authenticated
  using (public.is_member(id));
create policy groups_insert on public.groups for insert to authenticated
  with check (created_by = auth.uid());
create policy groups_update on public.groups for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));
create policy groups_delete on public.groups for delete to authenticated
  using (public.is_admin(id));

-- group_members: joining happens through join_group(); you can leave, admins can remove
create policy members_select on public.group_members for select to authenticated
  using (public.is_member(group_id));
create policy members_delete on public.group_members for delete to authenticated
  using (user_id = auth.uid() or public.is_admin(group_id));

-- expenses: read if member; create via create_expense(); delete if you created/paid it or are admin
create policy expenses_select on public.expenses for select to authenticated
  using (public.is_member(group_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_member(group_id)
         and (created_by = auth.uid() or paid_by = auth.uid() or public.is_admin(group_id)));

create policy splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e
                 where e.id = expense_id and public.is_member(e.group_id)));

-- settlements: you can record a payment you made or received
create policy settlements_select on public.settlements for select to authenticated
  using (public.is_member(group_id));
create policy settlements_insert on public.settlements for insert to authenticated
  with check (created_by = auth.uid()
              and (from_user = auth.uid() or to_user = auth.uid())
              and public.is_member(group_id, from_user)
              and public.is_member(group_id, to_user));
create policy settlements_delete on public.settlements for delete to authenticated
  using (created_by = auth.uid() or public.is_admin(group_id));

-- ---------------------------------------------------------------- RPCs

-- Join a group with its invite code. Returns the group id.
create or replace function public.join_group(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into gid from groups where invite_code = upper(trim(code));
  if gid is null then raise exception 'Invalid invite code'; end if;
  insert into group_members (group_id, user_id) values (gid, auth.uid())
  on conflict do nothing;
  return gid;
end $$;

-- Create a group (you become admin via the trigger). Returns the group id.
create or replace function public.create_group(p_name text, p_emoji text default '👥')
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into groups (name, emoji, created_by)
  values (trim(p_name), coalesce(nullif(p_emoji, ''), '👥'), auth.uid())
  returning id into gid;
  return gid;
end $$;

-- Add (or replace) an expense and its splits in one transaction.
-- p_splits: [{"user_id": "...", "share_paise": 12345}, ...] — must add up to p_amount.
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
  p_expense_id   uuid default null,  -- pass to edit an existing expense
  p_items        jsonb default null  -- itemized bill details (for display/editing)
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  eid uuid;
  total bigint;
  s jsonb;
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
    values (p_group_id, trim(p_description), p_amount, p_paid_by, coalesce(p_category,'other'),
            p_split_type, coalesce(p_date, current_date), p_notes, p_items, auth.uid())
    returning id into eid;
  else
    update expenses set description = trim(p_description), amount_paise = p_amount,
           paid_by = p_paid_by, category = coalesce(p_category,'other'), split_type = p_split_type,
           expense_date = coalesce(p_date, current_date), notes = p_notes, items = p_items
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

-- Only signed-in users may call the RPCs.
revoke all on function public.create_group(text,text) from public, anon;
grant execute on function public.create_group(text,text) to authenticated;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.save_expense(uuid,text,bigint,uuid,text,text,date,jsonb,text,uuid,jsonb) from public, anon;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.save_expense(uuid,text,bigint,uuid,text,text,date,jsonb,text,uuid,jsonb) to authenticated;

-- ---------------------------------------------------------------- realtime
-- Lets everyone in a group see new expenses instantly.
alter publication supabase_realtime add table public.expenses, public.settlements, public.group_members;

-- ---------------------------------------------------------------- dashboard
-- Every group I'm in, with my net balance (positive = I'm owed).
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
  order by 7 desc;
$$;
revoke all on function public.my_groups() from public, anon;
grant execute on function public.my_groups() to authenticated;

-- ---------------------------------------------------------------- bill scanning
-- Usage log for the AI bill scanner (used for a per-user daily limit).
-- No policies = only the server (Edge Function with the service key) can touch it.
create table public.bill_scans (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index on public.bill_scans (user_id, created_at desc);
alter table public.bill_scans enable row level security;
