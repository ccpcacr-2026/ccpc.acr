-- Adds a Session layer above Circular (see migration_admission_candidates_
-- circulars.sql): each session (e.g. an admission year, typed freely --
-- "2026") holds its own circulars, and the same circular name can now
-- recur across different sessions without colliding. Run in Supabase SQL
-- editor AFTER migration_admission_candidates_circulars.sql.

create table if not exists admission.exam_sessions (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists exam_sessions_name_idx on admission.exam_sessions (lower(name));

alter table admission.exam_circulars
  add column if not exists session_id bigint references admission.exam_sessions(id) on delete cascade;

-- Which of the school's own student-data values (Class/Version/Category --
-- see FEE_SCOPE_COLS in app/api/student-admin/route.js for the real column
-- names) this circular applies to, e.g. {"class":["Six","Seven"]}. Empty/
-- missing means "applies to all". Enforced at import time for the two
-- fields exam_candidates actually models (class, category).
alter table admission.exam_circulars
  add column if not exists bounds jsonb not null default '{}'::jsonb;

-- "version" becomes a real modeled column (alongside token/candidate_name/
-- class/category) so a circular's Version bound can actually be enforced
-- at import, not just class/category.
alter table admission.exam_candidates
  add column if not exists version text;

-- Intake mode + public/active flag. `mode` is stored now; the UI surfaces
-- it, but nothing yet actually opens or gates a live public application
-- form when mode='online' and is_active=true -- that's a separate
-- integration with the native Admission Admin application flow (Part 1),
-- still to be scoped out before building.
alter table admission.exam_circulars
  add column if not exists mode text not null default 'offline' check (mode in ('offline', 'online'));
alter table admission.exam_circulars
  add column if not exists is_active boolean not null default false;

-- Which Form/Admit-Card template (from the native Form/Admit Designer --
-- admission_settings.form_templates/admit_templates, see _admLoadForm
-- Templates/_admLoadAdmitTemplates) applies per class/version/category
-- combination within this circular, plus a default pair for combinations
-- with no specific override. Shape: {default:{form_template_id,
-- admit_template_id}, variations:[{key,class,version,category,
-- form_template_id,admit_template_id}, ...]}. Selection/storage only for
-- now -- not yet wired into actual print rendering (see migration
-- comment history / the plan this was built from for that follow-up).
alter table admission.exam_circulars
  add column if not exists template_map jsonb not null default '{}'::jsonb;

-- Which fields must hold unique values when a candidate is entered/edited
-- by a user through the (not-yet-built) ONLINE intake form -- e.g. don't
-- let two online submissions reuse the same phone number. Config/storage
-- only: there is no live single-record add/edit surface yet to actually
-- enforce this against (bulk Excel import already has its own, separate
-- upsert-by-primary-key uniqueness, unaffected by this). Empty array (the
-- default) means no uniqueness check at all.
alter table admission.exam_circulars
  add column if not exists unique_fields jsonb not null default '[]'::jsonb;

drop index if exists admission.exam_circulars_name_idx;
create unique index if not exists exam_circulars_session_name_idx on admission.exam_circulars (session_id, lower(name));

grant select, insert, update, delete on admission.exam_sessions to service_role;
grant usage, select on all sequences in schema admission to service_role;

notify pgrst, 'reload schema';
