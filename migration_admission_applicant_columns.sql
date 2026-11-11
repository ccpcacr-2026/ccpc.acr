-- Lets an admin define the Applications table's own data columns (which
-- fields appear, grouped into which column, in what order) instead of the
-- fixed "Applicant"/"Family & Scan" layout. Empty ([]) means "not configured
-- yet" -- the client falls back to that same fixed layout until an admin
-- saves a custom one. Status and Actions stay fixed, unconfigurable
-- trailing columns regardless.
alter table admission.exam_circulars
  add column if not exists applicant_columns jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
