-- SplitMate 003: optional trip budget per group (admins can set it from the group page)
alter table public.groups add column if not exists budget_paise bigint check (budget_paise is null or budget_paise > 0);
