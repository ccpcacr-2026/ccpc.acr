-- Part 3: VortiBD-parity "Configure Downloads" additions for exam_circulars/exam_candidates
-- (admit-card release gating + per-circular instructions, apply declaration, SMS on submit)

alter table admission.exam_circulars
  add column if not exists admit_instant boolean not null default true;
alter table admission.exam_circulars
  add column if not exists admit_release_at timestamptz;
alter table admission.exam_circulars
  add column if not exists admit_instructions text;
alter table admission.exam_circulars
  add column if not exists apply_declaration text not null default 'I hereby declare that the above-made information is true and correct to the best of my knowledge.';
alter table admission.exam_circulars
  add column if not exists sms_on_submit boolean not null default false;
alter table admission.exam_circulars
  add column if not exists sms_template text default 'Your application has been received. Your token is {token}.';

alter table admission.exam_candidates
  add column if not exists mobile text;

notify pgrst, 'reload schema';
