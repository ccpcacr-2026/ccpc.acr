-- Full rebuild of the Payroll Groups ("Group Maker") schema.
--
-- The earlier migration_payroll_groups.sql was marked done but never
-- actually took effect in this database -- payroll_groups,
-- payroll_group_designations and payroll_group_members do not exist in the
-- live schema at all (confirmed live: every query against them returns
-- PostgREST's "table not found" error, not just a stale-cache symptom).
-- The tables below are therefore created fresh, idempotently.
--
-- Restructured per the user's decision: 4 groups --
--   Teaching (School), Teaching (College),
--   Non-Teaching (School), Non-Teaching (College)
-- replacing the earlier draft's split (Teacher School / Teacher College /
-- Driver-Helper / flat Staff).
--
-- The Teaching/Teaching split is assigned purely by designation -- verified
-- against the full live roster via teacher_id's own numbering convention
-- (11/12 = School Teacher, 20/21/22 = College Teacher, 31/32 = School
-- Staff, 41/42 = College Staff), which every one of the 253 profiles with a
-- standard-issue id follows, with ZERO designation ever shared between
-- School and College teaching titles.
--
-- Non-Teaching is different: of the ~27 non-teaching job titles in use, 11
-- (Security Guard, Driver, Cleaner, Bus Assistant, Aya, Peon, Computer
-- Operator, Electrician, Mali, MLSS, Accounts Assistant) are held by real
-- people at BOTH institutions -- a designation-only rule would put every
-- Security Guard in one group regardless of which one they actually work
-- at. So every current Non-Teaching person gets an explicit, individual
-- membership below (which always outranks the designation rule -- see
-- payroll_group_members), while designation rules are still set for the 16
-- titles that are genuinely single-institution today, so a NEW hire with
-- one of those specific titles auto-classifies. A new hire with one of the
-- 11 shared titles will still need one manual click in Payroll Groups.
--
-- 4 people had no institution signal of their own -- synthetic ids (added
-- via "Add Person" after the original sheet import, so they carry none of
-- the institution-coded numbering) with a shared title and a blank
-- department field. Placed per the user's own confirmation:
--   Lipu Kumar Shill (989464089, Mali) -> School
--   Md. Rabiul Alam (992925654, Driver) -> School
--   Md. Russel (956087729, Driver) -> College
--   Nasima Akter (957487196, Cleaner (Contractual)) -> College
-- Also excluded as not real staff: teacher_id 'notebooklm_import' (name
-- "CCPC", an import artifact) and '36936989' (blank name/designation, an
-- orphaned record).
--
-- Run in Supabase SQL editor.

create table if not exists payroll.payroll_groups (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists payroll.payroll_group_designations (
  id bigint generated always as identity primary key,
  group_id bigint not null references payroll.payroll_groups(id) on delete cascade,
  designation text not null unique
);

create table if not exists payroll.payroll_group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references payroll.payroll_groups(id) on delete cascade,
  user_id text not null unique,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on payroll.payroll_groups to service_role;
grant select, insert, update, delete on payroll.payroll_group_designations to service_role;
grant select, insert, update, delete on payroll.payroll_group_members to service_role;
grant usage, select on all sequences in schema payroll to service_role;

-- Clean slate, per instruction -- delete all existing grouping before
-- rebuilding (harmless today since none of this existed yet, but makes the
-- migration safely re-runnable).
delete from payroll.payroll_group_members;
delete from payroll.payroll_group_designations;
delete from payroll.payroll_groups;

insert into payroll.payroll_groups (name, sort_order) values
  ('Teaching (School)', 1), ('Teaching (College)', 2),
  ('Non-Teaching (School)', 3), ('Non-Teaching (College)', 4);

do $$
declare
  g_ts bigint; g_tc bigint; g_ns bigint; g_nc bigint;
begin
  select id into g_ts from payroll.payroll_groups where name = 'Teaching (School)';
  select id into g_tc from payroll.payroll_groups where name = 'Teaching (College)';
  select id into g_ns from payroll.payroll_groups where name = 'Non-Teaching (School)';
  select id into g_nc from payroll.payroll_groups where name = 'Non-Teaching (College)';

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_ts, d from unnest(array['Assistant Librarian','Assistant Teacher','Senior Teacher','VP & Senior Teacher']) as d;

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_tc, d from unnest(array['Assistant Professor','Associate Professor','Demonstrator','Instructor','Lecturer','Librarian','Principal','Professor','VP & Professor']) as d;

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_ns, d from unnest(array['Accountant','Caretaker','Carpenter','Medical Assistant','Office Super','Uda']) as d;

  insert into payroll.payroll_group_designations (group_id, designation)
  select g_nc, d from unnest(array['Accounts Officer','Administrative Officer','Clerk','Lab Attendant','Library Assistant','Maintenance Officer','Office Assistant','PA to Principal','Security Supervisor','System and IT Technician']) as d;

  -- Explicit per-person membership -- every current Non-Teaching person,
  -- School side (guarantees correctness today regardless of the 11 shared
  -- job titles above). Includes Lipu Kumar Shill (989464089) and Md. Rabiul
  -- Alam (992925654), the 2 synthetic-id people confirmed School-side.
  insert into payroll.payroll_group_members (group_id, user_id)
  select g_ns, u from unnest(array['32006126','32015113','32004110','32007133','32011142','32011102','32011140','32016150','32002129','32001122','32006132','32023165','32012146','32016152','32018162','32016154','32003124','32003131','31993103','31996117','32016114','32011143','32016155','32017156','32017155','32017157','32009116','32018161','32023163','32025169','32001120','32016151','32000127','32000119','32000118','32013147','32024166','32001123','32023164','32011139','32000104','32016115','32024168','32009135','32012138','32016149','32011144','32002128','32013106','32001121','32009111','32009136','32003125','32018160','32003130','32011145','989464089','992925654']) as u;

  -- Same for the College side. Includes Md. Russel (956087729) and Nasima
  -- Akter (957487196), the 2 synthetic-id people confirmed College-side.
  insert into payroll.payroll_group_members (group_id, user_id)
  select g_nc, u from unnest(array['42000109','42011136','42007129','42011138','42012132','42011111','42015115','42025174','42016148','42008108','42015144','42016154','42011112','42019163','41993119','42019164','42012140','42013142','42011135','42017156','42012104','42002125','42015146','42015116','42015145','42017159','42016155','42018158','42016118','42016153','42011137','42016117','42003126','42001124','42016150','41994102','42005127','41997107','42025173','42015147','42024169','42024168','42025175','42024172','42012101','42001103','42016151','42015114','42012133','42009130','42014143','42000123','42011139','42018161','42018160','42017157','42011134','42013141','42016149','956087729','957487196']) as u;
end $$;

notify pgrst, 'reload schema';
