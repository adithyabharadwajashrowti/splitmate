-- SplitMate 008: remember (per account, across devices) that a user has seen the welcome tour.
alter table public.profiles add column if not exists tour_done boolean not null default false;
