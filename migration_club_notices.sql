-- Full notice history per club (not a single overwritten notice) -- e.g.
-- "Practice today, 4pm". Posted by that club's own Club Teacher, any Class
-- Teacher, or Admin/VP/Cord (checked server-side in app/api/exec/route.js,
-- not here). Append-only; deletion is a separate, gated action.
create table if not exists teacher_staff.club_notices (
  id bigint generated always as identity primary key,
  club_id bigint not null references teacher_staff.clubs(id) on delete cascade,
  posted_by text,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists club_notices_club_idx on teacher_staff.club_notices (club_id, created_at desc);
grant all on teacher_staff.club_notices to service_role;

notify pgrst, 'reload schema';
