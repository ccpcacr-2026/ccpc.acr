-- Adds print-tracking + editable-detail-field storage to accounts.vouchers,
-- for the Bill Payment Order public print page (app/bill/[id]/route.js).
--
-- bill_details: the hand-filled-on-paper fields (item description
-- overrides, cheque no., cheque date, notesheet/demand reference) that the
-- printable page lets someone edit right before printing -- kept separate
-- from the real accounting fields (amounts, ledgers, fund/sub-head), which
-- always come straight from the voucher/ledger data and are never
-- editable here, so a reprint can never show a different figure than the
-- system's own record.
-- bill_print_log: one ISO timestamp appended per actual print action (the
-- page's own "Print" button, which saves bill_details and logs the print
-- in one request before calling window.print()). Print count is simply
-- this array's length -- no separate counter column to keep in sync.
--
-- Safe to run multiple times. Run in Supabase SQL editor.

alter table accounts.vouchers
  add column if not exists bill_details jsonb not null default '{}'::jsonb,
  add column if not exists bill_print_log jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
