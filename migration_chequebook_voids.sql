-- Tracks individual chequebook pages marked spoiled/torn/wasted -- i.e.
-- removed from the available pool WITHOUT ever being tied to a real
-- bill. Kept as its own table, separate from accounts.bills, because a
-- wasted page was never actually paid out -- it has no voucher, no
-- amount, nothing to post to the books. "Available" (in
-- get_chequebook_ranges) is: every number in a registered range, minus
-- whatever appears here, minus whatever's already used in accounts.bills.
--
-- Safe to run multiple times. Run in Supabase SQL editor.

create table if not exists accounts.chequebook_voids (
  id bigint generated always as identity primary key,
  ledger_id bigint not null references accounts.ledgers(id) on delete cascade,
  cheque_no text not null,
  reason text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (ledger_id, cheque_no)
);
create index if not exists chequebook_voids_ledger_idx on accounts.chequebook_voids(ledger_id);

grant select, insert, update, delete on accounts.chequebook_voids to service_role;
grant usage, select on all sequences in schema accounts to service_role;

notify pgrst, 'reload schema';
