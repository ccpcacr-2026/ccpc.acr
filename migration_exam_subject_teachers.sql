-- Who may enter marks for a subject, per class list — general, not per exam
-- or term. Filled from the class routine (Subject Setup → Teachers from
-- Routine) and editable by hand.
create table if not exists exam.subject_teachers (
  id bigint generated always as identity primary key,
  pattern_id bigint not null references exam.class_patterns(id) on delete cascade,
  subject_id bigint not null references exam.subjects(id) on delete cascade,
  teacher_id text not null,
  source text not null default 'routine',   -- 'routine' or 'manual'
  created_at timestamptz not null default now()
);
create unique index if not exists subject_teachers_uidx on exam.subject_teachers (pattern_id, subject_id, teacher_id);
create index if not exists subject_teachers_teacher_idx on exam.subject_teachers (teacher_id);

-- The routine writes teachers as short names (MRM, SCN…) and subjects as
-- codes (DT, Lib/PS…). These two tables remember what each one means, so a
-- name the system could not work out is fixed once and then stays fixed.
create table if not exists exam.routine_teacher_map (
  short_name text primary key,
  teacher_id text,
  updated_at timestamptz not null default now()
);
create table if not exists exam.routine_subject_map (
  code text primary key,
  subject_id bigint references exam.subjects(id) on delete cascade,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on exam.subject_teachers, exam.routine_teacher_map, exam.routine_subject_map to service_role;
grant usage, select on all sequences in schema exam to service_role;

notify pgrst, 'reload schema';
