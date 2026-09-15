-- Records WHEN a Section entry (a loan/EMI, one-time, or recurring
-- deduction) actually started applying — e.g. "May 2025" — as real,
-- explicit data instead of leaving it buried inside the free-text Note.
-- Needed to correctly answer "how many installments has this loan
-- already had" going forward (today that's only inferable from
-- paid_installments, which stops updating the moment a run is
-- reverted/skipped), and so the admin can see/sort/edit it directly in
-- the Sections UI instead of reading it out of a note.
--
-- Nullable: an entry from before this column existed, or one whose
-- original source never stated a start month, legitimately has no
-- known start date.
--
-- Run in Supabase SQL editor.
alter table payroll.section_entries add column if not exists start_date date;

notify pgrst, 'reload schema';
