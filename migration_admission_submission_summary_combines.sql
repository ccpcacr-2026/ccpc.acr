alter table admission.exam_circulars
  add column if not exists submission_summary_combines jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
