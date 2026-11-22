-- The native "Index ID Counters" system (Part 1) created admission_applications
-- with a table-wide UNIQUE constraint directly on index_id, outside any
-- migration tracked in this repo -- reasonable back when only native,
-- admin-created applications ever wrote to that column (buildIndexId()
-- genuinely guarantees uniqueness there, and always within one circular).
--
-- Making index_id directly mappable in the Candidates import/VortiBD sync
-- (this session's fix) broke that assumption: an imported circular's own
-- "Index No." values are only meaningful/unique WITHIN that circular, not
-- across the whole table -- exactly like external_key already works
-- (admission_applications_circular_external_key_idx, Part 8). A table-wide
-- constraint then rejects any import whose Index No. happens to collide
-- with a DIFFERENT circular's row, even though the two are unrelated.
--
-- Replace the blanket constraint with the same circular-scoped partial
-- pattern already used for external_key. This also subsumes the earlier
-- plain lookup index (admission_applications_circular_index_id_idx, from
-- migration_admission_applications_scan_lookup_indexes.sql) -- recreated
-- here as UNIQUE so there's one index doing both jobs, not two.
do $$
declare
  conname text;
begin
  select con.conname into conname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
  where nsp.nspname = 'admission'
    and rel.relname = 'admission_applications'
    and con.contype = 'u'
    and array_length(con.conkey, 1) = 1
    and att.attname = 'index_id';
  if conname is not null then
    execute format('alter table admission.admission_applications drop constraint %I', conname);
  end if;
end $$;

drop index if exists admission.admission_applications_circular_index_id_idx;
create unique index if not exists admission_applications_circular_index_id_idx
  on admission.admission_applications (circular_id, index_id) where index_id is not null;

notify pgrst, 'reload schema';
