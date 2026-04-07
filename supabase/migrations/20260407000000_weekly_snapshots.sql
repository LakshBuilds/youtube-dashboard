-- Weekly snapshots for "this week vs last week" in Weekly Summary.
-- Run in Supabase SQL Editor if you use hosted DB without CLI.

create table if not exists public.weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  total_views bigint not null default 0,
  total_videos integer not null default 0,
  total_likes bigint not null default 0,
  total_comments bigint not null default 0,
  total_payout numeric,
  created_at timestamptz default now(),
  constraint weekly_snapshots_week_start_date_key unique (week_start_date)
);

create index if not exists weekly_snapshots_week_start_date_idx on public.weekly_snapshots (week_start_date desc);

alter table public.weekly_snapshots enable row level security;

drop policy if exists "weekly_snapshots_select_anon" on public.weekly_snapshots;
drop policy if exists "weekly_snapshots_insert_anon" on public.weekly_snapshots;
drop policy if exists "weekly_snapshots_update_anon" on public.weekly_snapshots;

-- Clerk auth: browser uses anon key; allow read/write for dashboard (tighten later with a service role or JWT bridge if needed).
create policy "weekly_snapshots_select_anon"
  on public.weekly_snapshots for select
  to anon, authenticated
  using (true);

create policy "weekly_snapshots_insert_anon"
  on public.weekly_snapshots for insert
  to anon, authenticated
  with check (true);

create policy "weekly_snapshots_update_anon"
  on public.weekly_snapshots for update
  to anon, authenticated
  using (true)
  with check (true);
