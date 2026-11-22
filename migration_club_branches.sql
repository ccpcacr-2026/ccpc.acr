-- A club can have several "branches" (sub-categories/interest areas), e.g.
-- Science Club -> Astronomy / Robotics & Programming / Mathematics. A
-- student's club membership may optionally pin one specific branch within
-- their club. Same no-cross-schema-FK posture as club_id on
-- club_memberships -- app-level checks (not a DB constraint) guard deletes.
create table if not exists teacher_staff.club_branches (
  id bigint generated always as identity primary key,
  club_id bigint not null references teacher_staff.clubs(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists club_branches_club_name_idx on teacher_staff.club_branches (club_id, name);
grant all on teacher_staff.club_branches to service_role;

alter table student.club_memberships
  add column if not exists branch_id bigint;

notify pgrst, 'reload schema';
