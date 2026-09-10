-- Saved Payroll Export templates: column layout/formatting + person
-- selection, named and reusable. Run in Supabase SQL editor.

create table if not exists payroll.export_templates (
  id bigint generated always as identity primary key,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  person_selection jsonb not null default '{"mode":"all"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists export_templates_name_idx on payroll.export_templates (lower(name));

grant select, insert, update, delete on payroll.export_templates to service_role;
grant usage, select on all sequences in schema payroll to service_role;

notify pgrst, 'reload schema';
