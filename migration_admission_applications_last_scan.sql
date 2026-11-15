-- Flat "last scanned" timestamp on admission_applications, stamped by
-- _applyScanValue() on every dynamic Scan Option scan (any behavior --
-- status/tag/form), independent of scan_values' own per-option
-- scanned_at (which 'tag'/'form' behaviors don't always carry). Lets the
-- Applications tab sort/filter by "most recently scanned" uniformly.
alter table admission.admission_applications
  add column if not exists last_scanned_at timestamptz;

-- One-time, re-runnable backfill from the existing append-only scan log,
-- so rows scanned before this column existed aren't all blank.
update admission.admission_applications a
set last_scanned_at = sub.max_at
from (
  select candidate_id, max(scanned_at) as max_at
  from admission.scan_option_history
  group by candidate_id
) sub
where sub.candidate_id = a.id and a.last_scanned_at is null;

notify pgrst, 'reload schema';
