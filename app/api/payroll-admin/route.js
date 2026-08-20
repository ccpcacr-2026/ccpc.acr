import { NextResponse } from 'next/server';

// ── Payroll Admin (dynamic payroll engine) ──────────────────────────────────
// Own Postgres schema (`payroll`), own route file — same shape as
// app/api/inventory-admin/route.js. See the "Dynamic Payroll Management
// System" plan for the full schema/engine design.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbPayroll(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'payroll',
      'Content-Profile': 'payroll',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Fresh per-request check against teacher.app_users — never trust a cached role.
async function _getUserRoles(userId) {
  if (!userId) return [];
  const res = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  const role = Array.isArray(rows) && rows[0] ? rows[0].role : '';
  return String(role || '').split(',').map(r => r.trim()).filter(Boolean);
}

async function _isPayrollAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Accounts Admin');
}

// Reads from the `teacher` schema (staff directory) — same raw-fetch pattern.
async function _teacherSchemaFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' },
  });
  if (!res.ok) return [];
  return res.json();
}

// Fire-and-forget audit trail — never blocks or fails the caller's request
// on a logging error. Called after every mutating action below.
function _prAudit(actorUserId, action, entity, entityId, details) {
  sbPayroll('audit_log', 'POST', {
    actor_user_id: actorUserId || null,
    action,
    entity: entity || null,
    entity_id: entityId != null ? String(entityId) : null,
    details: details || null,
  }).catch(() => {});
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { action, user_id } = body || {};
  const payload = body.payload || {};

  // Self-service: any authenticated staff member can read their OWN finalized
  // payslips, no Payroll Admin role required — checked before the admin gate
  // below, same pattern as get_my_payslips in app/api/student-admin/route.js.
  if (action === 'get_my_payslips') {
    if (!user_id) return NextResponse.json({ result: 'error', message: 'Not signed in' }, { status: 401 });
    const rows = await sbPayroll(`payslips?user_id=eq.${encodeURIComponent(user_id)}&select=*,runs(month,year,status)&order=id.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    const finalized = (Array.isArray(rows) ? rows : []).filter(p => p.runs && p.runs.status === 'finalized');
    return NextResponse.json({ result: 'success', payslips: finalized });
  }

  if (!(await _isPayrollAdmin(user_id))) {
    return NextResponse.json({ result: 'error', message: 'Admin or Payroll Admin access only' }, { status: 403 });
  }

  // ── Fields catalog ──
  if (action === 'get_fields') {
    const rows = await sbPayroll('fields?select=*&order=sort_order.asc,id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', fields: rows });
  }

  if (action === 'save_field') {
    const { id, key, label, category, calc_mode, calc_base_field_key, increment_mode, increment_value, is_grade_conditional, is_active, sort_order } = payload;
    if (!key || !label) return NextResponse.json({ result: 'error', message: 'Key and label are required' }, { status: 400 });
    const rowData = {
      key, label,
      category: category || 'earning',
      calc_mode: calc_mode || 'fixed',
      calc_base_field_key: calc_base_field_key || null,
      increment_mode: increment_mode || null,
      increment_value: increment_value === '' || increment_value == null ? null : Number(increment_value),
      is_grade_conditional: !!is_grade_conditional,
      is_active: is_active !== false,
      sort_order: sort_order == null ? 0 : Number(sort_order),
    };
    const saved = id
      ? await sbPayroll(`fields?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('fields', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_field', 'fields', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', field: savedRow });
  }

  if (action === 'delete_field') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`fields?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_field', 'fields', id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Per-role defaults for a field ──
  if (action === 'get_field_role_defaults') {
    const { field_id } = payload;
    if (!field_id) return NextResponse.json({ result: 'error', message: 'field_id required' }, { status: 400 });
    const rows = await sbPayroll(`field_role_defaults?field_id=eq.${encodeURIComponent(field_id)}&select=*`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', defaults: rows });
  }

  if (action === 'save_field_role_default') {
    const { field_id, role, value, percent, base_field_key } = payload;
    if (!field_id || !role) return NextResponse.json({ result: 'error', message: 'field_id and role required' }, { status: 400 });
    const rowData = {
      field_id, role,
      value: value === '' || value == null ? null : Number(value),
      percent: percent === '' || percent == null ? null : Number(percent),
      base_field_key: base_field_key || null,
    };
    const existing = await sbPayroll(`field_role_defaults?field_id=eq.${encodeURIComponent(field_id)}&role=eq.${encodeURIComponent(role)}`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`field_role_defaults?field_id=eq.${encodeURIComponent(field_id)}&role=eq.${encodeURIComponent(role)}`, 'PATCH', rowData)
      : await sbPayroll('field_role_defaults', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_field_role_default', 'field_role_defaults', field_id, rowData);
    return NextResponse.json({ result: 'success' });
  }

  // ── Grades ──
  if (action === 'get_grades') {
    const rows = await sbPayroll('grades?select=*&order=sort_order.asc,id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', grades: rows });
  }

  if (action === 'save_grade') {
    const { id, name, description, sort_order } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name is required' }, { status: 400 });
    const rowData = { name, description: description || null, sort_order: sort_order == null ? 0 : Number(sort_order) };
    const saved = id
      ? await sbPayroll(`grades?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('grades', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedGrade = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_grade', 'grades', savedGrade?.id, rowData);
    return NextResponse.json({ result: 'success', grade: savedGrade });
  }

  if (action === 'delete_grade') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`grades?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_grade', 'grades', id);
    return NextResponse.json({ result: 'success' });
  }

  // What a grade sets for each field, plus which fields it turns on conditionally.
  if (action === 'get_grade_setup') {
    const { grade_id } = payload;
    if (!grade_id) return NextResponse.json({ result: 'error', message: 'grade_id required' }, { status: 400 });
    const [fieldRows, conditionalRows] = await Promise.all([
      sbPayroll(`grade_fields?grade_id=eq.${encodeURIComponent(grade_id)}&select=*`),
      sbPayroll(`grade_conditional_fields?grade_id=eq.${encodeURIComponent(grade_id)}&select=*`),
    ]);
    if (fieldRows?.error) return NextResponse.json({ result: 'error', message: fieldRows.error }, { status: 500 });
    if (conditionalRows?.error) return NextResponse.json({ result: 'error', message: conditionalRows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', grade_fields: fieldRows, conditional_fields: conditionalRows });
  }

  if (action === 'save_grade_field') {
    const { grade_id, field_id, value, percent, base_field_key } = payload;
    if (!grade_id || !field_id) return NextResponse.json({ result: 'error', message: 'grade_id and field_id required' }, { status: 400 });
    const rowData = {
      grade_id, field_id,
      value: value === '' || value == null ? null : Number(value),
      percent: percent === '' || percent == null ? null : Number(percent),
      base_field_key: base_field_key || null,
    };
    const existing = await sbPayroll(`grade_fields?grade_id=eq.${encodeURIComponent(grade_id)}&field_id=eq.${encodeURIComponent(field_id)}`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`grade_fields?grade_id=eq.${encodeURIComponent(grade_id)}&field_id=eq.${encodeURIComponent(field_id)}`, 'PATCH', rowData)
      : await sbPayroll('grade_fields', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_grade_field', 'grade_fields', `${grade_id}:${field_id}`, rowData);
    return NextResponse.json({ result: 'success' });
  }

  // Toggle whether a grade turns a conditional field on (checked) or off (unchecked).
  if (action === 'toggle_grade_conditional_field') {
    const { grade_id, field_id, enabled } = payload;
    if (!grade_id || !field_id) return NextResponse.json({ result: 'error', message: 'grade_id and field_id required' }, { status: 400 });
    if (enabled) {
      const saved = await sbPayroll('grade_conditional_fields', 'POST', { grade_id, field_id });
      if (saved?.error && !String(saved.error).includes('duplicate')) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    } else {
      const del = await sbPayroll(`grade_conditional_fields?grade_id=eq.${encodeURIComponent(grade_id)}&field_id=eq.${encodeURIComponent(field_id)}`, 'DELETE');
      if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    }
    _prAudit(user_id, 'toggle_grade_conditional_field', 'grade_conditional_fields', `${grade_id}:${field_id}`, { enabled });
    return NextResponse.json({ result: 'success' });
  }

  // ── People (grade assignment + per-person field overrides) ──
  if (action === 'get_people_setup') {
    const rows = await sbPayroll('person_setup?select=*&order=created_at.desc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', people: rows });
  }

  if (action === 'save_person_setup') {
    const { user_id: personId, grade_id, joining_date, is_active, bank_name, bank_account_no, mobile_banking_provider, mobile_banking_number } = payload;
    if (!personId) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const rowData = {
      user_id: personId,
      grade_id: grade_id || null,
      joining_date: joining_date || null,
      is_active: is_active !== false,
      bank_name: bank_name || null,
      bank_account_no: bank_account_no || null,
      mobile_banking_provider: mobile_banking_provider || null,
      mobile_banking_number: mobile_banking_number || null,
    };
    const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', rowData)
      : await sbPayroll('person_setup', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_person_setup', 'person_setup', personId, rowData);
    return NextResponse.json({ result: 'success', person: Array.isArray(saved) ? saved[0] : saved });
  }

  if (action === 'get_person_field_overrides') {
    const { user_id } = payload;
    if (!user_id) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const rows = await sbPayroll(`person_field_overrides?user_id=eq.${encodeURIComponent(user_id)}&select=*`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', overrides: rows });
  }

  if (action === 'save_person_field_override') {
    const { user_id: personId, field_id, value, percent, base_field_key } = payload;
    if (!personId || !field_id) return NextResponse.json({ result: 'error', message: 'user_id and field_id required' }, { status: 400 });
    // Blank value AND blank percent means "clear the override" — delete rather
    // than leave a dangling all-null row that would otherwise still win over
    // the grade/role default at resolution time.
    if ((value === '' || value == null) && (percent === '' || percent == null)) {
      const del = await sbPayroll(`person_field_overrides?user_id=eq.${encodeURIComponent(personId)}&field_id=eq.${encodeURIComponent(field_id)}`, 'DELETE');
      if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
      _prAudit(user_id, 'clear_person_field_override', 'person_field_overrides', `${personId}:${field_id}`);
      return NextResponse.json({ result: 'success', cleared: true });
    }
    const rowData = {
      user_id: personId, field_id,
      value: value === '' || value == null ? null : Number(value),
      percent: percent === '' || percent == null ? null : Number(percent),
      base_field_key: base_field_key || null,
    };
    const existing = await sbPayroll(`person_field_overrides?user_id=eq.${encodeURIComponent(personId)}&field_id=eq.${encodeURIComponent(field_id)}`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`person_field_overrides?user_id=eq.${encodeURIComponent(personId)}&field_id=eq.${encodeURIComponent(field_id)}`, 'PATCH', rowData)
      : await sbPayroll('person_field_overrides', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_person_field_override', 'person_field_overrides', `${personId}:${field_id}`, rowData);
    return NextResponse.json({ result: 'success' });
  }

  // ── Statutory items (PF, tax/AIT, etc.) ──
  if (action === 'get_statutory_items') {
    const rows = await sbPayroll('statutory_items?select=*&order=id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', items: rows });
  }

  if (action === 'save_statutory_item') {
    const { id, key, label, employee_calc_mode, employee_value, employee_percent, employee_base_field_key, employer_matches, employer_percent, is_active } = payload;
    if (!key || !label) return NextResponse.json({ result: 'error', message: 'Key and label are required' }, { status: 400 });
    const rowData = {
      key, label,
      employee_calc_mode: employee_calc_mode || 'percent_of_field',
      employee_value: employee_value === '' || employee_value == null ? null : Number(employee_value),
      employee_percent: employee_percent === '' || employee_percent == null ? null : Number(employee_percent),
      employee_base_field_key: employee_base_field_key || null,
      employer_matches: !!employer_matches,
      employer_percent: employer_percent === '' || employer_percent == null ? null : Number(employer_percent),
      is_active: is_active !== false,
    };
    const saved = id
      ? await sbPayroll(`statutory_items?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('statutory_items', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_statutory_item', 'statutory_items', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', item: savedRow });
  }

  if (action === 'delete_statutory_item') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`statutory_items?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_statutory_item', 'statutory_items', id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Bonus / festival payments (one-off credit for a specific month) ──
  if (action === 'get_bonus_payments') {
    const { month, year } = payload;
    let q = 'bonus_payments?select=*&order=created_at.desc';
    if (month) q += `&month=eq.${encodeURIComponent(month)}`;
    if (year) q += `&year=eq.${encodeURIComponent(year)}`;
    const rows = await sbPayroll(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', payments: rows });
  }

  if (action === 'save_bonus_payment') {
    const { id, user_id: personId, label, amount, month, year, status, note } = payload;
    if (!personId || !label || !amount || !month || !year) return NextResponse.json({ result: 'error', message: 'Person, label, amount, month and year are required' }, { status: 400 });
    const rowData = { user_id: personId, label, amount: Number(amount), month: Number(month), year: Number(year), status: status || 'pending', note: note || null };
    const saved = id
      ? await sbPayroll(`bonus_payments?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('bonus_payments', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_bonus_payment', 'bonus_payments', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', payment: savedRow });
  }

  if (action === 'delete_bonus_payment') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`bonus_payments?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_bonus_payment', 'bonus_payments', id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Run approval workflow (on top of runs.status: draft → pending_approval → finalized) ──
  if (action === 'submit_run_for_approval') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const saved = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`, 'PATCH', { status: 'pending_approval', submitted_by: user_id, submitted_at: new Date().toISOString() });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'submit_run_for_approval', 'runs', run_id);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'approve_run') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const saved = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`, 'PATCH', { status: 'finalized', approved_by: user_id, approved_at: new Date().toISOString() });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'approve_run', 'runs', run_id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Audit log viewer ──
  if (action === 'get_audit_log') {
    const { entity, limit } = payload;
    let q = `audit_log?select=*&order=created_at.desc&limit=${Number(limit) || 200}`;
    if (entity) q += `&entity=eq.${encodeURIComponent(entity)}`;
    const rows = await sbPayroll(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', log: rows });
  }

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}
