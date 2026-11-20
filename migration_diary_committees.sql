-- Part 18: Diary "Cases" (Type 1 Notify / Type 2 Committee) + Committee
-- structure (members/chairman flag, subtypes, assignment rules) + an
-- append-only referral/triage log. Extends the EXISTING
-- teacher_staff.student_diary_entries table rather than a parallel system --
-- all existing discipline/compliment/wish/homework rows keep working
-- unchanged: case_type defaults to 'notify', which IS today's plain-notify
-- behavior, nothing else about them changes.

-- ── Diary Committees ────────────────────────────────────────────────────
-- Deliberately separate from teacher_staff.committee_groups (an unrelated
-- HR/evaluation chat feature) and admission.circular_committee_members (a
-- different per-circular permission system) -- neither models "subtype +
-- per-member/per-scope assignment rule" at all.
create table if not exists teacher_staff.diary_committees (
  id bigint generated always as identity primary key,
  name text not null,
  created_by text,
  created_at timestamptz not null default now()
);
grant all on teacher_staff.diary_committees to service_role;

-- Members. is_chairman is a per-member flag, not a committee-level column --
-- multiple chairmen are allowed.
create table if not exists teacher_staff.diary_committee_members (
  id bigint generated always as identity primary key,
  committee_id bigint not null references teacher_staff.diary_committees(id) on delete cascade,
  user_id text not null,
  is_chairman boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists diary_committee_members_committee_user_idx
  on teacher_staff.diary_committee_members (committee_id, user_id);
grant all on teacher_staff.diary_committee_members to service_role;

-- Subtypes: chairman-managed catalog, scoped to their OWN committee. key is
-- slugified from label at write time, same approach already proven by
-- admission.candidate_tag_definitions.
create table if not exists teacher_staff.diary_committee_subtypes (
  id bigint generated always as identity primary key,
  committee_id bigint not null references teacher_staff.diary_committees(id) on delete cascade,
  key text not null,
  label text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists diary_committee_subtypes_committee_key_idx
  on teacher_staff.diary_committee_subtypes (committee_id, key);
grant all on teacher_staff.diary_committee_subtypes to service_role;

-- Assignment rules: ONE ROW PER (subtype, member, scope) -- a subtype may
-- have many rows (many members), a member may appear in many rows
-- (different subtypes and/or different scopes). `scope` deliberately
-- reuses the EXACT same jsonb shape as student_diary_entries.audience
-- ({mode, session, class, section, student_ids}) -- not a second scope
-- format -- so the same matching logic createDiaryEntry already uses for
-- audience resolution works here unchanged.
create table if not exists teacher_staff.diary_committee_assignment_rules (
  id bigint generated always as identity primary key,
  committee_id bigint not null references teacher_staff.diary_committees(id) on delete cascade,
  subtype_id bigint not null references teacher_staff.diary_committee_subtypes(id) on delete cascade,
  member_user_id text not null,
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists diary_committee_assignment_rules_subtype_idx
  on teacher_staff.diary_committee_assignment_rules (subtype_id);
create index if not exists diary_committee_assignment_rules_member_idx
  on teacher_staff.diary_committee_assignment_rules (member_user_id);
grant all on teacher_staff.diary_committee_assignment_rules to service_role;

-- ── Extend student_diary_entries for Type 1 / Type 2 cases ─────────────────
-- Additive-only -- every new column has a default/NULL behavior that is a
-- strict no-op for every row that exists today.
alter table teacher_staff.student_diary_entries
  add column if not exists case_type text not null default 'notify' check (case_type in ('notify', 'committee'));
alter table teacher_staff.student_diary_entries
  add column if not exists committee_id bigint references teacher_staff.diary_committees(id);
alter table teacher_staff.student_diary_entries
  add column if not exists subtype_id bigint references teacher_staff.diary_committee_subtypes(id);
-- status is meaningful ONLY for case_type='committee' -- stays NULL for
-- every 'notify' entry. 'untriaged' at creation of a committee case, then
-- 'in_progress' once a chairman triages it, then 'closed' when the current
-- handler finishes it.
alter table teacher_staff.student_diary_entries
  add column if not exists status text check (status in ('untriaged', 'in_progress', 'closed'));
-- Denormalized "who has this case RIGHT NOW" -- resolved from the latest
-- diary_case_referrals row below, kept here for O(1) list/notification
-- reads without a log join on every render. Same split this codebase
-- already uses elsewhere: an append-only log (authoritative) + a
-- denormalized "current" column (fast-lookup snapshot).
alter table teacher_staff.student_diary_entries
  add column if not exists current_handler_id text;
-- Lets the UI badge "Filed via QR scan" without re-deriving it from
-- anything else.
alter table teacher_staff.student_diary_entries
  add column if not exists scanned_from_qr boolean not null default false;

-- ── Per-student expansion index ────────────────────────────────────────────
-- audience is one of three shapes (whole class / class+section / an
-- explicit student list) -- there is no cheap way today to answer "every
-- diary entry that actually touches student X" (a committee case is
-- always student-scoped, but this also benefits the QR popup's "full
-- diary history" for ANY entry type, not just cases). One row per
-- (entry, resolved student), populated at write time using the SAME
-- resolution createDiaryEntry already performs for its notification
-- fan-out -- never a second, divergent resolution. NOT append-only (rows
-- cascade-delete with their entry) -- a derived index, not a history log.
create table if not exists teacher_staff.diary_entry_students (
  diary_entry_id bigint not null references teacher_staff.student_diary_entries(id) on delete cascade,
  student_id text not null,
  primary key (diary_entry_id, student_id)
);
create index if not exists diary_entry_students_student_idx
  on teacher_staff.diary_entry_students (student_id);
grant all on teacher_staff.diary_entry_students to service_role;

-- One-time backfill -- every diary entry that already existed before this
-- migration gets its diary_entry_students rows too, using the identical
-- rule createDiaryEntry applies going forward. teacher_staff and student
-- are schemas in the SAME Postgres database (not separate databases --
-- PostgREST's Accept-Profile headers are just how the REST layer scopes a
-- request, the raw SQL connection can join across schemas directly), so
-- this cross-schema join works in one statement.
insert into teacher_staff.diary_entry_students (diary_entry_id, student_id)
select e.id, s.student_id
from teacher_staff.student_diary_entries e
join student.students_data s
  on s.class = e.audience->>'class'
  and (coalesce(e.audience->>'section', '') = '' or s.section = e.audience->>'section')
where coalesce(e.audience->>'mode', 'class') in ('class', 'class_section')
on conflict do nothing;

insert into teacher_staff.diary_entry_students (diary_entry_id, student_id)
select e.id, trim(both '"' from sid::text)
from teacher_staff.student_diary_entries e,
     jsonb_array_elements(coalesce(e.audience -> 'student_ids', '[]'::jsonb)) sid
where e.audience->>'mode' = 'students'
on conflict do nothing;

-- ── Append-only referral/triage trail ──────────────────────────────────────
-- Mirrors this codebase's own established idiom for append-only history
-- tables: "who had this case, in what order" must always be fully
-- reconstructable, never overwritten. current_handler_id above is the
-- fast-lookup denormalization; this table is the sole authority.
create table if not exists teacher_staff.diary_case_referrals (
  id bigint generated always as identity primary key,
  diary_entry_id bigint not null references teacher_staff.student_diary_entries(id) on delete cascade,
  from_user_id text,
  to_user_id text not null,
  action text not null check (action in ('triaged', 'referred')),
  subtype_id bigint references teacher_staff.diary_committee_subtypes(id), -- set on the 'triaged' row only
  note text,
  created_at timestamptz not null default now()
);
create index if not exists diary_case_referrals_entry_idx
  on teacher_staff.diary_case_referrals (diary_entry_id, created_at desc);
grant all on teacher_staff.diary_case_referrals to service_role;

-- ── Replies ────────────────────────────────────────────────────────────────
-- A guardian can reply on any case/diary entry that targets their own
-- ward (checked at write time against diary_entry_students, same table
-- that already answers "does this entry touch student X"). There is no
-- separate guardian identity anywhere in this system -- ccpc-students'
-- own login is just student_id + phone/PIN, trusted client-side exactly
-- like every other action there -- so a guardian reply is attributed to
-- the student_id it came in through, with author_role distinguishing it
-- from a teacher's own reply on the same entry.
create table if not exists teacher_staff.diary_entry_replies (
  id bigint generated always as identity primary key,
  diary_entry_id bigint not null references teacher_staff.student_diary_entries(id) on delete cascade,
  author_role text not null check (author_role in ('teacher', 'guardian')),
  author_id text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists diary_entry_replies_entry_idx
  on teacher_staff.diary_entry_replies (diary_entry_id, created_at asc);
grant all on teacher_staff.diary_entry_replies to service_role;

notify pgrst, 'reload schema';
