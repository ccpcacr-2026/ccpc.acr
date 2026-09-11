-- Lets a Section entry (Loan and Advance, etc.) attach to a specific
-- payroll Field instead of just adding/deducting a lump sum — the entry's
-- computed amount then becomes that field's own value for the person (same
-- precedence as a manual person_field_values override), so it shows up
-- under that field's column everywhere (Payroll Export, Acquittance Roll)
-- instead of only ever appearing as an unattributed line in Total
-- Deductions. Direction (add vs deduct) then comes from the field's own
-- category, not the section's fixed direction — a deduction field means
-- "loan repayment," an addition field means "allowance under this section."
--
-- mode distinguishes three payment shapes:
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
-- Run in Supabase SQL editor.

alter table payroll.section_entries add column if not exists field_id bigint references payroll.fields(id) on delete set null;
alter table payroll.section_entries add column if not exists mode text not null default 'emi';
alter table payroll.section_entries add constraint section_entries_mode_check check (mode in ('emi', 'one_time', 'recurring')) not valid;
alter table payroll.section_entries validate constraint section_entries_mode_check;
alter table payroll.section_entries alter column total_amount drop not null;

notify pgrst, 'reload schema';
