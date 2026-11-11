-- New Seat Plan feature for the regular (non-admission) Exam module: which
-- room/seat a student sits in for a given exam. Rooms themselves are NOT a
-- new table here -- they're the same shared inventory.rooms registry
-- Admission's own Rooms tab now also uses (see
-- migration_admission_rooms_use_inventory.sql), so room_id references that
-- table directly rather than duplicating room data per exam.
create table if not exists exam.exam_seat_assignments (
  id bigint generated always as identity primary key,
  exam_id bigint not null references exam.exams(id) on delete cascade,
  student_id text not null,
  room_id bigint references inventory.rooms(id) on delete set null,
  seat_no text,
  allocation_run_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists exam_seat_assignments_exam_student_idx
  on exam.exam_seat_assignments (exam_id, student_id);
create index if not exists exam_seat_assignments_room_idx
  on exam.exam_seat_assignments (room_id);
grant all on exam.exam_seat_assignments to service_role;

-- One row per Run/Clear of the allocation engine, so it can be cleared and
-- re-run cleanly (same pattern as admission.seat_allocation_runs).
create table if not exists exam.exam_seat_allocation_runs (
  id bigint generated always as identity primary key,
  exam_id bigint not null references exam.exams(id) on delete cascade,
  criteria_json jsonb not null default '{}'::jsonb,
  room_ids bigint[] not null default '{}'::bigint[],
  student_count int not null default 0,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);
grant all on exam.exam_seat_allocation_runs to service_role;

alter table exam.exam_seat_assignments
  drop constraint if exists exam_seat_assignments_run_fkey;
alter table exam.exam_seat_assignments
  add constraint exam_seat_assignments_run_fkey
  foreign key (allocation_run_id) references exam.exam_seat_allocation_runs(id) on delete set null;

notify pgrst, 'reload schema';
