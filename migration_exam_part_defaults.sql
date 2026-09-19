-- Default setup for each exam part (CT, CQ, MCQ, Practical…), edited in
-- Subject Setup → Exam Parts. Used whenever that part is created on a
-- subject: when a subject is added to a class, and when marks are typed
-- into an empty part. The values are only a starting point, edited later.
alter table exam.exam_component_types
  add column if not exists default_full_marks     numeric not null default 100,
  add column if not exists default_weight_percent numeric not null default 100,
  add column if not exists default_pass_marks     numeric not null default 33,
  add column if not exists default_pass_type      text    not null default 'number',
  add column if not exists default_pass_basis     text    not null default 'marks';

notify pgrst, 'reload schema';
