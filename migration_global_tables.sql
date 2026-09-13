-- Generic "External Table" field source — lets an admin mark a payroll
-- table as Global (reachable) with a Join Column (which column identifies
-- the person a row belongs to), then create a Field whose value is pulled
-- straight from one column of that table for whichever person has a
-- matching row (0 otherwise). Scoped to the payroll schema only — this
-- exposes raw column values by admin choice, so it's deliberately kept to
-- payroll's own tables rather than reaching into other schemas.
--
-- This is a straight column passthrough, not a computed/derived lookup —
-- a field like this can still be used as the base of a normal "% of Field"
-- field (e.g. "10% of [External Field]"), composing the two mechanisms
-- instead of needing a special case each time. It does NOT by itself
-- replace a case that needs a secondary lookup (like MPO Basic, which
-- comes from grade_step_values via the roster row's own grade/step, not a
-- literal stored column) — that still needs either a materialized column
-- kept in sync, or bespoke code.
--
-- Run in Supabase SQL editor.

create table if not exists payroll.global_tables (
  id bigint generated always as identity primary key,
  table_name text not null unique,
  join_column text not null,
  label text,
  created_at timestamptz not null default now()
);

alter table payroll.fields add column if not exists external_table_id bigint references payroll.global_tables(id) on delete set null;
alter table payroll.fields add column if not exists external_column text;

grant select, insert, update, delete on payroll.global_tables to service_role;
grant usage, select on all sequences in schema payroll to service_role;

notify pgrst, 'reload schema';
