-- Tracking higher grades (উচ্চতর গ্রেড) apart from every other grade change.
--
-- Article 6 of the 2026 order counts from real events: the first higher
-- grade falls due on the eighth year of unpromoted service, the second six
-- years after the FIRST ONE WAS GRANTED — not six years after any other
-- edit to someone's grade. So a grade-history row now says what kind of
-- change it was, and only 'higher_grade' rows count towards the clock:
--
--   joining         — the row that records where they started
--   promotion       — a real promotion to another post; restarts the 8-year clock
--   higher_grade    — article 6; counts, and never happens twice on one date
--   time_scale      — a higher scale (টাইম স্কেল) under an earlier pay scale
--   selection_grade — a selection grade under an earlier pay scale
--   senior_scale    — a senior scale under an earlier pay scale
--   fixation        — moving onto a new National Pay Scale
--   correction      — fixing a typo or a wrong step; must never count
--   unknown         — a row from before this column existed
--
-- Article 6(4) puts the three older schemes on the same footing as the new
-- higher grade: two of them in the same post and no further grade is due at
-- all; one, and only the second is left, six years after it was given
-- (art. 6(5)). Record what was already given with the "Had one" button in
-- Payroll Admin -> Grades -> Pay Fixation.
--
-- Run this in the Supabase SQL editor after migration_nps2026.sql.

alter table payroll.person_grade_history
  add column if not exists change_kind text;

-- Rows written before this migration are marked 'unknown', not 'correction':
-- we genuinely do not know what they were, and several of them are real
-- promotion dates taken from the August 2026 salary sheets
-- (migration_join_promotion_dates.sql). 'unknown' does not count towards
-- article 6 — only an explicit higher_grade/time_scale/selection_grade/
-- senior_scale row does — but it does still print in the payroll sheet's
-- stacked date column, which 'correction' would have hidden.
update payroll.person_grade_history
   set change_kind = 'unknown'
 where change_kind is null;

-- One person cannot be given the same higher grade twice on the same date,
-- whichever screen asks for it — the stage button and the step-up
-- suggestion both end up here.
create unique index if not exists person_grade_history_upgrade_uidx
  on payroll.person_grade_history (user_id, effective_date)
  where change_kind = 'higher_grade';

create index if not exists person_grade_history_kind_idx
  on payroll.person_grade_history (user_id, change_kind, effective_date);
