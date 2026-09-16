import { NextResponse } from 'next/server';

// ── Accounts Admin (Tally replacement — chart of accounts + double-entry) ──
// Own Postgres schema (`accounts`), own route file — same shape as
// app/api/payroll-admin/route.js and app/api/inventory-admin/route.js. See
// migration_accounts_schema.sql and TALLY_MIGRATION_PLAN.md for the schema
// and the full context behind this module (replacing TallyPrime Gold).
//
// Auth model: identical to inventory-admin's — one gate at the top covers
// every action below (no self-service exception exists here, unlike
// payroll-admin's get_my_payslips).

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbAccounts(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'accounts',
      'Content-Profile': 'accounts',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Fresh per-request check against teacher_staff.app_users — never trust a cached role.
async function _getUserRoles(userId) {
  if (!userId) return [];
  const res = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher_staff' },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  const role = Array.isArray(rows) && rows[0] ? rows[0].role : '';
  return String(role || '').split(',').map(r => r.trim()).filter(Boolean);
}

async function _isAccountsAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Accounts Admin');
}

const NATURES = ['asset', 'liability', 'income', 'expense', 'equity'];

// A voucher's own entries must balance — same rule Tally itself enforces
// at entry time, checked here so a hand-crafted request can't bypass it
// either. Rounds to paisa/cent (2dp) before comparing so float drift from
// the client never trips a false imbalance.
function _entriesBalance(entries) {
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const debit = entries.reduce((a, e) => a + round2(e.debit), 0);
  const credit = entries.reduce((a, e) => a + round2(e.credit), 0);
  return Math.abs(round2(debit) - round2(credit)) < 0.01;
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, user_id } = body || {};
  const payload = body.payload || {};

  if (!(await _isAccountsAdmin(user_id))) {
    return NextResponse.json({ result: 'error', message: 'Admin or Accounts Admin access only' }, { status: 403 });
  }

  // ── Chart of Accounts: Groups ──
  if (action === 'get_account_groups') {
    const rows = await sbAccounts('account_groups?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', groups: rows });
  }

  if (action === 'save_account_group') {
    const { id, name, parent_group_id, nature } = payload;
    if (!name || !nature) return NextResponse.json({ result: 'error', message: 'Name and nature are required' }, { status: 400 });
    if (!NATURES.includes(nature)) return NextResponse.json({ result: 'error', message: 'Invalid nature' }, { status: 400 });
    if (parent_group_id && id && Number(parent_group_id) === Number(id)) {
      return NextResponse.json({ result: 'error', message: 'A group cannot be its own parent' }, { status: 400 });
    }
    const rowData = { name, parent_group_id: parent_group_id || null, nature };
    const saved = id
      ? await sbAccounts(`account_groups?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbAccounts('account_groups', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    return NextResponse.json({ result: 'success', group: Array.isArray(saved) ? saved[0] : saved });
  }

  if (action === 'delete_account_group') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'Missing id' }, { status: 400 });
    const [children, ledgers] = await Promise.all([
      sbAccounts(`account_groups?parent_group_id=eq.${encodeURIComponent(id)}&select=id&limit=1`),
      sbAccounts(`ledgers?group_id=eq.${encodeURIComponent(id)}&select=id&limit=1`),
    ]);
    if (Array.isArray(children) && children.length) return NextResponse.json({ result: 'error', message: 'Move or delete its sub-groups first' }, { status: 400 });
    if (Array.isArray(ledgers) && ledgers.length) return NextResponse.json({ result: 'error', message: 'Move or delete its ledgers first' }, { status: 400 });
    const res = await sbAccounts(`account_groups?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (res?.error) return NextResponse.json({ result: 'error', message: res.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  // ── Ledgers ──
  if (action === 'get_ledgers') {
    const [ledgers, entries] = await Promise.all([
      sbAccounts('ledgers?select=*,account_groups(id,name,nature)&order=name.asc'),
      sbAccounts('voucher_entries?select=ledger_id,debit,credit'),
    ]);
    if (ledgers?.error) return NextResponse.json({ result: 'error', message: ledgers.error }, { status: 500 });
    const movement = {};
    (Array.isArray(entries) ? entries : []).forEach(e => {
      const m = movement[e.ledger_id] || (movement[e.ledger_id] = { debit: 0, credit: 0 });
      m.debit += Number(e.debit) || 0;
      m.credit += Number(e.credit) || 0;
    });
    const withBalance = (Array.isArray(ledgers) ? ledgers : []).map(l => {
      const m = movement[l.id] || { debit: 0, credit: 0 };
      const balance = Math.round(((Number(l.opening_balance) || 0) + m.debit - m.credit) * 100) / 100;
      return { ...l, debit_movement: Math.round(m.debit * 100) / 100, credit_movement: Math.round(m.credit * 100) / 100, balance };
    });
    return NextResponse.json({ result: 'success', ledgers: withBalance });
  }

  if (action === 'save_ledger') {
    const { id, name, group_id, opening_balance, opening_balance_date, is_active } = payload;
    if (!name || !group_id) return NextResponse.json({ result: 'error', message: 'Name and Group are required' }, { status: 400 });
    const rowData = {
      name, group_id,
      opening_balance: opening_balance === '' || opening_balance == null ? 0 : Number(opening_balance),
      opening_balance_date: opening_balance_date || null,
      is_active: is_active !== false,
    };
    const saved = id
      ? await sbAccounts(`ledgers?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbAccounts('ledgers', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    return NextResponse.json({ result: 'success', ledger: Array.isArray(saved) ? saved[0] : saved });
  }

  if (action === 'delete_ledger') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'Missing id' }, { status: 400 });
    const used = await sbAccounts(`voucher_entries?ledger_id=eq.${encodeURIComponent(id)}&select=id&limit=1`);
    if (Array.isArray(used) && used.length) return NextResponse.json({ result: 'error', message: 'This ledger has voucher entries — cannot delete (mark inactive instead)' }, { status: 400 });
    const res = await sbAccounts(`ledgers?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (res?.error) return NextResponse.json({ result: 'error', message: res.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  // ── Vouchers (Day Book) ──
  if (action === 'get_vouchers') {
    const { from_date, to_date, voucher_type } = payload;
    let q = 'vouchers?select=*,voucher_entries(id,ledger_id,debit,credit,narration,ledgers(name))&order=voucher_date.desc,id.desc';
    if (from_date) q += `&voucher_date=gte.${encodeURIComponent(from_date)}`;
    if (to_date) q += `&voucher_date=lte.${encodeURIComponent(to_date)}`;
    if (voucher_type) q += `&voucher_type=eq.${encodeURIComponent(voucher_type)}`;
    const rows = await sbAccounts(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', vouchers: rows });
  }

  if (action === 'save_voucher') {
    const { id, voucher_type, voucher_number, voucher_date, narration, entries } = payload;
    if (!voucher_type || !voucher_date) return NextResponse.json({ result: 'error', message: 'Voucher type and date are required' }, { status: 400 });
    if (!Array.isArray(entries) || entries.length < 2) return NextResponse.json({ result: 'error', message: 'At least two ledger entries are required' }, { status: 400 });
    if (entries.some(e => !e.ledger_id || ((Number(e.debit) || 0) === 0 && (Number(e.credit) || 0) === 0))) {
      return NextResponse.json({ result: 'error', message: 'Every entry needs a ledger and a non-zero debit or credit' }, { status: 400 });
    }
    if (entries.some(e => (Number(e.debit) || 0) > 0 && (Number(e.credit) || 0) > 0)) {
      return NextResponse.json({ result: 'error', message: 'An entry cannot have both a debit and a credit' }, { status: 400 });
    }
    if (!_entriesBalance(entries)) {
      return NextResponse.json({ result: 'error', message: 'Debit and credit totals must be equal' }, { status: 400 });
    }

    const voucherRow = { voucher_type, voucher_number: voucher_number || null, voucher_date, narration: narration || null };
    let voucherId = id;
    if (id) {
      const saved = await sbAccounts(`vouchers?id=eq.${encodeURIComponent(id)}`, 'PATCH', voucherRow);
      if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
      const cleared = await sbAccounts(`voucher_entries?voucher_id=eq.${encodeURIComponent(id)}`, 'DELETE');
      if (cleared?.error) return NextResponse.json({ result: 'error', message: cleared.error }, { status: 500 });
    } else {
      const saved = await sbAccounts('vouchers', 'POST', { ...voucherRow, created_by: user_id || null });
      if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
      voucherId = Array.isArray(saved) && saved[0] && saved[0].id;
    }
    const entryRows = entries.map(e => ({
      voucher_id: voucherId, ledger_id: e.ledger_id,
      debit: Number(e.debit) || 0, credit: Number(e.credit) || 0,
      narration: e.narration || null,
    }));
    const savedEntries = await sbAccounts('voucher_entries', 'POST', entryRows);
    if (savedEntries?.error) return NextResponse.json({ result: 'error', message: savedEntries.error }, { status: 500 });
    return NextResponse.json({ result: 'success', voucher_id: voucherId });
  }

  if (action === 'delete_voucher') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'Missing id' }, { status: 400 });
    // voucher_entries.voucher_id is ON DELETE CASCADE — no separate cleanup needed.
    const res = await sbAccounts(`vouchers?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (res?.error) return NextResponse.json({ result: 'error', message: res.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  // ── Bills (Create > Bill) ──
  // A Bill is a specially-templated Payment voucher: one expense ledger,
  // one bank/cash ledger, one amount — always exactly the two
  // voucher_entries a balanced voucher needs. accounts.bills is a flat,
  // one-row-per-bill history table alongside that (bill number, date,
  // title, description, group, ledger, cheque no.) — see
  // migration_bill_creation.sql — so a Bill's own fields are queryable
  // directly without reconstructing them through voucher_entries. Trial
  // Balance/P&L/Balance Sheet/Day Book are untouched by any of this: they
  // still just read voucher_entries like they always have.
  async function _nextBillSerial(bank_ledger_id, bill_date) {
    const d = new Date(bill_date);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const existing = await sbAccounts(`bills?bank_ledger_id=eq.${encodeURIComponent(bank_ledger_id)}&bill_date=gte.${monthStart}&bill_date=lt.${nextMonth}&select=id`);
    const serial = (Array.isArray(existing) ? existing.length : 0) + 1;
    return { serial, mm: String(m).padStart(2, '0'), yyyy: String(y) };
  }

  if (action === 'preview_bill_number') {
    const { bank_ledger_id, bill_date } = payload;
    if (!bank_ledger_id || !bill_date) return NextResponse.json({ result: 'error', message: 'Account and date are required' }, { status: 400 });
    const ledgerRows = await sbAccounts(`ledgers?id=eq.${encodeURIComponent(bank_ledger_id)}&select=name`);
    const ledgerName = Array.isArray(ledgerRows) && ledgerRows[0] && ledgerRows[0].name;
    if (!ledgerName) return NextResponse.json({ result: 'error', message: 'Account not found' }, { status: 404 });
    const { serial, mm, yyyy } = await _nextBillSerial(bank_ledger_id, bill_date);
    return NextResponse.json({ result: 'success', bill_number: `${serial}/${mm}/${yyyy}-${ledgerName}` });
  }

  if (action === 'save_bill') {
    const { bill_date, title, description, amount, ledger_id, bank_ledger_id, cheque_no } = payload;
    if (!bill_date || !ledger_id || !bank_ledger_id || !(Number(amount) > 0)) {
      return NextResponse.json({ result: 'error', message: 'Date, ledger, account and a positive amount are required' }, { status: 400 });
    }
    if (String(ledger_id) === String(bank_ledger_id)) {
      return NextResponse.json({ result: 'error', message: 'Expense ledger and paying account must be different' }, { status: 400 });
    }
    if (cheque_no) {
      const clash = await sbAccounts(`bills?bank_ledger_id=eq.${encodeURIComponent(bank_ledger_id)}&cheque_no=eq.${encodeURIComponent(cheque_no)}&select=id&limit=1`);
      if (Array.isArray(clash) && clash.length) return NextResponse.json({ result: 'error', message: 'That cheque number has already been used' }, { status: 400 });
    }
    const [ledgerRows, bankLedgerRows] = await Promise.all([
      sbAccounts(`ledgers?id=eq.${encodeURIComponent(ledger_id)}&select=name,group_id`),
      sbAccounts(`ledgers?id=eq.${encodeURIComponent(bank_ledger_id)}&select=name`),
    ]);
    const ledger = Array.isArray(ledgerRows) && ledgerRows[0];
    const bankLedger = Array.isArray(bankLedgerRows) && bankLedgerRows[0];
    if (!ledger || !bankLedger) return NextResponse.json({ result: 'error', message: 'Ledger not found' }, { status: 404 });

    // Authoritative — recomputed here rather than trusting whatever
    // number the client last previewed, in case something else was
    // saved against this account in the meantime.
    const { serial, mm, yyyy } = await _nextBillSerial(bank_ledger_id, bill_date);
    const billNumber = `${serial}/${mm}/${yyyy}-${bankLedger.name}`;

    const savedVoucher = await sbAccounts('vouchers', 'POST', {
      voucher_type: 'Payment', voucher_number: billNumber, voucher_date: bill_date,
      narration: description || null, created_by: user_id || null,
    });
    if (savedVoucher?.error) return NextResponse.json({ result: 'error', message: savedVoucher.error }, { status: 500 });
    const voucherId = Array.isArray(savedVoucher) && savedVoucher[0] && savedVoucher[0].id;

    const savedEntries = await sbAccounts('voucher_entries', 'POST', [
      { voucher_id: voucherId, ledger_id, debit: Number(amount), credit: 0, narration: description || null },
      { voucher_id: voucherId, ledger_id: bank_ledger_id, debit: 0, credit: Number(amount), narration: description || null },
    ]);
    if (savedEntries?.error) return NextResponse.json({ result: 'error', message: savedEntries.error }, { status: 500 });

    const savedBill = await sbAccounts('bills', 'POST', {
      voucher_id: voucherId, bill_number: billNumber, bill_date, title: title || null, description: description || null,
      group_id: ledger.group_id, ledger_id, bank_ledger_id, cheque_no: cheque_no || null, amount: Number(amount),
      created_by: user_id || null,
    });
    if (savedBill?.error) return NextResponse.json({ result: 'error', message: savedBill.error }, { status: 500 });

    return NextResponse.json({ result: 'success', voucher_id: voucherId, bill_number: billNumber });
  }

  // ── Chequebook ranges (per bank/cash ledger) ──
  if (action === 'get_chequebook_ranges') {
    const { ledger_id } = payload;
    if (!ledger_id) return NextResponse.json({ result: 'error', message: 'Missing ledger_id' }, { status: 400 });
    const [ranges, used, voids] = await Promise.all([
      sbAccounts(`chequebook_ranges?ledger_id=eq.${encodeURIComponent(ledger_id)}&select=*&order=range_start.asc`),
      sbAccounts(`bills?bank_ledger_id=eq.${encodeURIComponent(ledger_id)}&cheque_no=not.is.null&select=cheque_no`),
      sbAccounts(`chequebook_voids?ledger_id=eq.${encodeURIComponent(ledger_id)}&select=*&order=cheque_no.asc`),
    ]);
    if (ranges?.error) return NextResponse.json({ result: 'error', message: ranges.error }, { status: 500 });
    if (voids?.error) return NextResponse.json({ result: 'error', message: voids.error }, { status: 500 });
    const usedSet = new Set((Array.isArray(used) ? used : []).map(b => String(b.cheque_no)));
    const wastedList = Array.isArray(voids) ? voids : [];
    const wastedSet = new Set(wastedList.map(w => String(w.cheque_no)));
    const available = [];
    (Array.isArray(ranges) ? ranges : []).forEach(r => {
      for (let n = r.range_start; n <= r.range_end; n++) { if (!usedSet.has(String(n)) && !wastedSet.has(String(n))) available.push(n); }
    });
    return NextResponse.json({ result: 'success', ranges, used: Array.from(usedSet), wasted: wastedList, available });
  }

  if (action === 'save_chequebook_range') {
    const { ledger_id, range_start, range_end } = payload;
    const start = Number(range_start), end = Number(range_end);
    if (!ledger_id || !Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      return NextResponse.json({ result: 'error', message: 'A valid ledger and range are required' }, { status: 400 });
    }
    if (end - start > 1000) return NextResponse.json({ result: 'error', message: 'Range too large (max 1000 cheque leaves at a time)' }, { status: 400 });
    const existing = await sbAccounts(`chequebook_ranges?ledger_id=eq.${encodeURIComponent(ledger_id)}&select=range_start,range_end`);
    if (Array.isArray(existing) && existing.some(r => start <= r.range_end && end >= r.range_start)) {
      return NextResponse.json({ result: 'error', message: 'This range overlaps an existing one for this account' }, { status: 400 });
    }
    const saved = await sbAccounts('chequebook_ranges', 'POST', { ledger_id, range_start: start, range_end: end });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    return NextResponse.json({ result: 'success', range: Array.isArray(saved) ? saved[0] : saved });
  }

  if (action === 'delete_chequebook_range') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'Missing id' }, { status: 400 });
    const res = await sbAccounts(`chequebook_ranges?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (res?.error) return NextResponse.json({ result: 'error', message: res.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  // A page marked wasted was never actually paid out — no voucher, no
  // amount — so it lives in its own table rather than accounts.bills.
  // Only a page that's (a) inside a registered range, (b) not already
  // used on a real bill, and (c) not already marked wasted can be marked.
  if (action === 'mark_cheque_wasted') {
    const { ledger_id, cheque_no, reason } = payload;
    if (!ledger_id || !cheque_no) return NextResponse.json({ result: 'error', message: 'Account and page number are required' }, { status: 400 });
    const n = String(Number(cheque_no));
    const [ranges, usedRows, voidRows] = await Promise.all([
      sbAccounts(`chequebook_ranges?ledger_id=eq.${encodeURIComponent(ledger_id)}&select=range_start,range_end`),
      sbAccounts(`bills?bank_ledger_id=eq.${encodeURIComponent(ledger_id)}&cheque_no=eq.${encodeURIComponent(n)}&select=bill_number&limit=1`),
      sbAccounts(`chequebook_voids?ledger_id=eq.${encodeURIComponent(ledger_id)}&cheque_no=eq.${encodeURIComponent(n)}&select=id&limit=1`),
    ]);
    const inRange = Array.isArray(ranges) && ranges.some(r => Number(n) >= r.range_start && Number(n) <= r.range_end);
    if (!inRange) return NextResponse.json({ result: 'error', message: 'That page number is not in any registered range for this account' }, { status: 400 });
    if (Array.isArray(usedRows) && usedRows.length) return NextResponse.json({ result: 'error', message: `Already used on bill ${usedRows[0].bill_number}` }, { status: 400 });
    if (Array.isArray(voidRows) && voidRows.length) return NextResponse.json({ result: 'error', message: 'Already marked wasted' }, { status: 400 });
    const saved = await sbAccounts('chequebook_voids', 'POST', { ledger_id, cheque_no: n, reason: reason || null, created_by: user_id || null });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'unmark_cheque_wasted') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'Missing id' }, { status: 400 });
    const res = await sbAccounts(`chequebook_voids?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (res?.error) return NextResponse.json({ result: 'error', message: res.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  // "See the bills under an account" — the whole reason accounts.bills is
  // its own flat table: no need to reconstruct this by joining back
  // through voucher_entries. Ledger/Group names are resolved client-side
  // from the already-loaded _acLedgersCache/_acGroupsCache instead of
  // embedding them here, which would need a !constraint-name hint anyway
  // since bills has two separate FKs into ledgers (ledger_id and
  // bank_ledger_id).
  if (action === 'get_bills') {
    const { bank_ledger_id } = payload;
    let q = 'bills?select=*&order=bill_date.desc,id.desc';
    if (bank_ledger_id) q += `&bank_ledger_id=eq.${encodeURIComponent(bank_ledger_id)}`;
    const rows = await sbAccounts(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', bills: rows });
  }

  // ── Reports ──
  // Trial Balance: every ledger's net closing balance as of a date (or
  // all time if omitted), split into a Debit or Credit column the way
  // Tally's own Trial Balance report shows it — a debit-positive
  // ledger's balance lands in Debit, a net-negative one in Credit. The
  // two column totals should always match; the frontend surfaces that
  // as a live correctness check.
  if (action === 'get_trial_balance') {
    const { as_of_date } = payload;
    let entriesQ = 'voucher_entries?select=ledger_id,debit,credit,vouchers!inner(voucher_date)';
    if (as_of_date) entriesQ += `&vouchers.voucher_date=lte.${encodeURIComponent(as_of_date)}`;
    const [ledgers, entries] = await Promise.all([
      sbAccounts('ledgers?select=id,name,opening_balance,account_groups(name,nature)&order=name.asc'),
      sbAccounts(entriesQ),
    ]);
    if (ledgers?.error) return NextResponse.json({ result: 'error', message: ledgers.error }, { status: 500 });
    if (entries?.error) return NextResponse.json({ result: 'error', message: entries.error }, { status: 500 });
    const movement = {};
    (Array.isArray(entries) ? entries : []).forEach(e => {
      const m = movement[e.ledger_id] || (movement[e.ledger_id] = { debit: 0, credit: 0 });
      m.debit += Number(e.debit) || 0;
      m.credit += Number(e.credit) || 0;
    });
    let totalDebit = 0, totalCredit = 0;
    const rows = (Array.isArray(ledgers) ? ledgers : []).map(l => {
      const m = movement[l.id] || { debit: 0, credit: 0 };
      const balance = Math.round(((Number(l.opening_balance) || 0) + m.debit - m.credit) * 100) / 100;
      const debit = balance > 0 ? balance : 0;
      const credit = balance < 0 ? -balance : 0;
      totalDebit += debit; totalCredit += credit;
      return { ledger_id: l.id, name: l.name, group_name: l.account_groups?.name, nature: l.account_groups?.nature, debit, credit };
    }).filter(r => r.debit !== 0 || r.credit !== 0);
    return NextResponse.json({
      result: 'success', rows,
      total_debit: Math.round(totalDebit * 100) / 100,
      total_credit: Math.round(totalCredit * 100) / 100,
    });
  }

  // ── Bulk import — same target-keyed shape as payroll-admin's import_rows
  // (per-row error reporting, `imported` count, never one bad row failing
  // the whole batch). Rows arrive already normalized to plain field names
  // regardless of source — the frontend's Excel column-mapper and its
  // Tally-XML parser both produce the same shape before calling this. ──
  if (action === 'import_rows') {
    const { target, rows } = payload;
    if (!target || !Array.isArray(rows) || !rows.length) return NextResponse.json({ result: 'error', message: 'target and rows are required' }, { status: 400 });
    const errors = [];
    let imported = 0;

    if (target === 'ledgers') {
      const groupsRes = await sbAccounts('account_groups?select=id,name');
      const groupByName = {}; (groupsRes || []).forEach(g => { groupByName[String(g.name).toLowerCase()] = g.id; });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.name) { errors.push({ row: i + 2, message: 'name is required' }); continue; }
        if (!r.group_name) { errors.push({ row: i + 2, message: 'group_name is required' }); continue; }
        const group_id = groupByName[String(r.group_name).toLowerCase()];
        if (!group_id) { errors.push({ row: i + 2, message: `Group "${r.group_name}" not found` }); continue; }
        // Re-importing the same sheet updates the existing ledger by name
        // rather than creating a duplicate — matches how re-uploading a
        // People sheet in Payroll behaves.
        const existing = await sbAccounts(`ledgers?name=eq.${encodeURIComponent(r.name)}&select=id`);
        const rowData = {
          name: r.name, group_id,
          opening_balance: r.opening_balance === '' || r.opening_balance == null ? 0 : Number(r.opening_balance),
          opening_balance_date: r.opening_balance_date || null,
        };
        const saved = (!existing?.error && existing.length)
          ? await sbAccounts(`ledgers?id=eq.${encodeURIComponent(existing[0].id)}`, 'PATCH', rowData)
          : await sbAccounts('ledgers', 'POST', rowData);
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else if (target === 'vouchers') {
      // Excel/XML is flat, a voucher isn't — rows sharing the same
      // voucher_ref become one voucher's entries. A row with no ref at
      // all is treated as its own single-row group (reported as an
      // error below, since a real voucher needs 2+ entries) rather than
      // silently merging unrelated rows together.
      const ledgersRes = await sbAccounts('ledgers?select=id,name');
      const ledgerByName = {}; (ledgersRes || []).forEach(l => { ledgerByName[String(l.name).toLowerCase()] = l.id; });
      const groups = {};
      rows.forEach((r, i) => {
        const ref = String(r.voucher_ref || '').trim() || `__row_${i}`;
        (groups[ref] = groups[ref] || []).push({ r, i });
      });
      for (const ref of Object.keys(groups)) {
        const lines = groups[ref];
        const first = lines[0].r;
        const firstRow = lines[0].i + 2;
        if (!first.voucher_type || !first.voucher_date) { errors.push({ row: firstRow, message: 'voucher_type and voucher_date are required' }); continue; }
        const entries = [];
        let failed = false;
        for (const { r, i } of lines) {
          const ledger_id = r.ledger_name ? ledgerByName[String(r.ledger_name).toLowerCase()] : null;
          if (!ledger_id) { errors.push({ row: i + 2, message: `Ledger "${r.ledger_name || ''}" not found` }); failed = true; break; }
          const debit = Number(r.debit) || 0, credit = Number(r.credit) || 0;
          if (!debit && !credit) { errors.push({ row: i + 2, message: 'Needs a non-zero debit or credit' }); failed = true; break; }
          entries.push({ ledger_id, debit, credit, narration: r.narration || null });
        }
        if (failed) continue;
        if (entries.length < 2) { errors.push({ row: firstRow, message: 'A voucher needs at least 2 entries — give shared rows the same voucher_ref' }); continue; }
        if (!_entriesBalance(entries)) { errors.push({ row: firstRow, message: 'Debit and credit totals must be equal' }); continue; }
        const savedVoucher = await sbAccounts('vouchers', 'POST', {
          voucher_type: first.voucher_type, voucher_number: first.voucher_number || null,
          voucher_date: first.voucher_date, narration: first.narration || null, created_by: user_id || null,
        });
        if (savedVoucher?.error) { errors.push({ row: firstRow, message: savedVoucher.error }); continue; }
        const voucherId = Array.isArray(savedVoucher) && savedVoucher[0] && savedVoucher[0].id;
        const savedEntries = await sbAccounts('voucher_entries', 'POST', entries.map(e => ({ voucher_id: voucherId, ...e })));
        if (savedEntries?.error) { errors.push({ row: firstRow, message: savedEntries.error }); continue; }
        imported++;
      }
    } else {
      return NextResponse.json({ result: 'error', message: `Unknown import target "${target}"` }, { status: 400 });
    }

    return NextResponse.json({ result: 'success', imported, errors });
  }

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}
