-- The school's subject reference sheet (code + the subject's real name for
-- each class / medium). Read from the sheet in Subject Setup → Subject
-- Codes; the code → subject link it produces is what lets the class
-- routine be read, and the class-wise names are kept for printing.
create table if not exists exam.subject_name_ref (
  id bigint generated always as identity primary key,
  code text not null,
  scope text not null,              -- the sheet's column heading, e.g. 'Subjects (English) (VI-X)'
  name text not null,
  subject_id bigint references exam.subjects(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists subject_name_ref_uidx on exam.subject_name_ref (code, scope);
create index if not exists subject_name_ref_code_idx on exam.subject_name_ref (code);

grant select, insert, update, delete on exam.subject_name_ref to service_role;
grant usage, select on all sequences in schema exam to service_role;

notify pgrst, 'reload schema';
