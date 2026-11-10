-- VortiBD's "download all candidate photos" export comes as four separate
-- folders: applicant, father, mother, local guardian. exam_candidates only
-- had one photo_url column (the applicant's own photo) -- add the other
-- three so each can be stored and matched independently.
alter table admission.exam_candidates
  add column if not exists father_photo_url text,
  add column if not exists mother_photo_url text,
  add column if not exists guardian_photo_url text;

-- Saved import-mapping templates only ever stored {rowId: headerText}, with
-- no human-readable label for custom ("extra_<n>") fields -- fine while a
-- mapping session kept its own in-memory labels, but a saved template
-- re-applied in a fresh session (or used by the unattended VortiBD cron
-- sync) had nothing but the raw rowId to key extra_fields by. Persist the
-- labels alongside the mapping so both paths can show/store real field
-- names (e.g. "Applicant ID") instead of "extra_12".
alter table admission.candidate_import_templates
  add column if not exists field_labels jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
