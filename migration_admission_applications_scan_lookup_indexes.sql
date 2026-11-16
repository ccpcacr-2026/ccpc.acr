-- findCandidateByCode (app/api/admission-candidates/route.js) -- called on
-- EVERY QR scan, both the lookup step and the mark/apply step -- tries
-- token, external_key, tracking_id, index_id in turn. Only external_key
-- has ever had an index (admission_applications_circular_external_key_idx).
-- token is tried FIRST and is what most QR codes actually encode
-- (qr_data: c.token || c.external_key) -- with no index on it, every scan
-- that matches by token forces a full sequential scan of the whole
-- admission_applications table (thousands of rows, wide jsonb columns)
-- just to find one row. Under sustained concurrent scanning (several
-- devices scanning continuously) this is a real, measurable disk-IO cost.
--
-- Partial (where ... is not null) since a given row typically has EITHER
-- token (online/VortiBD-sourced) OR tracking_id/index_id (native,
-- admin-created) -- keeps each index small and cheap to maintain.
create index if not exists admission_applications_circular_token_idx
  on admission.admission_applications (circular_id, token) where token is not null;
create index if not exists admission_applications_circular_tracking_id_idx
  on admission.admission_applications (circular_id, tracking_id) where tracking_id is not null;
create index if not exists admission_applications_circular_index_id_idx
  on admission.admission_applications (circular_id, index_id) where index_id is not null;

notify pgrst, 'reload schema';
