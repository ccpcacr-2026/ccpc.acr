-- Repoints admission_applications.room_id at the portal-wide
-- inventory.rooms registry instead of admission.exam_rooms, so a room's
-- name/building/capacity is one shared row used by Admission, the new Exam
-- module Seat Plan feature, and Inventory Admin alike -- not three separate
-- hand-maintained lists. Safe to do as a straight FK repoint, right now,
-- specifically because no circular has ever had a room added or a candidate
-- allocated yet (confirmed live: the Rooms tab shows "No rooms yet" on
-- every circular) -- there is no existing room_id data to remap.
-- admission.exam_rooms itself is left in place, inert, never dropped, per
-- this repo's convention -- it's simply not referenced going forward.
alter table admission.admission_applications
  drop constraint if exists admission_applications_room_id_fkey;
alter table admission.admission_applications
  add constraint admission_applications_room_id_fkey
  foreign key (room_id) references inventory.rooms(id) on delete set null;

notify pgrst, 'reload schema';
