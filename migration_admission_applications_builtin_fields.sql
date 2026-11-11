-- Fixes PGRST204 "Could not find the 'guardian_nid' column... in the schema
-- cache": BUILTIN_FORM_FIELDS (app/api/admission-admin/route.js) lists 44
-- field keys as real, already-existing columns on admission_applications --
-- an assumption inherited from the original ccpc-admission port, never
-- actually verified column-by-column against the live table (the exact same
-- class of mistake as extra_fields turning out not to exist, fixed earlier
-- in migration_admission_applications_merge_candidates.sql). guardian_nid
-- was the first to surface via a real VortiBD sync attempt; rather than
-- fix these one at a time as each one is hit, explicitly guarantee every
-- one of them exists, as a plain text column (matches how every other
-- optional native field here is stored -- the admin editor and the Excel
-- import path both always write plain strings, so this is never a lossy
-- change even for a column that does already exist with this type).
alter table admission.admission_applications
  add column if not exists name_english text,
  add column if not exists name_bangla text,
  add column if not exists date_of_birth text,
  add column if not exists gender text,
  add column if not exists blood_group text,
  add column if not exists religion text,
  add column if not exists birth_reg_no text,
  add column if not exists nationality text,
  add column if not exists emergency_contact text,
  add column if not exists height text,
  add column if not exists last_class text,
  add column if not exists last_version text,
  add column if not exists last_institute text,
  add column if not exists present_address text,
  add column if not exists permanent_address text,
  add column if not exists co_curricular text,
  add column if not exists student_photo text,
  add column if not exists father_name text,
  add column if not exists father_profession text,
  add column if not exists father_designation text,
  add column if not exists father_education text,
  add column if not exists father_contact text,
  add column if not exists father_nid text,
  add column if not exists father_office_address text,
  add column if not exists father_yearly_income text,
  add column if not exists father_photo text,
  add column if not exists mother_name text,
  add column if not exists mother_profession text,
  add column if not exists mother_designation text,
  add column if not exists mother_education text,
  add column if not exists mother_contact text,
  add column if not exists mother_nid text,
  add column if not exists mother_office_address text,
  add column if not exists mother_yearly_income text,
  add column if not exists mother_photo text,
  add column if not exists guardian_name text,
  add column if not exists guardian_relation text,
  add column if not exists guardian_profession text,
  add column if not exists guardian_designation text,
  add column if not exists guardian_education text,
  add column if not exists guardian_contact text,
  add column if not exists guardian_office_address text,
  add column if not exists guardian_nid text,
  add column if not exists guardian_photo text;

notify pgrst, 'reload schema';
