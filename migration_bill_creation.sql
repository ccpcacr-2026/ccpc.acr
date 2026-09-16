-- Backing tables for the dedicated Bill creation screen (Create > Bill,
-- shortcut B) -- see TALLY_MIGRATION_PLAN.md / the "Bill -- dedicated
-- creation screen" plan for the full context.
--
-- accounts.bills is a flat, one-row-per-bill history table (bill number,
-- date, title, description, group, ledger, bank/cash account, cheque no.,
-- amount) -- explicitly requested by the user as its own single table,
-- separate from (and linked to, via voucher_id) the normalized
-- vouchers/voucher_entries double-entry rows that a Bill also creates.
-- Nothing about the existing double-entry schema changes -- Trial
-- Balance/P&L/Balance Sheet/Day Book keep reading voucher_entries exactly
-- as before; this table exists purely so a Bill's own fields (especially
-- its auto-generated number and cheque number) are queryable directly,
-- without reconstructing them by joining back through voucher_entries.
--
-- accounts.chequebook_ranges records the physical chequebook page-number
-- ranges the office has received for a given bank ledger, so the Bill
-- screen can offer a real cheque number to pick from instead of a
-- freehand text field. "Used" is derived live from accounts.bills.cheque_no
-- rather than stored as a flag here, so deleting a range can never
-- desynchronize from history.
--
-- Safe to run multiple times. Run in Supabase SQL editor.

create table if not exists accounts.bills (
  id bigint generated always as identity primary key,
  voucher_id bigint not null unique references accounts.vouchers(id) on delete cascade,
  bill_number text not null,
  bill_date date not null,
  title text,
  description text,
  group_id bigint references accounts.account_groups(id) on delete set null,
  ledger_id bigint not null references accounts.ledgers(id) on delete restrict,
  bank_ledger_id bigint not null references accounts.ledgers(id) on delete restrict,
  cheque_no text,
  amount numeric not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists bills_bank_ledger_idx on accounts.bills(bank_ledger_id);
create index if not exists bills_bill_date_idx on accounts.bills(bill_date);

create table if not exists accounts.chequebook_ranges (
  id bigint generated always as identity primary key,
  ledger_id bigint not null references accounts.ledgers(id) on delete cascade,
  range_start integer not null,
  range_end integer not null,
  created_at timestamptz not null default now(),
  check (range_end >= range_start)
);
create index if not exists chequebook_ranges_ledger_idx on accounts.chequebook_ranges(ledger_id);

grant select, insert, update, delete on accounts.bills to service_role;
grant select, insert, update, delete on accounts.chequebook_ranges to service_role;
grant usage, select on all sequences in schema accounts to service_role;

notify pgrst, 'reload schema';
