-- Part 7 follow-up: replace the single flat vortibd_sync_interval_minutes
-- with an admin-defined list of time-windows, each with its own interval,
-- e.g. [{"start":"07:00","end":"14:00","interval_minutes":30},
--       {"start":"14:00","end":"07:00","interval_minutes":120}]
-- (a window may wrap past midnight -- start > end means it spans 00:00).
-- The old column is left in place, unused, rather than dropped.

alter table admission.exam_circulars
  add column if not exists vortibd_sync_schedule jsonb not null default '[{"start":"00:00","end":"24:00","interval_minutes":360}]'::jsonb;

-- Admin-set active date range for the sync (e.g. "only during the admission
-- window, Nov 10 - Dec 12") -- both null means no date restriction at all.
alter table admission.exam_circulars
  add column if not exists vortibd_sync_start_date date,
  add column if not exists vortibd_sync_end_date date;

notify pgrst, 'reload schema';
