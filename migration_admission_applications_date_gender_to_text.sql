-- Fixes error 22008 "date/time field value out of range: '17-12-2017'":
-- date_of_birth turned out to be a real `date`-typed column (not missing,
-- unlike guardian_nid -- a different failure mode of the same root issue:
-- BUILTIN_FORM_FIELDS' declared `type` was never checked against what the
-- live column actually is). Excel/VortiBD exports carry dates in whatever
-- format the source system uses (here DD-MM-YYYY), which a strict `date`
-- column rejects outright unless it happens to match the server's
-- DATESTYLE setting. gender (`type: 'select'`) carries the same risk if the
-- source's values don't exactly match whatever that column's type expects.
--
-- Converts both to plain text, matching how every other optional field
-- here is already stored -- the native admin editor's own <input
-- type="date">/<select> already read/write plain strings either way, so
-- this changes nothing for native data entry; it just stops the column
-- itself from rejecting an imported value it doesn't like the shape of.
alter table admission.admission_applications
  alter column date_of_birth type text using date_of_birth::text,
  alter column gender type text using gender::text;

notify pgrst, 'reload schema';
