-- Fixes person_field_overrides from a dead mechanism into a real one, and
-- extends it with "Reference Basic" — a per-person pin of exactly which
-- Grade+Step's Basic a percent_of_field field (Incentive, etc.) computes
-- against, independent of the person's own actual current grade/step.
--
-- Confirmed via a live query before this migration: person_field_overrides
-- has 0 rows today, and _resolveFieldConfig (app/api/payroll-admin/
-- route.js) never reads it at all — it's saved-but-ignored dead code, not
-- a regression. Safe to wire up with nothing to reconcile.
--
-- The business rule (Incentive, but works for any percent_of_field field):
-- a person's Incentive is a percentage of the Basic at whichever Grade+Step
-- they were sitting at when Incentive started for them — NOT their current
-- Basic, and NOT necessarily the same Grade as anyone else on the same
-- rule. That reference stays fixed through ordinary step increments and is
-- only manually re-pointed at a NEW Grade+Step when the person is promoted
-- — it never auto-follows.
--
-- reference_grade_id/reference_step_id null (the default) = "Current":
-- unchanged existing behavior, the field resolves against the person's own
-- live grade/step like every other field. Both set = "Pinned": the
-- field's percentage is computed against that exact Grade+Step's Basic
-- (via payroll.grade_step_values) instead, regardless of the person's
-- actual grade — see _resolveFieldValue's percent_of_field branch.
--
-- Run in Supabase SQL editor.

alter table payroll.person_field_overrides add column if not exists reference_grade_id bigint references payroll.grades(id) on delete set null;
alter table payroll.person_field_overrides add column if not exists reference_step_id bigint references payroll.pay_steps(id) on delete set null;

notify pgrst, 'reload schema';
