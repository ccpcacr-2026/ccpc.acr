-- Follow-up to migration_admission_applications_index_id_scope_fix.sql: that
-- migration scoped the blanket unique constraint on index_id to per-circular
-- instead of table-wide, but a real import still hit it -- two different
-- VortiBD candidates (different external_key/ID) in the SAME circular
-- legitimately share one Index No. (e.g. multiple program applications for
-- one physical candidate/seat). index_id is a display/reference field here,
-- not a matching key (external_key already serves that role via
-- admission_applications_circular_external_key_idx) -- it should never have
-- been unique for imported data. The native Index ID Counters system
-- already guarantees uniqueness for admin-created applications through its
-- own sequential generation logic, with no need for a DB-level constraint
-- to back it up.
drop index if exists admission.admission_applications_circular_index_id_idx;
create index if not exists admission_applications_circular_index_id_idx
  on admission.admission_applications (circular_id, index_id) where index_id is not null;

notify pgrst, 'reload schema';
