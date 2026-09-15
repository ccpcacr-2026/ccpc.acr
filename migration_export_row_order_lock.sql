-- Per-Payroll-Group lock for the Export Row Order screen. Mirrors
-- payroll.mpo_lock (same is_locked/locked_by/locked_at shape, same
-- "anyone locks, only a Super Admin unlocks" rule) but keyed by
-- group_id instead of a single row, since Row Order now has one tab per
-- Payroll Group and the real workflow is: finish arranging one group,
-- lock it, move to the next -- a single global lock would freeze every
-- group at once, including ones not touched yet.
--
-- No row for a group means "not locked" (checked with a fallback, same
-- as mpo_lock's own convention) -- a row only gets inserted the first
-- time that group is actually locked.
--
-- Run in Supabase SQL editor.

create table if not exists payroll.export_row_order_lock (
  group_id bigint primary key references payroll.payroll_groups(id) on delete cascade,
  is_locked boolean not null default false,
  locked_by text,
  locked_at timestamptz
);

grant select, insert, update, delete on payroll.export_row_order_lock to service_role;

notify pgrst, 'reload schema';
