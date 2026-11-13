-- Login/visit history for both portals, surfaced in the admin "History"
-- view (Student Portal module) alongside the existing student edit_history
-- log. teacher_staff.portal_visit_log is written directly by this repo
-- (loginAndGetProfile in app/api/exec/route.js) on every successful
-- teacher/staff login. student.portal_visit_log is written by the SEPARATE
-- ccpc-students repo on every successful student login -- see the handoff
-- spec; this repo only reads it.
create table if not exists teacher_staff.portal_visit_log (
  id bigint generated always as identity primary key,
  user_id text not null,
  visited_at timestamptz not null default now()
);
create index if not exists portal_visit_log_user_idx on teacher_staff.portal_visit_log (user_id, visited_at desc);
create index if not exists portal_visit_log_visited_at_idx on teacher_staff.portal_visit_log (visited_at);
grant all on teacher_staff.portal_visit_log to service_role;

create table if not exists student.portal_visit_log (
  id bigint generated always as identity primary key,
  student_id text not null,
  visited_at timestamptz not null default now()
);
create index if not exists student_portal_visit_log_student_idx on student.portal_visit_log (student_id, visited_at desc);
create index if not exists student_portal_visit_log_visited_at_idx on student.portal_visit_log (visited_at);
grant all on student.portal_visit_log to service_role;

notify pgrst, 'reload schema';
