-- Optional integrity: UNIQUE(week_start_date). App no longer requires this (uses update/insert by week).
-- If ADD fails with "duplicate key", delete duplicate rows for the same week first, then re-run.

alter table public.weekly_snapshots
  drop constraint if exists weekly_snapshots_week_start_date_key;

alter table public.weekly_snapshots
  add constraint weekly_snapshots_week_start_date_key unique (week_start_date);
