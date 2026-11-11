-- Adds an explicit, admin-settable Building field to exam_rooms. Previously
-- building was only ever derived client-side from the room name's own
-- prefix (e.g. "SB-101" -> School Building) with no way to set one directly
-- for rooms that don't follow that naming convention. The derivation stays
-- as a fallback/default suggestion; an explicit value here always wins.
alter table admission.exam_rooms
  add column if not exists building text;

notify pgrst, 'reload schema';
