create table if not exists teacher_staff.clubs (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_by text,
  created_at timestamptz not null default now()
);
grant all on teacher_staff.clubs to service_role;

create table if not exists teacher_staff.club_teachers (
  id bigint generated always as identity primary key,
  club_id bigint not null references teacher_staff.clubs(id) on delete cascade,
  user_id text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists club_teachers_club_user_idx on teacher_staff.club_teachers (club_id, user_id);
grant all on teacher_staff.club_teachers to service_role;

notify pgrst, 'reload schema';
