-- A term can hold several exams for the same class (e.g. Class Test 1,
-- Class Test 2 and the Half Yearly itself), with the same or different
-- exam patterns. Each exam gets a name; the name must be unique per class
-- within a term instead of the class being unique per term.
alter table exam.exams add column if not exists name text;

alter table exam.exams drop constraint if exists exams_term_id_pattern_id_key;
drop index if exists exam.exams_term_id_pattern_id_key;

create unique index if not exists exams_term_class_name_uidx
  on exam.exams (term_id, pattern_id, coalesce(name, ''));

notify pgrst, 'reload schema';
