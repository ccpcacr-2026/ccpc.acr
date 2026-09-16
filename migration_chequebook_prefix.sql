-- A real cheque leaf's printed number is often a fixed text prefix plus
-- an incrementing, zero-padded numeric part (e.g. "KA00123"), not always
-- a bare integer. range_start/range_end stay plain integers (so a range
-- can still be expanded/incremented normally); prefix + pad_width let
-- the full printed string be rebuilt around that number. Existing rows
-- (if any were already saved before this ran) default to no prefix and
-- unpadded, i.e. exactly how they behaved before this migration.
--
-- Run this AFTER migration_bill_creation.sql (which creates
-- accounts.chequebook_ranges). Safe to run multiple times.

alter table accounts.chequebook_ranges
  add column if not exists prefix text not null default '',
  add column if not exists pad_width integer not null default 1;

notify pgrst, 'reload schema';
