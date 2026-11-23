-- Part 20 — Unified School Calendar
-- New, dedicated home for manual entries + holidays (the two sources with
-- nowhere else to live). Diary due-dates, exam dates, and dated announcements
-- are NEVER copied in here -- getCalendarEvents resolves those live from
-- their own tables at read time.
create table if not exists teacher_staff.calendar_events (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  event_date date not null,
  end_date date, -- nullable; multi-day events (e.g. a study tour) set this
  event_type text not null default 'programme' check (event_type in ('holiday', 'programme', 'exam', 'other')),
  -- Same shape as student_diary_entries.audience, reused for consistency:
  -- {mode:'all'|'class_section'|'students', class, section, student_ids}
  audience jsonb not null default '{"mode":"all"}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'google_holiday')),
  color text, -- optional admin override; falls back to a type-based default client-side
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists calendar_events_date_idx on teacher_staff.calendar_events (event_date);
grant all on teacher_staff.calendar_events to service_role;

-- Additive, nullable -- every existing exam/application/announcement row is
-- completely unaffected.
alter table exam.exams
  add column if not exists exam_date date,
  add column if not exists exam_end_date date;

alter table student.students_data
  add column if not exists date_of_birth date;

alter table public.announcements
  add column if not exists event_date date;

notify pgrst, 'reload schema';
