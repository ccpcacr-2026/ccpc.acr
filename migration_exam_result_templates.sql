-- Saved result templates (Exams → Result Process), like Payroll's output
-- templates: which exams a result combines (by term + exam name, so one
-- template works for every class), how they combine, the pass rule and
-- the output columns — all in `config`.
create table if not exists exam.result_templates (
  id bigint generated always as identity primary key,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists result_templates_name_idx on exam.result_templates (lower(name));

grant select, insert, update, delete on exam.result_templates to service_role;
grant usage, select on all sequences in schema exam to service_role;

notify pgrst, 'reload schema';
