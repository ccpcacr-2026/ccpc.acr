-- Named, server-saved export templates shared by BOTH the Applications
-- (native) and Candidates (external/VortiBD) lists in Admission Admin --
-- global across every circular (confirmed via AskUserQuestion), not
-- per-circular. Replaces/supplements the old per-browser "remembered
-- column selection" (_ccpcCsvPickerSavedSelection, localStorage-only) with
-- a real, shareable, team-visible set of named templates.
--
-- `columns` is an ordered jsonb array; each entry is one of:
--   {"type": "field", "header": "<real column header, as this list already names it>"}
--   {"type": "merge", "label": "<output column label>", "delimiter": "<string>", "sources": ["<header1>", "<header2>", ...]}
-- Applying a template to a list silently skips any "field" entry whose
-- header doesn't exist on that list's own column set (matches this app's
-- existing resilient "unknown header -> dropped" pattern in
-- _ccpcExportCsvWithColumns's doExport), so one shared pool works for both
-- lists even though their available columns only partially overlap.
create table if not exists admission.export_templates (
  id bigint generated always as identity primary key,
  name text not null unique,
  columns jsonb not null default '[]'::jsonb,
  -- Print-only visual settings (CSV download ignores these entirely --
  -- plain comma/tab-delimited text has no concept of width/height/font).
  -- header is free text shown as a title line above the printed table,
  -- separate from CSV's own fixed institution-name/filter-summary rows --
  -- font_size in pt, column_width in px (applied uniformly to every data
  -- column), row_height in px.
  print_settings jsonb not null default '{"header": "", "font_size": 10, "column_width": 90, "row_height": 24}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on admission.export_templates to service_role;

-- Idempotent on a table that already existed before print_settings was added.
alter table admission.export_templates
  add column if not exists print_settings jsonb not null default '{"header": "", "font_size": 10, "column_width": 90, "row_height": 24}'::jsonb;

notify pgrst, 'reload schema';
