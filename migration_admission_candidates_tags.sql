-- Part 4: admin-defined candidate tagging via QR scan ("Custom Tags")

create table if not exists admission.candidate_tag_definitions (
  id bigint generated always as identity primary key,
  circular_id bigint not null references admission.exam_circulars(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null default 'toggle' check (type in ('toggle', 'text', 'dropdown')),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists candidate_tag_definitions_circular_key_idx on admission.candidate_tag_definitions (circular_id, key);
grant all on admission.candidate_tag_definitions to service_role;

-- Append-only scan log -- never updated/deleted, so history is always complete.
-- "Restoring" an older value is just applying it again (a new row), never a
-- destructive rollback -- keeps the model simple and the log always truthful.
create table if not exists admission.candidate_tag_scans (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references admission.exam_candidates(id) on delete cascade,
  tag_key text not null,
  value jsonb,
  scanned_at timestamptz not null default now()
);
create index if not exists candidate_tag_scans_candidate_key_idx on admission.candidate_tag_scans (candidate_id, tag_key, scanned_at desc);
grant all on admission.candidate_tag_scans to service_role;

-- Current-value snapshot per candidate, for fast client-side filtering in the
-- Candidates tab (which already loads the full roster once and filters in
-- JS -- see _admCandFilterList) without needing to join the log table.
alter table admission.exam_candidates
  add column if not exists tags jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
