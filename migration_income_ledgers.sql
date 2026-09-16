-- Real fee-income ledgers, transcribed from the office's actual fee
-- schedule sheets (photographed "AccountName" lists, "-INC" suffix on
-- every item). Nothing in accounts.ledgers existed yet -- the earlier
-- schema migration only seeded the top-level Groups -- so the Bill/
-- Voucher screens had nothing real to select from. This is a first
-- batch (the user will add more later); safe to run again after adding
-- more names to the VALUES list, since it upserts by name.
--
-- All placed under "Direct Income" -- for a school, fee income IS the
-- core/direct business activity, not incidental income. If some of
-- these actually belong under their own sub-group later (e.g. splitting
-- School vs College fee income to match how Payroll already separates
-- them), that's a straightforward group_id update once that structure
-- exists -- not redone here since Accounts' chart of accounts has no
-- such split yet and none was requested.
--
-- Run in Supabase SQL editor, after migration_accounts_schema.sql.

insert into accounts.ledgers (name, group_id, opening_balance)
select v.name, g.id, 0
from (values
  ('Student Affiliation Fee-INC'),
  ('Syllabus Book Fee-INC'),
  ('Library Fee-INC'),
  ('Renovation Fee-INC'),
  ('Family Security Scheme-INC'),
  ('Utility Fee-INC'),
  ('ICT Fee-INC'),
  ('Scout Fee-INC'),
  ('Medical Fee-INC'),
  ('Calendar Fee-INC'),
  ('Gardening Fee-INC'),
  ('Games and Culture Fee-INC'),
  ('ID Card Fee-INC'),
  ('Lab Fee-INC'),
  ('Printing & Stationery Fee-INC'),
  ('Study Tour Fee-INC'),
  ('Magazine Fee-INC'),
  ('Tuition Fee-INC'),
  ('BNCC Fee-INC'),
  ('Maintenance Fee-INC'),
  ('Red Crescent Fee-INC'),
  ('Book Reading Fee-INC'),
  ('Cleaning Fee-INC'),
  ('Beautification Fee-INC'),
  ('Internal Exam Fee-INC'),
  ('Guardian ID Card-INC'),
  ('Improvement Fee-INC'),
  ('Tuition Fee Late Fine-INC'),
  ('Retirement and Welfare Trust Fee-INC'),
  ('Transport Fee-INC'),
  ('Form Fill up Fee-INC'),
  ('Model Test/Preparatory Test Exam-INC'),
  ('Testimonial Fee-INC'),
  ('Sale of Admission Form-INC'),
  ('Exam & Board Fee-INC'),
  ('XI-Nabinboron-INC'),
  ('Science Lab Fee-INC'),
  ('Admission Cancel Fee-INC'),
  ('Report Card Fee-INC'),
  ('Absent Fine-INC'),
  ('Certificate Withdrawal Fee-INC'),
  ('Nobinboron/Farewell Fee-INC'),
  ('Class Party Fee-INC'),
  ('TC Fee-INC'),
  ('Special Admission-INC'),
  ('Board Registration Fee-INC'),
  ('SSC Farewell Fee-INC'),
  ('Science and Technology Fee-INC'),
  ('Diary Fee-INC'),
  ('Repair Fee-INC')
) as v(name)
cross join (select id from accounts.account_groups where name = 'Direct Income') as g
on conflict (name) do nothing;

notify pgrst, 'reload schema';
