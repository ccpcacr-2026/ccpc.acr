-- MPO Bill (DSHE Monthly EFT Payment Sheet) support.
--
-- The MPO "Pay Code" is Bangladesh's national government pay scale — NOT
-- the same numbering as this school's own internal Grade system, and the
-- two do not correspond (confirmed directly: Shyama Prasad Mitra's own
-- internal grade is G-4 per the Teacher-College sheet, but their real MPO
-- Pay Code is 6 per the actual MPO bill PDF). So this is a wholly separate
-- Pay-Code + Step + Basic-matrix system, mirroring the shape of the
-- existing internal Grade/Step feature but never sharing rows with it.
--
-- The MPO percentage-rate schedule (Incentive/House Rent/Welfare/
-- Retirement) is admin-editable per pay code, not hardcoded — MPO
-- circulars revise these over time and this migration cannot respond to
-- one it doesn't have to hand. Defaults below are only what's directly
-- computable from the two real MPO bill PDFs provided (August 2026, pay
-- codes 6/8/9/10/14/15/19) — every other pay code is left with rates NULL
-- for the admin to fill in from the actual circular before relying on it.
--
-- Run in Supabase SQL editor.

-- The one field requested on the person's own permanent record — a
-- government-issued MPO Index Number (e.g. "C442361"), unlike Grade/Step
-- this never changes and has nothing to do with month-to-month payroll.
alter table payroll.person_setup add column if not exists mpo_index text;

create table if not exists payroll.mpo_grades (
  id bigint generated always as identity primary key,
  pay_code integer not null unique,
  label text,
  mpo_incentive_percent numeric,
  mpo_house_rent_percent numeric,
  mpo_house_rent_min numeric,
  mpo_welfare_percent numeric,
  mpo_retirement_percent numeric,
  mpo_medical_amount numeric
);

create table if not exists payroll.mpo_steps (
  id bigint generated always as identity primary key,
  step_number integer not null unique
);

create table if not exists payroll.mpo_grade_step_values (
  id bigint generated always as identity primary key,
  mpo_grade_id bigint not null references payroll.mpo_grades(id) on delete cascade,
  mpo_step_id bigint not null references payroll.mpo_steps(id) on delete cascade,
  basic_value numeric,
  unique (mpo_grade_id, mpo_step_id)
);

-- The MPO roster itself — deliberately separate from person_setup/the main
-- payroll roster: being on payroll doesn't mean being MPO-listed, and an
-- admin must be able to add/remove someone here without touching their
-- payroll record. One row per person per institution (School vs College
-- are two entirely separate government bills/EIINs).
--
-- Basic comes from mpo_grade_id + mpo_step_id (this table's own matrix)
-- UNLESS basic_override is set, in which case that fixed value is used
-- directly instead — "admin will update the basic OR select the grade
-- + step" from the request, same current-vs-pinned shape as the existing
-- Reference Basic feature elsewhere in Payroll.
create table if not exists payroll.mpo_roster (
  id bigint generated always as identity primary key,
  user_id text not null references payroll.person_setup(user_id) on delete cascade,
  institution text not null check (institution in ('school', 'college')),
  mpo_grade_id bigint references payroll.mpo_grades(id) on delete set null,
  mpo_step_id bigint references payroll.mpo_steps(id) on delete set null,
  basic_override numeric,
  subject text,
  date_of_birth date,
  bank_acc_no text,
  arrear numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, institution)
);

-- Seeded strictly from what's arithmetically verifiable in the two sample
-- PDFs (Incentive/House Rent as % of Basic; Welfare 4% and Retirement 6%
-- held consistently across every single row in both files). Pay code 19's
-- House Rent (Tk 2000 flat, below the computed 15%) is the only evidence
-- of a minimum floor — seeded only on the one pay code it was observed on.
insert into payroll.mpo_grades (pay_code, label, mpo_incentive_percent, mpo_house_rent_percent, mpo_house_rent_min, mpo_welfare_percent, mpo_retirement_percent, mpo_medical_amount) values
  (6,  'Pay Code 6',  10, 15, null, 4, 6, 500),
  (8,  'Pay Code 8',  10, 15, null, 4, 6, 500),
  (9,  'Pay Code 9',  10, 15, null, 4, 6, 500),
  (10, 'Pay Code 10', 15, 15, null, 4, 6, 500),
  (14, 'Pay Code 14', 15, 15, null, 4, 6, 500),
  (15, 'Pay Code 15', 15, 15, null, 4, 6, 500),
  (19, 'Pay Code 19', 15, 15, 2000, 4, 6, 500)
on conflict (pay_code) do nothing;

insert into payroll.mpo_steps (step_number) select generate_series(1, 20)
  on conflict (step_number) do nothing;

grant select, insert, update, delete on payroll.mpo_grades to service_role;
grant select, insert, update, delete on payroll.mpo_steps to service_role;
grant select, insert, update, delete on payroll.mpo_grade_step_values to service_role;
grant select, insert, update, delete on payroll.mpo_roster to service_role;
grant usage, select on all sequences in schema payroll to service_role;

notify pgrst, 'reload schema';
