-- Fix: student.get_section_attendance_multi() ignores manual_attendance_
-- overrides entirely — it only ever counted a real attendance_records row
-- (an ESP32/NFC tap) as "in". This is the ONE function both the ESP32
-- attendance terminal (Class_in_out) and every P10 display poll for their
-- live present/absent digits (Class_in_out calls it directly; P10 normally
-- gets the same numbers relayed over ESP-NOW from its paired terminal, and
-- falls back to calling this same RPC itself if that ESP-NOW link goes
-- stale). So when a class teacher/admin/VP/Cord edits a student's
-- attendance from the portal (which only ever writes to
-- manual_attendance_overrides — see setMyClassStudentAttendance /
-- save_manual_attendance / save_bulk_manual_attendance), neither device
-- ever reflected it: this function was the single shared source feeding
-- both, and it never looked at that table.
--
-- NOTE: this function was created by hand in Supabase — there is no
-- original DDL for it anywhere in this repo. This replacement was
-- reconstructed from its call sites (Class_in_out/src/main.cpp,
-- p10_display/src/main.cpp, student-admin/route.js) and reproduces the
-- SAME signature and return shape (p_filters jsonb in; total_count/
-- in_count/out_count out) so neither firmware needs any change — only
-- fixes in_count to resolve status the same way the rest of the app
-- already does everywhere else (manual_attendance_overrides row wins when
-- present; otherwise a same-day attendance_records row means present,
-- else absent). out_count keeps its separate, unrelated meaning — "tapped
-- out on a mid-day pass and not back yet" — read straight from
-- attendance_records.pass, which has no manual-override concept at all.
--
-- Run in the Supabase SQL editor. CREATE OR REPLACE — no data changes, no
-- firmware reflash needed.

create or replace function student.get_section_attendance_multi(p_filters jsonb)
returns table (total_count bigint, in_count bigint, out_count bigint)
language plpgsql
stable
as $$
declare
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
begin
  return query
  with filters as (
    select
      (f->>'class')   as cls,
      (f->>'section') as sec,
      (f->>'group')   as grp,
      (f->>'session') as ses
    from jsonb_array_elements(p_filters) as f
  ),
  roster as (
    select distinct s.student_id
    from student.students_data s
    join filters f
      on s.class = f.cls
     and s.section = f.sec
     and (f.grp is null or s."group" = f.grp)
     and (f.ses is null or s.session = f.ses)
  ),
  att as (
    select a.student_id, a.pass
    from student.attendance_records a
    where a.date = v_today
  ),
  ov as (
    select m.student_id, m.status
    from student.manual_attendance_overrides m
    where m.date = v_today
  ),
  resolved as (
    select
      r.student_id,
      coalesce(ov.status, case when att.student_id is not null then 'present' else 'absent' end) as status,
      att.pass
    from roster r
    left join att on att.student_id = r.student_id
    left join ov  on ov.student_id  = r.student_id
  )
  select
    (select count(*) from roster)::bigint                                  as total_count,
    (select count(*) from resolved where status = 'present')::bigint       as in_count,
    (select count(*) from resolved where pass->>'status' = 'out')::bigint  as out_count;
end;
$$;
