-- Contractual pay system + grade/step promotion history
-- Run in Supabase SQL editor.

-- 1. A grade now belongs to one of two systems. Existing grades default to
--    'regular' so nothing already configured changes meaning.
alter table payroll.grades add column if not exists pay_system text not null default 'regular';
alter table payroll.grades drop constraint if exists grades_pay_system_check;
alter table payroll.grades add constraint grades_pay_system_check check (pay_system in ('regular', 'contractual'));

-- 2. A person is on one system or the other — determines which grade list
--    they're assigned from, independent of which grade_id they currently hold.
alter table payroll.person_setup add column if not exists pay_type text not null default 'regular';
alter table payroll.person_setup drop constraint if exists person_setup_pay_type_check;
alter table payroll.person_setup add constraint person_setup_pay_type_check check (pay_type in ('regular', 'contractual'));

-- 3. Grade/step promotion history — one row per change, so the People Setup
--    roster can show joining date plus every later promotion date inline,
--    not just the person's current grade/step.
create table if not exists payroll.person_grade_history (
  id bigint generated always as identity primary key,
  user_id text not null,
  grade_id bigint references payroll.grades(id),
  step_id bigint references payroll.pay_steps(id),
  pay_type text not null default 'regular',
  effective_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists person_grade_history_user_id_idx on payroll.person_grade_history (user_id, effective_date);

grant select, insert, update, delete on payroll.person_grade_history to service_role;
grant usage, select on all sequences in schema payroll to service_role;

notify pgrst, 'reload schema';

-- Steps now number from 0, not 1. Safe to run any time — everything else
-- (grade_step_values, person_setup.step_id, grade_fields.base_step_id)
-- references a step by its id, never its step_number, so relabeling here
-- touches no other table.
update payroll.pay_steps set step_number = step_number - 1, sort_order = sort_order - 1;
notify pgrst, 'reload schema';
