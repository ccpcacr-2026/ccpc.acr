-- Part 10: fully dynamic Scan Options, replacing the fixed Submission/
-- Attendance modes, Custom Tags (Part 4), and Marks Entry (this session)
-- with one admin-defined system. See the plan file (linked-kindling-spring,
-- Part 10) for full context. Every statement below is idempotent/re-runnable
-- and never drops or overwrites existing data -- the old tables/columns are
-- left in place as inert historical copies.
--
-- Defensive by design: the data-migration steps for Custom Tags and Marks
-- Entry only run if their source tables/columns actually exist -- an earlier
-- migration from this same session (migration_admission_candidates_marks_
-- fields.sql) may never have been run, and this script must not assume it
-- was. Each such step is wrapped in a to_regclass/information_schema check.

create table if not exists admission.scan_options (
  id bigint generated always as identity primary key,
  circular_id bigint not null references admission.exam_circulars(id) on delete cascade,
  key text not null,
  label text not null,
  behavior text not null check (behavior in ('status', 'tag', 'form')),
  -- status: {} (no config needed -- a scan just marks {done:true, scanned_at})
  -- tag:    {type: 'toggle'|'text'|'dropdown', options: [...]}
  -- form:   {fields: [{key, label, input_type: 'number'|'text'}, ...]}
  config jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists scan_options_circular_key_idx on admission.scan_options (circular_id, key);
grant all on admission.scan_options to service_role;

-- Append-only, generalized from the superseded candidate_tag_scans -- every
-- behavior type gets a scan history now, not just tags.
create table if not exists admission.scan_option_history (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references admission.admission_applications(id) on delete cascade,
  option_key text not null,
  value jsonb,
  scanned_at timestamptz not null default now()
);
create index if not exists scan_option_history_candidate_key_idx on admission.scan_option_history (candidate_id, option_key, scanned_at desc);
grant all on admission.scan_option_history to service_role;

alter table admission.admission_applications
  add column if not exists scan_values jsonb not null default '{}'::jsonb;

-- Seed Submission/Attendance as ordinary dynamic (status-behavior) options
-- for every existing circular -- ON CONFLICT makes this safe to re-run.
insert into admission.scan_options (circular_id, key, label, behavior, sort_order)
select id, 'submission', 'Form Submission Scan', 'status', 0 from admission.exam_circulars
on conflict (circular_id, key) do nothing;
insert into admission.scan_options (circular_id, key, label, behavior, sort_order)
select id, 'attendance', 'Exam Attendance Scan', 'status', 1 from admission.exam_circulars
on conflict (circular_id, key) do nothing;

-- Carry forward existing submission/attendance scan data -- only rows
-- actually touched (not every default-pending row), merged so a partial
-- re-run never clobbers anything already migrated. submission_scan_status/
-- attendance_scan_status/scanned_at have existed since early this session,
-- so these are safe to run unguarded.
update admission.admission_applications
set scan_values = scan_values
  || jsonb_build_object('submission', jsonb_build_object('done', submission_scan_status = 'collected', 'scanned_at', submission_scanned_at))
where submission_scan_status is distinct from 'pending' or submission_scanned_at is not null;
update admission.admission_applications
set scan_values = scan_values
  || jsonb_build_object('attendance', jsonb_build_object('done', attendance_scan_status = 'present', 'scanned_at', attendance_scanned_at))
where attendance_scan_status is distinct from 'pending' or attendance_scanned_at is not null;

-- Migrate existing Custom Tags sections into scan_options (behavior='tag'),
-- only if that feature's tables/column were ever actually created.
do $$
begin
  if to_regclass('admission.candidate_tag_definitions') is not null then
    insert into admission.scan_options (circular_id, key, label, behavior, config)
    select circular_id, key, label, 'tag', jsonb_build_object('type', type, 'options', options)
    from admission.candidate_tag_definitions
    on conflict (circular_id, key) do nothing;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'admission' and table_name = 'admission_applications' and column_name = 'tags') then
    update admission.admission_applications set scan_values = scan_values || tags where tags <> '{}'::jsonb;
  end if;
  if to_regclass('admission.candidate_tag_scans') is not null then
    insert into admission.scan_option_history (candidate_id, option_key, value, scanned_at)
    select candidate_id, tag_key, value, scanned_at from admission.candidate_tag_scans;
  end if;
end $$;

-- Migrate existing Marks Entry fields into ONE scan_option per circular
-- (behavior='form') -- marks fields were already grouped under one mode,
-- so they become one option's config.fields array, not one option each.
-- Guarded the same way: migration_admission_candidates_marks_fields.sql may
-- never have been run, in which case this is a no-op.
do $$
begin
  if to_regclass('admission.candidate_marks_fields') is not null then
    insert into admission.scan_options (circular_id, key, label, behavior, config)
    select circular_id, 'marks_entry', 'Marks Entry', 'form',
      jsonb_build_object('fields', jsonb_agg(jsonb_build_object('key', key, 'label', label, 'input_type', input_type) order by sort_order))
    from admission.candidate_marks_fields
    group by circular_id
    on conflict (circular_id, key) do nothing;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'admission' and table_name = 'admission_applications' and column_name = 'marks') then
    update admission.admission_applications set scan_values = scan_values || jsonb_build_object('marks_entry', marks) where marks <> '{}'::jsonb;
  end if;
end $$;

notify pgrst, 'reload schema';
