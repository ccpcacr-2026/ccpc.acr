-- Lets a Section (picked once, same place as its Field link — see
-- migration_section_entry_fields.sql) calculate its entries' amounts from a
-- number of children instead of a typed-in amount: "Education Support" is
-- Tk 500 per child studying at the school, capped at 2 children, and that
-- policy (rate + cap) can change over time — so rather than freezing a
-- computed number into person_field_values (which then goes stale the
-- moment a child count or the policy changes), the section stores the
-- rate/cap and each entry stores only the child count. The amount is
-- computed FRESH every payroll run from current rate x count (capped) —
-- see _computePayslipForPerson — so a rate/cap change on the section
-- immediately applies to every entry under it on the next run, with
-- nothing to re-save by hand.
--
-- calc_style:
--   'amount'    existing behavior — entries specify EMI/One-Time/Recurring
--               amounts directly (see migration_section_entry_fields.sql).
--   'per_child' entries specify only a child count; child_rate/child_max
--               on the section do the rest. Always behaves like a
--               'recurring' entry (ongoing, no total to pay off) since an
--               enrollment allowance has no fixed payoff amount.
--
-- Run in Supabase SQL editor.

alter table payroll.sections add column if not exists calc_style text not null default 'amount';
do $$ begin
  alter table payroll.sections add constraint sections_calc_style_check check (calc_style in ('amount', 'per_child')) not valid;
exception when duplicate_object then null;
end $$;
alter table payroll.sections validate constraint sections_calc_style_check;
alter table payroll.sections add column if not exists child_rate numeric;
alter table payroll.sections add column if not exists child_max integer;

alter table payroll.section_entries add column if not exists children_count integer;

notify pgrst, 'reload schema';
