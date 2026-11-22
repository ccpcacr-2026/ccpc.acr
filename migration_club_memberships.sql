-- One row per student -- the primary key on student_id itself enforces
-- "exactly one club at a time": assigning a new club is a plain upsert
-- (on_conflict=student_id) that naturally replaces whatever was there,
-- exactly like class_teacher_assignments' own upsert pattern elsewhere in
-- this codebase. No FK to teacher_staff.clubs (different schema, and this
-- repo has no precedent for cross-schema FKs) -- deleteClub instead blocks
-- when the club still has members, same caution already used for other
-- deletes in this codebase rather than a silent cascade.
create table if not exists student.club_memberships (
  student_id text primary key,
  club_id bigint not null,
  assigned_by text,
  assigned_at timestamptz not null default now()
);
create index if not exists club_memberships_club_idx on student.club_memberships (club_id);
grant all on student.club_memberships to service_role;

notify pgrst, 'reload schema';
