-- How each exam part's pass mark is read (Subject Setup → class cards).
--   pass_type  'number'  : pass_marks is a mark, e.g. 23
--              'percent' : pass_marks is a percentage, e.g. 33 (%)
--   pass_basis 'marks'   : compared against the marks the student got
--              'weight'  : compared against those marks after the part's
--                          weight is applied (marks × weight_percent / 100)
-- Existing rows keep today's meaning: a plain number on raw marks.
alter table exam.subject_components
  add column if not exists pass_type  text not null default 'number',
  add column if not exists pass_basis text not null default 'marks';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subject_components_pass_type_chk') then
    alter table exam.subject_components
      add constraint subject_components_pass_type_chk check (pass_type in ('number', 'percent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subject_components_pass_basis_chk') then
    alter table exam.subject_components
      add constraint subject_components_pass_basis_chk check (pass_basis in ('marks', 'weight'));
  end if;
end $$;

notify pgrst, 'reload schema';
