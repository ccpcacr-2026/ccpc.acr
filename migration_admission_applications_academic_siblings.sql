-- The Application editor's "Tables" tab (academic history rows + sibling
-- rows) has always sent academic_records/siblings as top-level fields in
-- saveApplication's payload (app/api/admission-admin/route.js forwards the
-- client's `data` object straight through to PostgREST with no column
-- filtering), but these two columns were never actually created on
-- admission.admission_applications -- any save that touched either tab
-- failed with PGRST204 ("Could not find the column ... in the schema
-- cache"), reported live. Modeled as jsonb arrays (each row is a small
-- object: exam/year/board/roll/result for academic rows, matching
-- _admCollectTableRows's own column list in _src/app.js).
alter table admission.admission_applications
  add column if not exists academic_records jsonb not null default '[]'::jsonb,
  add column if not exists siblings jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
