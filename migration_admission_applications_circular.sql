-- Part 6: merge Part 1 (native applications) and Part 2 (exam_circulars) into
-- one circular-first Admission Admin -- admission_applications confirmed
-- empty, so circular_id is added as NOT NULL directly, no backfill needed.

alter table admission.exam_circulars
  add column if not exists index_dimensions jsonb not null default '{}'::jsonb;

alter table admission.admission_applications
  add column if not exists circular_id bigint references admission.exam_circulars(id) on delete cascade;

alter table admission.admission_applications
  alter column circular_id set not null;

notify pgrst, 'reload schema';
