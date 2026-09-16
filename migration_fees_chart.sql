-- Fees Setup chart view — see the plan in
-- C:\Users\mamun\.claude\plans\linked-kindling-spring.md
--
-- The office sets fees on a wide sheet: rows = fee heads, columns =
-- collection cycles (Admission / Re-admission / Form Fillup / the 12
-- months), cells = amounts. The existing student.fee_structures table
-- has no cycle dimension at all and only groups by class + optional
-- section, so this adds:
--   * the cycle column (the sheet's columns),
--   * the rest of the cohort dimensions students are actually organized
--     by (group/version/shift/session), each nullable = "any",
--   * student_id, for per-student amounts that ADD to the cohort
--     default rather than replacing it,
--   * a link from each fee head to its real accounts.ledgers row, so
--     fee income can post to the double-entry books later instead of
--     living in a second, disconnected vocabulary.
--
-- NOTE: the fee_* tables were created by hand in Supabase and have no
-- DDL in this repo. Every statement here is additive and idempotent
-- (`if not exists`), so it is safe against whatever is actually there.
--
-- Run in the Supabase SQL editor, after migration_income_ledgers.sql.

-- ── Fee heads ⇄ accounts ledgers ──────────────────────────────────────
-- Soft link (plain bigint, no cross-schema FK): a hard FK into another
-- schema would make the Accounts "Delete ledger" button fail with a raw
-- Postgres error instead of a readable message, so the app guards this
-- instead.
alter table student.fee_types
  add column if not exists ledger_id  bigint,
  add column if not exists sort_order integer not null default 0;

create index if not exists fee_types_ledger_idx on student.fee_types (ledger_id);

-- ── The chart ─────────────────────────────────────────────────────────
-- One row per (fee head × cycle × scope). Scope columns are explicit and
-- nullable — null means "any" — rather than a jsonb criteria blob: the
-- dimension set is small, fixed and known, and explicit columns index
-- and match far more simply.
alter table student.fee_structures
  add column if not exists cycle         text,
  add column if not exists student_group text,
  add column if not exists version       text,
  add column if not exists shift         text,
  add column if not exists session       text,
  add column if not exists student_id    text;

comment on column student.fee_structures.cycle is
  'Collection cycle: Admission | Re-admission | Form Fillup | January..December. Null on pre-chart legacy rows.';
comment on column student.fee_structures.student_id is
  'Set => this row is an ADDITIVE per-student delta on top of the matching cohort row, not a replacement.';

create index if not exists fee_structures_lookup_idx
  on student.fee_structures (academic_year, cycle, class, section);
create index if not exists fee_structures_student_idx
  on student.fee_structures (student_id) where student_id is not null;

-- ── Remission ─────────────────────────────────────────────────────────
-- A lump sum waived for one student, split pro-rata across their
-- non-zero unpaid fee heads by each head's share of the total. The split
-- is stored as lines so it stays auditable after an admin revises it;
-- auto_split flips to false the moment any line is hand-edited, so the
-- UI knows not to silently recompute over their revision.
create table if not exists student.fee_remissions (
  id            bigint generated always as identity primary key,
  student_id    text not null,
  academic_year text not null,
  cycle         text,
  total_amount  numeric not null,
  lines         jsonb not null default '[]'::jsonb,
  auto_split    boolean not null default true,
  reason        text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists fee_remissions_student_idx
  on student.fee_remissions (student_id, academic_year);

grant select, insert, update, delete on student.fee_remissions to service_role;
grant usage, select on all sequences in schema student to service_role;

-- ── Seed fee heads from the real income ledgers ───────────────────────
-- Every Direct Income ledger becomes a fee head, name kept verbatim
-- (including the "-INC" suffix) so re-syncing by name stays reliable.
-- code is derived: strip the -INC suffix, non-alphanumerics to '_',
-- uppercase. Skips any ledger already linked or already present by name.
-- The app's "Sync from Accounts ledgers" button re-runs this same logic,
-- so later ledger additions don't need another migration.
insert into student.fee_types (name, code, description, is_active, ledger_id, sort_order)
select
  l.name,
  trim(both '_' from upper(regexp_replace(regexp_replace(l.name, '-INC$', '', 'i'), '[^a-zA-Z0-9]+', '_', 'g'))),
  'Linked to Accounts ledger: ' || l.name,
  true,
  l.id,
  row_number() over (order by l.id)
from accounts.ledgers l
join accounts.account_groups g on g.id = l.group_id
where g.name = 'Direct Income'
  and not exists (
    select 1 from student.fee_types ft
    where ft.ledger_id = l.id or lower(ft.name) = lower(l.name)
  )
on conflict do nothing;

notify pgrst, 'reload schema';
