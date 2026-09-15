-- "Group Maker" for Payroll printing — lets an admin define named groups
-- matching the office's real structure (School Teacher, College Teacher,
-- Driver+Helper/Bus Assistant, etc. — the same split as the original
-- Excel sheets' own tabs) so the PDF/Excel export can print group-wise.
--
-- Deliberately its own payroll-scoped tables rather than extending the
-- existing teacher_staff.category system (staff_category_groups/
-- subgroups/designation_category_map, reached via app/api/exec/route.js):
-- that system assigns exactly ONE category per designation GLOBALLY, so
-- it can never tell a School Security Guard apart from a College
-- Security Guard — checked the live data before building this, and
-- category values today are just "Teaching"/"Non-Teaching"/"Staff", far
-- too coarse for group-wise payroll printing. This is also meant to stay
-- scoped to payroll printing, not become a system-wide reclassification
-- other modules (Permission Control, etc.) depend on.
--
-- A person's effective group: an explicit individual membership
-- (payroll_group_members) always wins when present; otherwise it falls
-- back to whichever group's designation list includes their own
-- designation (payroll_group_designations). Both children are keyed
-- unique per designation/user so a designation or person can only ever
-- belong to ONE group at a time — no ambiguity to resolve at read time.
--
-- Run in Supabase SQL editor.

create table if not exists payroll.payroll_groups (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists payroll.payroll_group_designations (
  id bigint generated always as identity primary key,
  group_id bigint not null references payroll.payroll_groups(id) on delete cascade,
  designation text not null unique
);

create table if not exists payroll.payroll_group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references payroll.payroll_groups(id) on delete cascade,
  user_id text not null unique,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on payroll.payroll_groups to service_role;
grant select, insert, update, delete on payroll.payroll_group_designations to service_role;
grant select, insert, update, delete on payroll.payroll_group_members to service_role;
grant usage, select on all sequences in schema payroll to service_role;

-- Seeded with the SAME 4 names the existing Acquittance Roll export
-- already hardcodes (PR_ACQUITTANCE_TEMPLATES in _src/app.js) — that
-- feature has been silently skipping anyone whose category doesn't
-- exactly match one of these 4 strings, because the live
-- teacher_staff.category values are "Teaching"/"Non-Teaching"/"Staff"/
-- etc, never these. Seeding the same names here means that export
-- starts working again the moment people resolve into these groups.
insert into payroll.payroll_groups (name, sort_order) values
  ('Teacher School', 1), ('Teacher College', 2), ('Driver/Helper', 3), ('Staff', 4)
on conflict (name) do nothing;

-- A reasonable starting designation split, not a guess made up from
-- nothing: "Senior/Assistant Teacher" titles exist only at the School
-- side and "Professor/Lecturer/Demonstrator/Instructor" titles only at
-- the College side in this office's real designation list (confirmed
-- live, zero overlap) — a genuine Bangladeshi school/college title
-- convention, not an assumption. Everything else defaults to Staff;
-- the admin can move any designation (or override an individual) from
-- the new Payroll Groups screen.
do $$
declare
  g_ts bigint; g_tc bigint; g_dh bigint; g_st bigint;
begin
  select id into g_ts from payroll.payroll_groups where name = 'Teacher School';
  select id into g_tc from payroll.payroll_groups where name = 'Teacher College';
  select id into g_dh from payroll.payroll_groups where name = 'Driver/Helper';
  select id into g_st from payroll.payroll_groups where name = 'Staff';

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_ts, d from unnest(array['Senior Teacher', 'Assistant Teacher', 'VP & Senior Teacher']) as d
  on conflict (designation) do nothing;

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_tc, d from unnest(array['Professor', 'Associate Professor', 'Assistant Professor', 'Lecturer', 'Demonstrator', 'Instructor', 'VP & Professor']) as d
  on conflict (designation) do nothing;

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_dh, d from unnest(array['Driver', 'Bus Assistant']) as d
  on conflict (designation) do nothing;

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_st, d from unnest(array[
    'Accountant', 'Accounts Assistant', 'Accounts Officer', 'Administrative Officer', 'Assistant Librarian',
    'Aya', 'Caretaker', 'Carpenter', 'Cleaner', 'Cleaner (Contractual)', 'Clerk', 'Computer Operator',
    'Electrician', 'Lab Attendant', 'Lab attendent (contractual)', 'Librarian', 'Library Assistant', 'MLSS',
    'Maintenance Officer', 'Mali', 'Medical Assistant', 'Office Assistant', 'Office Super', 'PA to Principal',
    'Peon', 'Principal', 'Security Guard', 'System and IT Technician', 'Uda'
  ]) as d
  on conflict (designation) do nothing;
end $$;

notify pgrst, 'reload schema';
