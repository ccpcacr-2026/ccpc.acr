-- Extends Bonus Payments with the same three choices any bonus needs:
--   1. who it applies to (one person, or everyone at once) -- a frontend/
--      creation-time concern, doesn't need its own column: "everyone" just
--      means one bonus_payments row gets inserted per active person.
--   2. how the amount is decided -- amount_mode:
--        'fixed'   a flat Taka figure, same meaning as today.
--        'percent' a percentage of another field's (or Gross/Net/Total
--                  Deductions') own resolved value for that person, that
--                  month -- computed ONCE at creation time and stored as a
--                  plain `amount`, same as a fixed bonus is just a number;
--                  it does not recompute later if the base field's value
--                  changes afterward (a bonus is a one-off historical
--                  record, not an ongoing formula). base_field_key/percent
--                  are kept alongside purely so the amount is still
--                  auditable later ("this was 50% of August's Basic").
--   3. where it shows up -- merge_field_key:
--        null      the existing behavior: folds into the generic Bonus
--                  column (fieldValues.bonus_total), its own line.
--        <a field> adds this bonus's amount directly into that field's OWN
--                  resolved value for the person instead -- e.g. a
--                  "performance bonus" merged into Special Allowance shows
--                  up there, not as a separate Bonus line.
--
-- Run in Supabase SQL editor.

alter table payroll.bonus_payments add column if not exists amount_mode text not null default 'fixed';
do $$ begin
  alter table payroll.bonus_payments add constraint bonus_payments_amount_mode_check check (amount_mode in ('fixed', 'percent')) not valid;
exception when duplicate_object then null;
end $$;
alter table payroll.bonus_payments validate constraint bonus_payments_amount_mode_check;
alter table payroll.bonus_payments add column if not exists base_field_key text;
alter table payroll.bonus_payments add column if not exists percent numeric;
alter table payroll.bonus_payments add column if not exists merge_field_key text;

notify pgrst, 'reload schema';
