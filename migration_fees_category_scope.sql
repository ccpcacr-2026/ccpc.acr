-- Adds student category (Civil / Army / Retired Army / Defense /
-- Teacher-Staff Child) as a scope dimension on the fee chart.
--
-- The category now lives on students_data.student_category, imported
-- from the office's "Nur to Ten" roster export (column K,
-- StudentCatName) and kept verbatim — all five source values, not
-- collapsed into two, so Retired Army or Defense can be priced
-- differently from serving Army later without re-importing anything.
--
-- Same convention as the other scope columns: null/'' means "any", so
-- a chart row with student_category set applies only to that category
-- and one with it blank applies to every category.
--
-- Run in the Supabase SQL editor, after migration_fees_chart.sql.

alter table student.fee_structures
  add column if not exists student_category text;

comment on column student.fee_structures.student_category is
  'students_data.student_category (Civil / Army / Retired Army / Defense / Teacher/Staff Child). Null or '''' = applies to any category.';

notify pgrst, 'reload schema';
