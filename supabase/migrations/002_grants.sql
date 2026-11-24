-- SplitMate 002: table permissions for logged-in users (RLS in 001 still controls rows).
grant usage on schema public to authenticated, service_role;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.groups, public.group_members, public.expenses,
  public.expense_splits, public.settlements to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.is_member(uuid, uuid), public.is_admin(uuid), public.shares_group_with(uuid) to authenticated;
