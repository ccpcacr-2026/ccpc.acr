-- Saved custom count cards for the Admission Dashboard. The admin builds an
-- ad hoc AND-of-field=value filter (Class/Category/Version/Session/Status/
-- Source/Payment Status/Stage) and can save it as a permanent card; the
-- actual count is always computed client-side from the circular's already-
-- loaded roster (same as the built-in Class/Category/Source breakdowns), so
-- this table only ever stores the filter DEFINITION, never a count.
create table if not exists admission.dashboard_custom_counters (
  id bigint generated always as identity primary key,
  circular_id bigint not null references admission.exam_circulars(id) on delete cascade,
  label text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dashboard_custom_counters_circular_idx on admission.dashboard_custom_counters (circular_id);
grant all on admission.dashboard_custom_counters to service_role;

notify pgrst, 'reload schema';
