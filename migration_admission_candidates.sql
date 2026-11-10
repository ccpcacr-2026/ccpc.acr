-- External-candidate exam management: candidates imported from an outside
-- admission system via Excel (own import-mapping templates, since the same
-- file layout gets re-uploaded repeatedly), room/seat allocation, and the
-- two independent QR scan flows (form submission/collection vs. exam-room
-- attendance). Lives in the already-existing `admission` schema (no CREATE
-- SCHEMA needed) alongside admission_applications/admission_settings, but
-- is a wholly separate entity -- nothing here is referenced by or
-- references admission_applications. Run in Supabase SQL editor.

-- Saved column-mapping templates, so a second/third upload of the same
-- external file layout doesn't need re-mapping every time. `mapping` keys
-- by source HEADER TEXT (not column index), so it still matches correctly
-- if the external system reorders its own columns between exports.
create table if not exists admission.candidate_import_templates (
  id bigint generated always as identity primary key,
  name text not null,
  header_signature text not null,
  mapping jsonb not null default '{}'::jsonb,
  primary_key_field text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists candidate_import_templates_name_idx on admission.candidate_import_templates (lower(name));
create index if not exists candidate_import_templates_sig_idx on admission.candidate_import_templates (header_signature);

-- One row per Excel upload event -- audit trail + new/updated/error counts
-- for the preview-before-confirm step.
create table if not exists admission.candidate_import_batches (
  id bigint generated always as identity primary key,
  template_id bigint references admission.candidate_import_templates(id) on delete set null,
  file_name text,
  mapping_used jsonb not null default '{}'::jsonb,
  primary_key_field text,
  row_count int not null default 0,
  new_count int not null default 0,
  updated_count int not null default 0,
  error_count int not null default 0,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create table if not exists admission.exam_rooms (
  id bigint generated always as identity primary key,
  room_name text not null,
  capacity int not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists exam_rooms_name_idx on admission.exam_rooms (lower(room_name));

-- Audit trail for the seat-allocation engine -- lets a run be cleared and
-- re-run cleanly (candidates' room_id/seat_no/allocation_run_id all point
-- back to the run that set them).
create table if not exists admission.seat_allocation_runs (
  id bigint generated always as identity primary key,
  criteria_json jsonb not null default '{}'::jsonb,
  room_ids jsonb not null default '[]'::jsonb,
  candidate_count int not null default 0,
  created_at timestamptz not null default now(),
  cleared_at timestamptz
);

-- The candidate roster itself. `external_key` is the upsert match column --
-- whichever mapped field the admin designated "primary" at mapping time
-- (commonly `token`, but any mapped field); `token` is modeled separately
-- since it's what gets PRINTED and isn't always guaranteed to be the same
-- field as the chosen primary key. Everything mapped-but-not-modeled lands
-- in `extra_fields`, since the external system's own columns are arbitrary
-- and will grow over time.
create table if not exists admission.exam_candidates (
  id bigint generated always as identity primary key,
  external_key text not null,
  token text,
  candidate_name text,
  class text,
  category text,
  extra_fields jsonb not null default '{}'::jsonb,
  photo_url text,
  room_id bigint references admission.exam_rooms(id) on delete set null,
  seat_no text,
  allocation_run_id bigint references admission.seat_allocation_runs(id) on delete set null,
  submission_scan_status text not null default 'pending' check (submission_scan_status in ('pending', 'collected')),
  submission_scanned_at timestamptz,
  attendance_scan_status text not null default 'pending' check (attendance_scan_status in ('pending', 'present')),
  attendance_scanned_at timestamptz,
  import_batch_id bigint references admission.candidate_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists exam_candidates_external_key_idx on admission.exam_candidates (external_key);
create index if not exists exam_candidates_token_idx on admission.exam_candidates (token);
create index if not exists exam_candidates_room_idx on admission.exam_candidates (room_id);
create index if not exists exam_candidates_class_idx on admission.exam_candidates (class);
create index if not exists exam_candidates_category_idx on admission.exam_candidates (category);

grant select, insert, update, delete on admission.candidate_import_templates to service_role;
grant select, insert, update, delete on admission.candidate_import_batches to service_role;
grant select, insert, update, delete on admission.exam_rooms to service_role;
grant select, insert, update, delete on admission.seat_allocation_runs to service_role;
grant select, insert, update, delete on admission.exam_candidates to service_role;
grant usage, select on all sequences in schema admission to service_role;

notify pgrst, 'reload schema';
