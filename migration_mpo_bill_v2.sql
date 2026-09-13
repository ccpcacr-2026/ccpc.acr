-- Simplifies MPO Bill to reuse the SAME Grade/Step/Basic chart already
-- built for the internal payroll system, instead of a second, separate
-- one — per explicit correction: "there is no need of any extra pay
-- scale chart, the chart is same as grade system already built." A
-- person's MPO-relevant Grade+Step is simply a separate, independent
-- selection into that SAME shared payroll.grades/pay_steps/
-- grade_step_values matrix — never synced with their actual college
-- Grade+Step, since (per the user) "mpo is paid by the govt... but
-- college is paying much more than that." Only the MPO-specific rate
-- schedule (Incentive/House Rent/Welfare/Retirement/Medical — concepts
-- the internal grade system has no equivalent of) needs new columns,
-- added directly onto payroll.grades.
--
-- Run in Supabase SQL editor. Safe to run even though mpo_roster already
-- exists — it's still empty (nobody's been added to it yet), so nothing
-- is lost by dropping the mpo_grades/mpo_steps/mpo_grade_step_values
-- tables created by the first migration; their already-entered rates are
-- carried over onto the matching real Grade first.

alter table payroll.grades add column if not exists mpo_incentive_percent numeric;
alter table payroll.grades add column if not exists mpo_house_rent_percent numeric;
alter table payroll.grades add column if not exists mpo_house_rent_min numeric;
alter table payroll.grades add column if not exists mpo_welfare_percent numeric;
alter table payroll.grades add column if not exists mpo_retirement_percent numeric;
alter table payroll.grades add column if not exists mpo_medical_amount numeric;

-- Carries the rates already entered on the now-superseded mpo_grades
-- table onto whichever real Grade shares that Pay Code's number in its
-- name (this school's Grades happen to already be named "Grade 6",
-- "Grade 8" etc., matching the two sample MPO bills' pay codes exactly).
update payroll.grades g set
  mpo_incentive_percent = m.mpo_incentive_percent,
  mpo_house_rent_percent = m.mpo_house_rent_percent,
  mpo_house_rent_min = m.mpo_house_rent_min,
  mpo_welfare_percent = m.mpo_welfare_percent,
  mpo_retirement_percent = m.mpo_retirement_percent,
  mpo_medical_amount = m.mpo_medical_amount
from payroll.mpo_grades m
where g.name = 'Grade ' || m.pay_code;

alter table payroll.mpo_roster add column if not exists grade_id bigint references payroll.grades(id) on delete set null;
alter table payroll.mpo_roster add column if not exists step_id bigint references payroll.pay_steps(id) on delete set null;
alter table payroll.mpo_roster drop column if exists mpo_grade_id;
alter table payroll.mpo_roster drop column if exists mpo_step_id;

drop table if exists payroll.mpo_grade_step_values;
drop table if exists payroll.mpo_steps;
drop table if exists payroll.mpo_grades;

notify pgrst, 'reload schema';
