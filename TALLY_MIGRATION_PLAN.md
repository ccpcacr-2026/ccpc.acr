# Tally → CCPC_ACR Accounting Migration

**Status: planning — no code written yet.** This file tracks the decision, scope, and steps so the work survives across sessions.

## Why

The office currently uses TallyPrime Gold (multi-user license) to track expenses, income, and general accounts. The goal is to **fully replace Tally** with a native accounting module inside this app (`ccpc-teachers`), the same way Payroll, Inventory, and Student Admin already live here.

## Scope decision (confirmed with user, 2026-09-15)

- **Full replacement**, not just a historical-data dump. Everyday accounting (recording transactions, running reports) should eventually happen entirely in this app, not Tally.
- This means building real double-entry accounting from scratch — nothing like it exists in this codebase yet. Confirmed by checking `app/api/*`: only `payroll-admin`, `inventory-admin`, `student-admin`, `exec`, `announcements-admin`, `config` exist. No `ledger`, `voucher`, `chart of accounts`, `trial balance`, `journal`, etc. anywhere.
- Payroll already computes salary figures but has no concept of posting them to a ledger (e.g. as a journal entry debiting a Salary Expense account) — that link will need to be designed too, once the core accounting module exists.

## What "full replacement" needs to cover

Standard double-entry bookkeeping, matching what Tally provides:

- **Chart of Accounts**: Groups (e.g. Assets, Liabilities, Income, Expenses, Capital — Tally calls these "Groups", nestable) and Ledgers (individual accounts under a Group, e.g. "Cash", "Bank — XYZ", "Salary Expense", "Stationery Expense").
- **Vouchers** (the transaction unit in Tally): Payment, Receipt, Journal, Contra, Sales, Purchase — each with one or more debit/credit ledger entries that must balance to zero.
- **Reports**: Day Book (all vouchers in a period), Ledger statement (all entries for one ledger + running balance), Trial Balance, Profit & Loss, Balance Sheet.
- Possibly later: GST/VAT if the office's Tally setup uses it (not yet confirmed — check the exported data for tax ledgers/vouchers before assuming this is needed).

## Getting data out of Tally

Tally runs locally in the office with no network path from this session — data must be exported to files and handed over.

**Agreed method: Tally's own XML export**, via Gateway of Tally → Import/Export → Export:
1. Export **All Masters** as XML first — this is the Chart of Accounts (Groups + Ledgers).
2. Export **All Vouchers** (or Day Book) as XML for the date range to migrate — split by financial year/quarter if Tally struggles with one large export.
3. Hand over the resulting `.xml` file(s).

Tally's export XML has a predictable structure (`<ENVELOPE><BODY><DATA><TALLYMESSAGE>` blocks containing `<GROUP>`, `<LEDGER>`, `<VOUCHER>` elements with nested `<ALLLEDGERENTRIES.LIST>` debit/credit lines) — this is the same shape third-party Tally-integration tools parse, so an importer can be written directly against it once real sample files are in hand.

**Status: waiting on the user to produce and share these export files.** Do not guess at Tally's exact XML field names without a real sample — the importer should be written against the actual exported file, not assumed structure.

## Planned architecture (sketch — to be firmed up before building)

Following this app's existing pattern (one Postgres schema + one API route file per module):

- New Postgres schema, e.g. `accounts`, with tables roughly: `account_groups`, `ledgers`, `vouchers`, `voucher_entries` (the debit/credit lines).
- New route `app/api/accounts-admin/route.js`, same shape as `payroll-admin`/`inventory-admin` (`sbAccounts()` helper, action-based POST handler, role gate via `app_users`).
- New UI module in `_src/app.js` (nav entry, its own set of `load*Tab()` functions), same shape as the Payroll admin tabs.
- A one-time **Tally XML importer** (likely a Node script, run against the exported files, similar to the existing `scripts/` one-off migration scripts in this repo) that parses Groups/Ledgers into `account_groups`/`ledgers`, and Vouchers into `vouchers`/`voucher_entries`.
- Later: a link from Payroll's run-finalization into this module, so a finalized payroll run posts its own journal entries automatically instead of staying a parallel, disconnected system.

## Progress

- **Done (2026-09-15): `migration_accounts_schema.sql`** — creates the `accounts` schema and its four core tables (`account_groups`, `ledgers`, `vouchers`, `voucher_entries`), seeded with Tally's standard top-level Groups. Built ahead of seeing the real Tally export (a reasonable first cut, since double-entry structure is standard), so it may need adjusting once real Masters/Vouchers XML is in hand — e.g. new Groups the office's Tally actually uses, or GST-related ledgers.
  - **User action required, not yet done**: run `migration_accounts_schema.sql` in the Supabase SQL editor (I can't execute DDL myself — no direct Postgres connection, only the REST API via the service key). Then add `accounts` to **Settings → API → Data API → Exposed schemas** in the Supabase dashboard, the same manual step `payroll`/`inventory`/`student` needed — PostgREST won't serve `Accept-Profile: accounts` until that's done.

- **Done (2026-09-15): `app/api/accounts-admin/route.js` + Accounts Admin UI in `_src/app.js`** — CRUD for Groups, Ledgers, and Vouchers, plus a Trial Balance report. Gated to Admin/Accounts Admin (same role already used for Payroll). New "Accounts Admin" sidebar item.
  - **Not yet built**: Day Book already exists as the Vouchers list itself (with date filters); Ledger statement (one ledger's own running balance over time), Profit & Loss, and Balance Sheet reports are still pending.
  - **Not yet built**: the Tally XML importer — needs a real exported file to write against (see below), not guessed structure.
- **Done (2026-09-15): UI rebuilt as a TallyPrime emulation**, per explicit user request. Dark screen-stack UI (Gateway menu, F4-F9 voucher shortcuts, Esc/Ctrl+A/Alt+C, Enter-driven fields) replaces the earlier tab shell; P&L and Balance Sheet added as new report screens (derived client-side from the existing Trial Balance data, no backend change). Mobile got its own separate touch UI per the standing mobile/desktop-split rule. Backend/schema untouched. Verified: build succeeds, and every onclick-referenced function name survives minification unmangled in the deployed bundle. **Not yet done: an actual hands-on click-and-keyboard test in a real browser** — that needs the user's own pass (see Next Steps).
- **Done (2026-09-15): schema migration run, `accounts` schema exposed, end-to-end verified.** User ran `migration_accounts_schema.sql` and added `accounts` to Supabase's Exposed schemas. Confirmed live against the deployed app: created a test Group + two Ledgers, posted a balanced Journal voucher, Trial Balance reflected correct closing balances, Day Book listed it, then all four test records were deleted to leave the real books untouched. The module is confirmed working end to end.

## Next steps

1. **User: click-test the new Tally-style UI** in a real browser (desktop and a phone) — try F4-F9, Esc, Ctrl+A, Alt+C, the Gateway menu's arrow keys/hotkeys, and confirm nothing feels broken. Report anything that doesn't behave as expected.
2. User exports Masters + Vouchers XML from Tally and shares the files.
3. Inspect the real XML structure, confirm what account groups/ledgers/voucher types are actually in use (including whether GST/tax ledgers are present) — adjust the schema/seed Groups if needed.
4. Build the importer, run it against a copy of the data, and manually reconcile a sample (e.g. one ledger's balance) against Tally's own report for the same ledger before trusting the import.
5. Only after the above is verified correct: start treating this app as the system of record and wind down day-to-day Tally use.
