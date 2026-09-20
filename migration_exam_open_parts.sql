-- Which exam parts are open for marks entry, per exam.
--   null  = every part is open (how exams behaved before)
--   []    = entry closed
--   [1,5] = only those parts are open
alter table exam.exams add column if not exists open_parts jsonb;

notify pgrst, 'reload schema';
