-- Adds a per-option array of EVERY scan timestamp (not just the latest),
-- so the Applications/Scan Data columns can show "show all if multi
-- scanned" instead of only the current value's single scanned_at.
-- scan_values[key] stays the CURRENT value (unchanged shape/behavior);
-- scan_dates[key] is the full, append-only timeline for that option.
alter table admission.admission_applications
  add column if not exists scan_dates jsonb not null default '{}'::jsonb;

-- One-time, re-runnable backfill from the existing append-only
-- scan_option_history log, so history that already happened before this
-- column existed isn't lost.
with per_option as (
  select candidate_id, option_key, jsonb_agg(scanned_at order by scanned_at asc) as dates
  from admission.scan_option_history
  group by candidate_id, option_key
),
per_candidate as (
  select candidate_id, jsonb_object_agg(option_key, dates) as all_dates
  from per_option
  group by candidate_id
)
update admission.admission_applications a
set scan_dates = per_candidate.all_dates
from per_candidate
where a.id = per_candidate.candidate_id
  and a.scan_dates = '{}'::jsonb;

notify pgrst, 'reload schema';
