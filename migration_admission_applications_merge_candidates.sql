-- Part 8: fold the external "Candidates" system (VortiBD-sourced,
-- previously admission.exam_candidates) into the native
-- admission.admission_applications table, so VortiBD data becomes real
-- applications -- counted in the same Dashboard, openable in the same
-- editor, usable by the same Rooms/Seat-Allocation/Scan/Tags/Photo tools.
--
-- SAFETY: this migration is purely additive. Nothing is dropped or
-- truncated. exam_candidates and its satellite tables are left in place,
-- untouched, as an inert historical copy. BACK UP exam_candidates (e.g.
-- Supabase Table Editor -> Export CSV) before running this on production --
-- it holds live candidate data for a real school.

-- Identity: non-native rows carry their own token/external_key instead of
-- (or alongside) the native tracking_id/index_id -- those two stay
-- native-only, generated only for admin-created applications. source has
-- three values: 'native' (created in the admin editor), 'imported' (a
-- bulk Excel upload or the VortiBD auto-sync -- exam_candidates held a mix
-- of both with no way to tell them apart after the fact, so every
-- migrated historical row below is labeled 'imported' rather than
-- overclaiming a single origin), 'online' (self-submitted via the public
-- apply-exam form).
alter table admission.admission_applications
  add column if not exists source text not null default 'native' check (source in ('native', 'imported', 'online')),
  add column if not exists token text,
  add column if not exists external_key text,
  add column if not exists mobile text;

-- Defensive: extra_fields turned out not to actually exist on the live
-- table (it was only ever read -- a.extra_fields || {} -- in the admin
-- editor's display code, never written, so its presence was inferred, not
-- confirmed, and the inference was wrong). Rather than trust any other
-- column name here on the same inference, explicitly guarantee every
-- column this migration's data-copy below references.
alter table admission.admission_applications
  add column if not exists name_english text,
  add column if not exists class text,
  add column if not exists category text,
  add column if not exists version text,
  add column if not exists extra_fields jsonb not null default '{}'::jsonb,
  add column if not exists student_photo text,
  add column if not exists father_photo text,
  add column if not exists mother_photo text,
  add column if not exists guardian_photo text,
  add column if not exists status text not null default 'Pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Rooms / seat allocation -- same two supporting tables Candidates already
-- uses (exam_rooms, seat_allocation_runs), just FK'd from here instead.
alter table admission.admission_applications
  add column if not exists room_id bigint references admission.exam_rooms(id) on delete set null,
  add column if not exists seat_no text,
  add column if not exists allocation_run_id bigint references admission.seat_allocation_runs(id) on delete set null;

-- Dual QR scan -- identical shape/constraints to exam_candidates' columns.
alter table admission.admission_applications
  add column if not exists submission_scan_status text not null default 'pending' check (submission_scan_status in ('pending', 'collected')),
  add column if not exists submission_scanned_at timestamptz,
  add column if not exists attendance_scan_status text not null default 'pending' check (attendance_scan_status in ('pending', 'present')),
  add column if not exists attendance_scanned_at timestamptz;

-- Custom Tags current-value snapshot (history stays in candidate_tag_scans,
-- whose candidate_id FK is repointed below).
alter table admission.admission_applications
  add column if not exists tags jsonb not null default '{}'::jsonb;

-- Upsert key for the VortiBD sync path, mirroring exam_candidates' own
-- (circular_id, external_key) uniqueness.
create unique index if not exists admission_applications_circular_external_key_idx
  on admission.admission_applications (circular_id, external_key) where external_key is not null;

-- candidate_tag_scans.candidate_id previously FK'd exam_candidates(id);
-- repoint it so tag history for merged/going-forward rows lives against
-- their new home. Existing historical rows keep their old candidate_id
-- values (pointing at now-inert exam_candidates ids) -- only future
-- inserts matter here; this just changes what new rows may reference.
alter table admission.candidate_tag_scans drop constraint if exists candidate_tag_scans_candidate_id_fkey;
alter table admission.candidate_tag_scans
  add constraint candidate_tag_scans_candidate_id_fkey foreign key (candidate_id) references admission.admission_applications(id) on delete cascade;

-- One-time, re-runnable data copy: every existing exam_candidates row
-- becomes an admission_applications row, mapped onto the native column
-- names wherever one already exists. ON CONFLICT on the new unique index
-- makes this safe to run more than once without duplicating rows.
insert into admission.admission_applications (
  circular_id, source, token, external_key, name_english, class, category, version, mobile,
  extra_fields, student_photo, father_photo, mother_photo, guardian_photo,
  room_id, seat_no, allocation_run_id,
  submission_scan_status, submission_scanned_at, attendance_scan_status, attendance_scanned_at,
  tags, status, created_at, updated_at
)
select
  ec.circular_id, 'imported', ec.token, ec.external_key, ec.candidate_name, ec.class, ec.category, ec.version, ec.mobile,
  ec.extra_fields, ec.photo_url, ec.father_photo_url, ec.mother_photo_url, ec.guardian_photo_url,
  ec.room_id, ec.seat_no, ec.allocation_run_id,
  ec.submission_scan_status, ec.submission_scanned_at, ec.attendance_scan_status, ec.attendance_scanned_at,
  ec.tags, 'Pending', ec.created_at, ec.updated_at
from admission.exam_candidates ec
on conflict (circular_id, external_key) where external_key is not null do nothing;

notify pgrst, 'reload schema';
