-- A single lock switch for the MPO Amount screen — once this year's
-- government allocation figures are entered and payroll has started using
-- them, lock them from casual edits. Manual lock (any payroll admin);
-- unlock is Super Admin only, same pattern as payroll.runs.is_locked.
-- Run in Supabase SQL editor.

create table if not exists payroll.mpo_lock (
  id int primary key default 1,
  is_locked boolean not null default false,
  locked_by text,
  locked_at timestamptz,
  constraint mpo_lock_singleton check (id = 1)
);
insert into payroll.mpo_lock (id, is_locked) values (1, false) on conflict (id) do nothing;

grant select, insert, update on payroll.mpo_lock to service_role;

notify pgrst, 'reload schema';
