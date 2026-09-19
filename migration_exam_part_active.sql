-- A subject's part can be switched to "not applicable" (e.g. Practical for
-- a subject that has none this year) without losing its marks / weight /
-- pass, and switched back later. Inactive parts are ignored by marks entry
-- and result processing.
alter table exam.subject_components
  add column if not exists is_active boolean not null default true;

notify pgrst, 'reload schema';
