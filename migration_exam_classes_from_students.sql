-- Exam subject lists (exam.class_patterns) now apply to a SCOPE of real
-- students from the student database instead of Class Setup's manual
-- section mapping:
--   class_name    required once scoped, e.g. 'Ten'
--   section       null = any section           e.g. 'A'
--   student_group null = any group             e.g. 'Science'
--   session       null = any session           e.g. '2026'
-- When several lists fit a student, the one created / edited most recently
-- (scope_updated_at) wins; automatic per-class lists have no timestamp and
-- rank below any list set up by hand (among them the most specific wins:
-- section, then session, then group). display_name is an optional name shown
-- instead of the scope, e.g. 'Grade Six' for Six.
alter table exam.class_patterns
  add column if not exists class_name    text,
  add column if not exists section       text,
  add column if not exists student_group text,
  add column if not exists session       text,
  add column if not exists display_name  text,
  add column if not exists scope_updated_at timestamptz;

create unique index if not exists class_patterns_scope_uidx
  on exam.class_patterns (class_name, coalesce(section, ''), coalesce(student_group, ''), coalesce(session, ''))
  where class_name is not null;

-- Link the existing subject lists to their real class (+ group).
update exam.class_patterns p
   set class_name = v.class_name, student_group = v.student_group
  from (values
    ('Nursery', 'Nursery', null), ('KG', 'KG', null),
    ('One', 'One', null), ('Two', 'Two', null), ('Three', 'Three', null), ('Four', 'Four', null),
    ('Five', 'Five', null), ('Six', 'Six', null), ('Seven', 'Seven', null), ('Eight', 'Eight', null),
    ('Nine-Science', 'Nine', 'Science'), ('Nine-Com', 'Nine', 'Business Studies'),
    ('Ten-Science', 'Ten', 'Science'), ('Ten-Com', 'Ten', 'Business Studies'),
    ('Eleven-Science', 'Eleven', 'Science'), ('Eleven-Com', 'Eleven', 'Business Studies'),
    ('Eleven-Hum', 'Eleven', 'Humanities'), ('Twelve', 'Twelve', null)
  ) as v(old_name, class_name, student_group)
 where p.name = v.old_name and p.class_name is null;

notify pgrst, 'reload schema';
