-- Foundational schema for the Tally replacement -- chart of accounts,
-- ledgers, and vouchers (double-entry transactions). See
-- TALLY_MIGRATION_PLAN.md for the full context/decision history.
--
-- Deliberately its own schema (`accounts`), same one-schema-per-module
-- pattern as `payroll`/`inventory`/`student` -- reached via
-- Accept-Profile/Content-Profile headers from a dedicated
-- app/api/accounts-admin/route.js (not written yet).
--
-- Modeled directly on Tally's own data model so the planned XML importer
-- has an obvious, near-1:1 target: Tally "Groups" -> account_groups,
-- "Ledgers" -> ledgers, "Vouchers" -> vouchers + voucher_entries (one row
-- per debit/credit line, debit/credit kept as two separate columns
-- exactly like Tally's own reports show them, rather than one signed
-- amount + a side flag).
--
-- Safe to run multiple times (create-if-not-exists + on-conflict seeds).
-- Run in Supabase SQL editor. After running, this schema ALSO needs to be
-- added under Settings -> API -> Data API -> "Exposed schemas" in the
-- Supabase dashboard -- the same manual step payroll/inventory/student
-- needed earlier. PostgREST will not serve Accept-Profile: accounts
-- until that's done; no SQL statement can do that part.

create schema if not exists accounts;
grant usage on schema accounts to service_role;

-- Tally's "Groups" -- a small fixed hierarchy an admin rarely edits.
-- Names are unique across the WHOLE chart (not just within a parent),
-- matching Tally's own rule that no two groups anywhere can share a
-- name. nature drives which side (debit/credit) is that group's
-- "normal" balance, needed to render Trial Balance / P&L / Balance
-- Sheet without guessing from the numbers alone.
create table if not exists accounts.account_groups (
  id bigint generated always as identity primary key,
  name text not null unique,
  parent_group_id bigint references accounts.account_groups(id) on delete set null,
  nature text not null check (nature in ('asset', 'liability', 'income', 'expense', 'equity')),
  created_at timestamptz not null default now()
);

-- Tally's "Ledgers" -- the actual accounts vouchers post against (Cash,
-- a specific bank account, an expense head, a party). opening_balance
-- follows a debit-positive sign convention throughout this schema (a
-- credit opening balance is simply negative) so a ledger's running
-- balance is always just opening_balance + sum(debit) - sum(credit).
create table if not exists accounts.ledgers (
  id bigint generated always as identity primary key,
  name text not null unique,
  group_id bigint not null references accounts.account_groups(id) on delete restrict,
  opening_balance numeric not null default 0,
  opening_balance_date date,
  is_active boolean not null default true,
  tally_guid text unique, -- the <GUID> from Tally's export -- lets a
                           -- re-import upsert instead of duplicating,
                           -- and ties an imported row back to its
                           -- Tally source for reconciliation. Null for
                           -- anything created directly in this app.
  created_at timestamptz not null default now()
);

-- One row per real-world transaction (Tally's "Voucher" header).
-- voucher_type is free text, not an enum -- Tally installs can define
-- custom voucher types beyond the standard Payment/Receipt/Journal/
-- Contra/Sales/Purchase six, and the importer should carry over
-- whatever the real export actually contains rather than being blocked
-- by a rigid whitelist.
create table if not exists accounts.vouchers (
  id bigint generated always as identity primary key,
  voucher_type text not null,
  voucher_number text, -- Tally's own number, kept for traceability
  voucher_date date not null,
  narration text,
  tally_guid text unique,
  created_by text, -- app_users.user_id of whoever entered it (null for an imported row)
  created_at timestamptz not null default now()
);

-- The debit/credit lines of a voucher. A balanced voucher's own entries
-- must sum debit = sum credit -- enforced at the application layer when
-- accounts-admin is built (a cross-row DB constraint would need a
-- trigger; deliberately left out of this first migration), the same way
-- Tally itself blocks saving an unbalanced voucher at entry time.
create table if not exists accounts.voucher_entries (
  id bigint generated always as identity primary key,
  voucher_id bigint not null references accounts.vouchers(id) on delete cascade,
  ledger_id bigint not null references accounts.ledgers(id) on delete restrict,
  debit numeric not null default 0,
  credit numeric not null default 0,
  narration text,
  check (debit >= 0 and credit >= 0),
  check (not (debit > 0 and credit > 0)) -- one side or the other, never both, per line
);
create index if not exists voucher_entries_ledger_id_idx on accounts.voucher_entries(ledger_id);
create index if not exists voucher_entries_voucher_id_idx on accounts.voucher_entries(voucher_id);

-- Seed the standard top-level Groups every fresh Tally company ships
-- with -- a real Masters export may add more or rename these; the
-- importer should upsert by name rather than assuming these ids.
insert into accounts.account_groups (name, parent_group_id, nature) values
  ('Capital Account', null, 'equity'),
  ('Loans (Liability)', null, 'liability'),
  ('Current Liabilities', null, 'liability'),
  ('Fixed Assets', null, 'asset'),
  ('Investments', null, 'asset'),
  ('Current Assets', null, 'asset'),
  ('Direct Income', null, 'income'),
  ('Indirect Income', null, 'income'),
  ('Direct Expenses', null, 'expense'),
  ('Indirect Expenses', null, 'expense')
on conflict (name) do nothing;

grant select, insert, update, delete on accounts.account_groups to service_role;
grant select, insert, update, delete on accounts.ledgers to service_role;
grant select, insert, update, delete on accounts.vouchers to service_role;
grant select, insert, update, delete on accounts.voucher_entries to service_role;
grant usage, select on all sequences in schema accounts to service_role;

notify pgrst, 'reload schema';
