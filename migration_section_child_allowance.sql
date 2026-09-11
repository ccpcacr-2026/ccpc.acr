-- Lets a Section (picked once, same place as its Field link — see
-- migration_section_entry_fields.sql) calculate its entries' amounts from
-- a COUNT of something instead of a typed-in amount: "Education Support"
-- is Tk 500 per child studying at the school, capped at 2 children (the
-- real policy behind the Education field, confirmed against live data —
-- 151 people already have a manual education value of exactly 500 or
-- 1000). What's being counted is admin-defined (children, sessions,
-- dependents, whatever the next such need turns out to be) via
-- unit_singular/unit_plural, not hardcoded to children specifically.
--
-- Neither the rate, the cap, nor unit_count is ever frozen into a stored
-- amount — _computePayslipForPerson computes unit_rate x
-- min(unit_count, unit_max) fresh every payroll run, so a policy change
-- on the section (rate goes up, cap changes) applies to every entry
-- under it immediately, with nothing to re-save on any entry.
--
-- calc_style:
--   'amount'    existing behavior — entries specify EMI/One-Time/Recurring
--               amounts directly (see migration_section_entry_fields.sql).
--   'per_unit'  entries specify only a count; unit_rate/unit_max/
--               unit_singular/unit_plural on the section do the rest.
--               Always behaves like a 'recurring' entry (ongoing, no
--               total to pay off) since a count-based allowance has no
--               fixed payoff amount.
--
-- Run in Supabase SQL editor.

alter table payroll.sections add column if not exists calc_style text not null default 'amount';
do $$ begin
  alter table payroll.sections add constraint sections_calc_style_check check (calc_style in ('amount', 'per_unit')) not valid;
exception when duplicate_object then null;
end $$;
alter table payroll.sections validate constraint sections_calc_style_check;
alter table payroll.sections add column if not exists unit_rate numeric;
alter table payroll.sections add column if not exists unit_max integer;
alter table payroll.sections add column if not exists unit_singular text not null default 'Child';
alter table payroll.sections add column if not exists unit_plural text not null default 'Children';

alter table payroll.section_entries add column if not exists unit_count integer;

notify pgrst, 'reload schema';
