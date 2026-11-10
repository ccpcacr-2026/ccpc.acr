-- Part 7: VortiBD integration -- automatic periodic Excel pull + import

alter table admission.exam_circulars
  add column if not exists vortibd_circular_id integer,
  add column if not exists vortibd_sync_enabled boolean not null default false,
  add column if not exists vortibd_sync_interval_minutes integer not null default 360,
  add column if not exists vortibd_mapping_template_id bigint references admission.candidate_import_templates(id) on delete set null,
  add column if not exists vortibd_last_sync_at timestamptz,
  add column if not exists vortibd_last_sync_status text,
  add column if not exists vortibd_last_sync_message text;

notify pgrst, 'reload schema';
