-- Fixes the silent-upsert-failure bug: migration_admission_applications_merge_candidates.sql
-- created admission_applications_circular_external_key_idx as a PARTIAL
-- unique index (`where external_key is not null`). Postgres can only use a
-- partial index as an ON CONFLICT arbiter when the ON CONFLICT clause
-- repeats its WHERE predicate -- PostgREST's `on_conflict=circular_id,external_key`
-- query param has no way to express that, so every VortiBD sync / manual
-- Excel import upsert (_upsertMappedRows in app/api/admission-candidates/route.js
-- and app/api/vortibd-cron/route.js) was failing with
-- "no unique or exclusion constraint matching the ON CONFLICT specification",
-- an error neither caller checked for -- they reported a confident success
-- with row counts regardless, while nothing was actually written.
--
-- Every row ever written through that upsert path already requires a
-- non-empty external_key before it's included at all, so dropping the
-- partial predicate changes no real behavior for it. Native, admin-created
-- rows (which never set external_key) are unaffected either way: Postgres'
-- standard unique-index semantics already treat NULL as never equal to
-- another NULL, so any number of native rows with a null external_key can
-- coexist under a plain (non-partial) unique index too.
drop index if exists admission.admission_applications_circular_external_key_idx;
create unique index if not exists admission_applications_circular_external_key_idx
  on admission.admission_applications (circular_id, external_key);

notify pgrst, 'reload schema';
