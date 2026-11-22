-- Club description + badge image, sourced from the school's own public
-- website (ccpc.edu.bd/Club/<slug>) so students/admins see the same
-- official wording/imagery already published there.
alter table teacher_staff.clubs
  add column if not exists description text,
  add column if not exists badge_url text;

notify pgrst, 'reload schema';
