-- Separates the External-Candidate Exam Management module (see
-- migration_admission_candidates.sql) by circular/session: a circular can
-- span several uploads over time (old+new data mixed across them), and
-- rooms are also kept independent per circular (same room name/number can
-- legitimately repeat across different circulars). Run in Supabase SQL
-- editor AFTER migration_admission_candidates.sql.
--
-- No data backfill here -- the module had no real data yet when this was
-- written (confirmed with the admin). Existing rows (if any) simply keep
-- a null circular_id and stop showing up once every list/filter is scoped
-- to a chosen circular; delete them from the Candidates tab if they're
-- just test rows.

create table if not exists admission.exam_circulars (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists exam_circulars_name_idx on admission.exam_circulars (lower(name));

alter table admission.exam_candidates
  add column if not exists circular_id bigint references admission.exam_circulars(id) on delete cascade;
alter table admission.exam_rooms
  add column if not exists circular_id bigint references admission.exam_circulars(id) on delete cascade;
alter table admission.seat_allocation_runs
  add column if not exists circular_id bigint references admission.exam_circulars(id) on delete cascade;
alter table admission.candidate_import_batches
  add column if not exists circular_id bigint references admission.exam_circulars(id) on delete set null;

-- Replace the old GLOBAL-uniqueness indexes with PER-CIRCULAR ones -- the
-- same token/room-name can now legitimately recur in a different circular.
drop index if exists admission.exam_candidates_external_key_idx;
create unique index if not exists exam_candidates_circular_external_key_idx on admission.exam_candidates (circular_id, external_key);

-- Plain-column unique index (not an expression index on lower()) -- a
-- PostgREST on_conflict upsert target must match a unique constraint on
-- the literal columns it names, which room_name-via-on_conflict=room_name
-- never actually did against the old lower()-only index either (a
-- pre-existing bug in migration_admission_candidates.sql, fixed here since
-- no real data has gone through yet).
drop index if exists admission.exam_rooms_name_idx;
create unique index if not exists exam_rooms_circular_name_idx on admission.exam_rooms (circular_id, room_name);

create index if not exists exam_candidates_circular_idx on admission.exam_candidates (circular_id);
create index if not exists exam_rooms_circular_idx on admission.exam_rooms (circular_id);

grant select, insert, update, delete on admission.exam_circulars to service_role;
grant usage, select on all sequences in schema admission to service_role;

notify pgrst, 'reload schema';
