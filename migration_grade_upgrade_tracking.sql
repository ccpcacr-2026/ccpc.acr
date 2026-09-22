-- Tracking higher grades (উচ্চতর গ্রেড) apart from every other grade change.
--
-- Article 6 of the 2026 order counts from real events: the first higher
-- grade falls due on the eighth year of unpromoted service, the second six
-- years after the FIRST ONE WAS GRANTED — not six years after any other
-- edit to someone's grade. So a grade-history row now says what kind of
-- change it was, and only 'higher_grade' rows count towards the clock:
--
--   joining      — the row that records where they started
--   promotion    — a real promotion to another post; restarts the 8-year clock
--   higher_grade — article 6; counts, and never happens twice on one date
--   fixation     — moving onto a new National Pay Scale
--   correction   — fixing a typo or a wrong step; must never count
--
-- Run this in the Supabase SQL editor after migration_nps2026.sql.

alter table payroll.person_grade_history
  add column if not exists change_kind text;

-- Rows written before this migration are ordinary edits as far as article 6
-- is concerned; anything genuinely a higher grade can be marked by hand
-- afterwards (People Setup shows the kind on each history row).
update payroll.person_grade_history
   set change_kind = 'correction'
 where change_kind is null;

-- One person cannot be given the same higher grade twice on the same date,
-- whichever screen asks for it — the stage button and the step-up
-- suggestion both end up here.
create unique index if not exists person_grade_history_upgrade_uidx
  on payroll.person_grade_history (user_id, effective_date)
  where change_kind = 'higher_grade';

create index if not exists person_grade_history_kind_idx
  on payroll.person_grade_history (user_id, change_kind, effective_date);
