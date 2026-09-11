-- Lets a Section (Loan and Advance, etc.) attach to a specific payroll
-- Field instead of just adding/deducting a lump sum — every entry added
-- under that section then has its computed amount become that field's own
-- value for the person (same precedence as a manual person_field_values
-- override), so it shows up under that field's column everywhere (Payroll
-- Export, Acquittance Roll) instead of only ever appearing as an
-- unattributed line in Total Deductions.
--
-- The field is picked ONCE, on the section itself (not per entry) — a
-- deduction field means "this section is a loan repayment," an addition
-- field means "this section is an allowance," and every entry added under
-- it inherits that automatically. The section's own `direction` is then
-- derived server-side from the field's category rather than chosen
-- separately, so direction is only ever decided in one place.
--
-- section_entries.mode distinguishes three payment shapes:
--   'emi'       existing behavior — total_amount spread over
--               emi_amount/emi_months, auto-completes when paid off.
--   'one_time'  applies to exactly the next payroll calculation, then
--               auto-completes — implemented as an EMI whose total equals
--               one installment (total_amount = emi_amount), so it reuses
--               the exact same finalize/revert bookkeeping as EMI.
--   'recurring' a flat amount every month with no total and nothing to pay
--               off — runs until manually cancelled. total_amount/
--               remaining_amount stay null and are never touched by
--               approve_run/revert_run_to_draft.
--
-- section_entries.paid_installments is a running count of installments
-- actually paid — seeded from the "Installments Already Paid" input when an
-- EMI entry is set up for a loan that already had some paid before it
-- existed in this system, then incremented by approve_run (decremented by
-- revert_run_to_draft) exactly alongside remaining_amount, so it's always
-- an accurate "X of Y paid" figure for loan-statement remarks (see
-- _prResolveLoanRemarkRule) without drifting out of sync with the balance.
--
-- Run in Supabase SQL editor.

alter table payroll.sections add column if not exists field_id bigint references payroll.fields(id) on delete set null;

-- Defensive: an earlier draft of this migration put field_id on
-- section_entries instead. Drop it there if present, so the link only ever
-- lives in the one place (the section) the app now reads it from.
alter table payroll.section_entries drop column if exists field_id;

alter table payroll.section_entries add column if not exists mode text not null default 'emi';
do $$ begin
  alter table payroll.section_entries add constraint section_entries_mode_check check (mode in ('emi', 'one_time', 'recurring')) not valid;
exception when duplicate_object then null;
end $$;
alter table payroll.section_entries validate constraint section_entries_mode_check;
alter table payroll.section_entries alter column total_amount drop not null;
-- 'recurring' mode (and a 'per_unit' section's entries — see
-- migration_section_child_allowance.sql) always leave remaining_amount
-- null (no total to pay off), same as total_amount above. Missing this
-- meant NO recurring-style entry could ever be saved at all.
alter table payroll.section_entries alter column remaining_amount drop not null;
alter table payroll.section_entries add column if not exists paid_installments integer not null default 0;

notify pgrst, 'reload schema';
