-- A club teacher can now be scoped to one specific branch (e.g. just
-- "Astronomy" within Science Club) instead of always the whole club.
-- branch_id null = whole-club assignment (unchanged previous behavior).
alter table teacher_staff.club_teachers
  add column if not exists branch_id bigint;

-- The old (club_id, user_id) unique index would block a teacher being
-- assigned to a second, different branch of the same club -- replaced with
-- a coalesce-based index so NULL (whole-club) stays a single unique slot
-- per teacher, while each branch_id is its own distinct slot (branch ids
-- are identity-generated starting at 1, so 0 never collides with a real one).
drop index if exists teacher_staff.club_teachers_club_user_idx;
create unique index if not exists club_teachers_club_user_branch_idx
  on teacher_staff.club_teachers (club_id, user_id, coalesce(branch_id, 0));

notify pgrst, 'reload schema';
