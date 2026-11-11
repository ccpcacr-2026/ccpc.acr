-- "Marks Entry" scan mode: admin-defined numeric/text fields filled in once
-- per scanned candidate (e.g. written/viva/practical marks), distinct from
-- Custom Tags (Part 4) -- Tags lock ONE field+value before scanning many
-- candidates with it; Marks shows a small multi-field form after EACH scan,
-- varying every time. Current values only (no history log, unlike
-- candidate_tag_scans) -- not asked for here, and a re-scan simply
-- overwrites with whatever's typed next.
create table if not exists admission.candidate_marks_fields (
  id bigint generated always as identity primary key,
  circular_id bigint not null references admission.exam_circulars(id) on delete cascade,
  key text not null,
  label text not null,
  input_type text not null default 'number' check (input_type in ('number', 'text')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists candidate_marks_fields_circular_key_idx on admission.candidate_marks_fields (circular_id, key);
grant all on admission.candidate_marks_fields to service_role;

alter table admission.admission_applications
  add column if not exists marks jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
