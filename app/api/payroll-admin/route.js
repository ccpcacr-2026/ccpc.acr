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

// ── Calculation engine ───────────────────────────────────────────────────
// Single source of truth for both preview_payslip (no writes) and
// run_payroll (persists a draft). Resolves each field by precedence
// person override > grade > role default > field's own structural config,
// evaluates percent-of-field dependencies via memoized recursion (cycle-
// safe), applies yearly increments, then folds in statutory items, active
// loan/advance section entries, and pending bonus payments for the period.

function _yearsSince(joiningDate, refDate) {
  if (!joiningDate) return 0;
  const j = new Date(joiningDate);
  if (isNaN(j.getTime())) return 0;
  let years = refDate.getUTCFullYear() - j.getUTCFullYear();
  const anniversaryPassed = (refDate.getUTCMonth() > j.getUTCMonth()) ||
    (refDate.getUTCMonth() === j.getUTCMonth() && refDate.getUTCDate() >= j.getUTCDate());
  if (!anniversaryPassed) years -= 1;
  return Math.max(0, years);
}

function _resolveFieldConfig(field, ctx) {
  const po = ctx.personOverridesByField[field.id];
  const gf = ctx.gradeFieldsByField[field.id];
  const rd = ctx.roleDefaultsByField[field.id];
  const value = po?.value ?? gf?.value ?? rd?.value ?? null;
  const percent = po?.percent ?? gf?.percent ?? rd?.percent ?? null;
  const base_field_key = po?.base_field_key || gf?.base_field_key || rd?.base_field_key || field.calc_base_field_key || null;
  return { value, percent, base_field_key };
}

function _resolveFieldValue(fieldKey, fieldsByKey, ctx, memo, visiting) {
  if (memo.has(fieldKey)) return memo.get(fieldKey);
  if (visiting.has(fieldKey)) return 0; // circular percent-of-field reference — treat as 0 rather than infinite recurse
  const field = fieldsByKey[fieldKey];
  if (!field) { memo.set(fieldKey, 0); return 0; }
  visiting.add(fieldKey);
  const cfg = _resolveFieldConfig(field, ctx);
  let amount = 0;
  if (field.calc_mode === 'percent_of_field' && cfg.base_field_key) {
    const baseAmt = _resolveFieldValue(cfg.base_field_key, fieldsByKey, ctx, memo, visiting);
    amount = ((Number(cfg.percent) || 0) / 100) * baseAmt;
  } else {
    amount = Number(cfg.value) || 0;
  }
  if (field.increment_mode) {
    const years = _yearsSince(ctx.joiningDate, ctx.refDate);
    if (field.increment_mode === 'yearly_percent') amount = amount * Math.pow(1 + (Number(field.increment_value) || 0) / 100, years);
    else if (field.increment_mode === 'yearly_fixed') amount = amount + (Number(field.increment_value) || 0) * years;
  }
  visiting.delete(fieldKey);
  memo.set(fieldKey, amount);
  return amount;
}

// Computes one person's payslip for a period. `ref` bundles the shared
// reference data fetched once per run (fields, grade/role config tables,
// statutory items, active section entries, pending bonuses) so run_payroll
// doesn't refetch per person.
function _computePayslipForPerson(personSetup, role, ref, month, year) {
  const gradeId = personSetup?.grade_id || null;
  const applicableFields = ref.fields.filter(f => !f.is_grade_conditional || (gradeId && ref.gradeConditionalSet.has(`${gradeId}:${f.id}`)));
  const fieldsByKey = {}; ref.fields.forEach(f => { fieldsByKey[f.key] = f; });

  const personOverridesByField = {}; (ref.personOverridesByUser[personSetup.user_id] || []).forEach(o => { personOverridesByField[o.field_id] = o; });
  const gradeFieldsByField = {}; (gradeId ? (ref.gradeFieldsByGrade[gradeId] || []) : []).forEach(g => { gradeFieldsByField[g.field_id] = g; });
  const roleDefaultsByField = {}; ref.roleDefaults.filter(r => r.role === role).forEach(r => { roleDefaultsByField[r.field_id] = r; });

  const ctx = { personOverridesByField, gradeFieldsByField, roleDefaultsByField, joiningDate: personSetup.joining_date, refDate: new Date(Date.UTC(year, month, 0)) };
  const memo = new Map();
  const fieldValues = {};
  applicableFields.forEach(f => { fieldValues[f.key] = _resolveFieldValue(f.key, fieldsByKey, ctx, memo, new Set()); });

  let gross = 0, totalDeductions = 0;
  applicableFields.forEach(f => {
    const amt = fieldValues[f.key] || 0;
    if (f.category === 'deduction') totalDeductions += amt; else gross += amt;
  });

  // Statutory items — employee side is always a deduction; employer match is
  // informational only (tracked, never subtracted from the employee's net).
  const statutoryValues = {};
  ref.statutoryItems.forEach(s => {
    let empAmt = 0;
    if (s.employee_calc_mode === 'fixed') empAmt = Number(s.employee_value) || 0;
    else if (s.employee_base_field_key) empAmt = ((Number(s.employee_percent) || 0) / 100) * (fieldValues[s.employee_base_field_key] ?? _resolveFieldValue(s.employee_base_field_key, fieldsByKey, ctx, memo, new Set()));
    statutoryValues[`statutory:${s.key}`] = empAmt;
    totalDeductions += empAmt;
    if (s.employer_matches) statutoryValues[`statutory_employer:${s.key}`] = ((Number(s.employer_percent) || 0) / 100) * (fieldValues[s.employee_base_field_key] || 0);
  });

  // Active loan/advance section entries for this person.
  const sectionAmounts = {};
  (ref.sectionEntriesByUser[personSetup.user_id] || []).forEach(entry => {
    const section = ref.sectionsById[entry.section_id];
    if (!section) return;
    const amt = entry.emi_amount != null ? Number(entry.emi_amount) : (Number(entry.total_amount) / (Number(entry.emi_months) || 1));
    sectionAmounts[entry.id] = amt;
    if (section.direction === 'add') gross += amt; else totalDeductions += amt;
  });

  // Pending bonus payments for this exact month/year.
  let bonusTotal = 0;
  (ref.bonusesByUser[personSetup.user_id] || []).forEach(b => { bonusTotal += Number(b.amount) || 0; });
  if (bonusTotal) { fieldValues['bonus_total'] = bonusTotal; gross += bonusTotal; }

  return {
    user_id: personSetup.user_id,
    grade_id: gradeId,
    field_values: { ...fieldValues, ...statutoryValues },
    section_amounts: sectionAmounts,
    gross: Math.round(gross * 100) / 100,
    total_deductions: Math.round(totalDeductions * 100) / 100,
    net: Math.round((gross - totalDeductions) * 100) / 100,
  };
}

// Fetches every table the engine needs, once, for a given set of user ids + period.
async function _loadPayrollRef(userIds, month, year) {
  const [fields, gradeFields, gradeConditional, roleDefaults, statutoryItemsRaw, sections, sectionEntriesRaw, bonusesRaw, allOverridesRaw] = await Promise.all([
    sbPayroll('fields?is_active=eq.true&select=*'),
    sbPayroll('grade_fields?select=*'),
    sbPayroll('grade_conditional_fields?select=*'),
    sbPayroll('field_role_defaults?select=*'),
    sbPayroll('statutory_items?is_active=eq.true&select=*'),
    sbPayroll('sections?select=*'),
    sbPayroll('section_entries?status=eq.active&select=*'),
    sbPayroll(`bonus_payments?status=eq.pending&month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}&select=*`),
    sbPayroll('person_field_overrides?select=*'),
  ]);
  const gradeFieldsByGrade = {}; (gradeFields || []).forEach(g => { (gradeFieldsByGrade[g.grade_id] = gradeFieldsByGrade[g.grade_id] || []).push(g); });
  const gradeConditionalSet = new Set((gradeConditional || []).map(c => `${c.grade_id}:${c.field_id}`));
  const sectionsById = {}; (sections || []).forEach(s => { sectionsById[s.id] = s; });
  const sectionEntriesByUser = {}; (sectionEntriesRaw || []).forEach(e => { (sectionEntriesByUser[e.user_id] = sectionEntriesByUser[e.user_id] || []).push(e); });
  const bonusesByUser = {}; (bonusesRaw || []).forEach(b => { (bonusesByUser[b.user_id] = bonusesByUser[b.user_id] || []).push(b); });
  const personOverridesByUser = {}; (allOverridesRaw || []).forEach(o => { (personOverridesByUser[o.user_id] = personOverridesByUser[o.user_id] || []).push(o); });
  return {
    fields: fields || [], gradeFieldsByGrade, gradeConditionalSet, roleDefaults: roleDefaults || [],
    statutoryItems: statutoryItemsRaw || [], sectionsById, sectionEntriesByUser, bonusesByUser, personOverridesByUser,
  };
}

async function _rolesForUsers(userIds) {
  if (!userIds.length) return {};
  const rows = await _teacherSchemaFetch(`app_users?user_id=in.(${userIds.map(id => encodeURIComponent(id)).join(',')})&select=user_id,role`);
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { map[r.user_id] = String(r.role || '').split(',')[0].trim(); });
  return map;
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
    const runRows = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`);
    const runRow = (!runRows?.error && runRows[0]) || null;
    if (!runRow) return NextResponse.json({ result: 'error', message: 'Run not found' }, { status: 404 });
    if (runRow.status === 'finalized') return NextResponse.json({ result: 'error', message: 'Already finalized' }, { status: 400 });

    // Finalizing is the only point section balances/bonus status actually
    // move — a draft or pending-approval run must stay side-effect-free so
    // it can be safely recomputed by run_payroll right up until approval.
    const slips = await sbPayroll(`payslips?run_id=eq.${encodeURIComponent(run_id)}&select=*`);
    if (!slips?.error && Array.isArray(slips)) {
      for (const slip of slips) {
        const sectionAmounts = slip.section_amounts || {};
        for (const entryId of Object.keys(sectionAmounts)) {
          const entryRows = await sbPayroll(`section_entries?id=eq.${encodeURIComponent(entryId)}`);
          const entry = (!entryRows?.error && entryRows[0]) || null;
          if (!entry) continue;
          const newRemaining = Math.max(0, Number(entry.remaining_amount) - Number(sectionAmounts[entryId]));
          await sbPayroll(`section_entries?id=eq.${encodeURIComponent(entryId)}`, 'PATCH', {
            remaining_amount: newRemaining,
            status: newRemaining <= 0 ? 'completed' : 'active',
          });
        }
      }
      const userIds = slips.map(s => s.user_id);
      if (userIds.length) {
        const bonusRows = await sbPayroll(`bonus_payments?status=eq.pending&month=eq.${encodeURIComponent(runRow.month)}&year=eq.${encodeURIComponent(runRow.year)}&select=id,user_id`);
        const toMark = (!bonusRows?.error ? bonusRows : []).filter(b => userIds.includes(b.user_id));
        for (const b of toMark) await sbPayroll(`bonus_payments?id=eq.${encodeURIComponent(b.id)}`, 'PATCH', { status: 'paid' });
      }
    }

    const saved = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`, 'PATCH', { status: 'finalized', approved_by: user_id, approved_at: new Date().toISOString() });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'approve_run', 'runs', run_id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Loan / Advance sections ──
  if (action === 'get_sections') {
    const rows = await sbPayroll('sections?select=*&order=id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', sections: rows });
  }

  if (action === 'save_section') {
    const { id, name, direction } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name is required' }, { status: 400 });
    const rowData = { name, direction: direction === 'add' ? 'add' : 'deduct' };
    const saved = id
      ? await sbPayroll(`sections?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('sections', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_section', 'sections', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', section: savedRow });
  }

  if (action === 'delete_section') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`sections?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_section', 'sections', id);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_section_entries') {
    const { section_id } = payload;
    let q = 'section_entries?select=*&order=created_at.desc';
    if (section_id) q += `&section_id=eq.${encodeURIComponent(section_id)}`;
    const rows = await sbPayroll(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', entries: rows });
  }

  if (action === 'add_section_entry') {
    const { section_id, user_id: personId, total_amount, emi_amount, emi_months, note } = payload;
    if (!section_id || !personId || !total_amount) return NextResponse.json({ result: 'error', message: 'Section, person and total amount are required' }, { status: 400 });
    if (!emi_amount && !emi_months) return NextResponse.json({ result: 'error', message: 'Set either a fixed EMI amount or a number of EMI months' }, { status: 400 });
    const rowData = {
      section_id, user_id: personId,
      total_amount: Number(total_amount),
      emi_amount: emi_amount ? Number(emi_amount) : null,
      emi_months: emi_months ? Number(emi_months) : null,
      remaining_amount: Number(total_amount),
      note: note || null,
    };
    const saved = await sbPayroll('section_entries', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'add_section_entry', 'section_entries', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', entry: savedRow });
  }

  if (action === 'update_section_entry_status') {
    const { id, status } = payload;
    if (!id || !status) return NextResponse.json({ result: 'error', message: 'id and status required' }, { status: 400 });
    const saved = await sbPayroll(`section_entries?id=eq.${encodeURIComponent(id)}`, 'PATCH', { status });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'update_section_entry_status', 'section_entries', id, { status });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'delete_section_entry') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`section_entries?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_section_entry', 'section_entries', id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Run & Payslips ──
  if (action === 'preview_payslip') {
    const { user_id: personId, month, year } = payload;
    if (!personId || !month || !year) return NextResponse.json({ result: 'error', message: 'user_id, month and year are required' }, { status: 400 });
    const personRows = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`);
    const personSetup = (!personRows?.error && personRows[0]) || { user_id: personId, grade_id: null, joining_date: null };
    const roles = await _rolesForUsers([personId]);
    const ref = await _loadPayrollRef([personId], month, year);
    const slip = _computePayslipForPerson(personSetup, roles[personId] || '', ref, Number(month), Number(year));
    return NextResponse.json({ result: 'success', payslip: slip });
  }

  if (action === 'run_payroll') {
    const { month, year } = payload;
    if (!month || !year) return NextResponse.json({ result: 'error', message: 'month and year are required' }, { status: 400 });
    const peopleRows = await sbPayroll('person_setup?is_active=eq.true&select=*');
    if (peopleRows?.error) return NextResponse.json({ result: 'error', message: peopleRows.error }, { status: 500 });
    const people = peopleRows || [];
    if (!people.length) return NextResponse.json({ result: 'error', message: 'No active people set up under the People tab yet' }, { status: 400 });

    const existingRun = await sbPayroll(`runs?month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}`);
    let run = (!existingRun?.error && existingRun[0]) || null;
    if (!run) {
      const created = await sbPayroll('runs', 'POST', { month: Number(month), year: Number(year), status: 'draft' });
      if (created?.error) return NextResponse.json({ result: 'error', message: created.error }, { status: 500 });
      run = Array.isArray(created) ? created[0] : created;
    } else if (run.status === 'finalized') {
      return NextResponse.json({ result: 'error', message: 'This run is already finalized and cannot be recomputed' }, { status: 400 });
    }

    const roles = await _rolesForUsers(people.map(p => p.user_id));
    const ref = await _loadPayrollRef(people.map(p => p.user_id), month, year);
    const slips = people.map(p => _computePayslipForPerson(p, roles[p.user_id] || '', ref, Number(month), Number(year)));

    for (const slip of slips) {
      const rowData = { run_id: run.id, ...slip };
      const existingSlip = await sbPayroll(`payslips?run_id=eq.${run.id}&user_id=eq.${encodeURIComponent(slip.user_id)}`);
      if (!existingSlip?.error && existingSlip.length) await sbPayroll(`payslips?run_id=eq.${run.id}&user_id=eq.${encodeURIComponent(slip.user_id)}`, 'PATCH', rowData);
      else await sbPayroll('payslips', 'POST', rowData);
    }
    _prAudit(user_id, 'run_payroll', 'runs', run.id, { month, year, count: slips.length });
    return NextResponse.json({ result: 'success', run, generated: slips.length });
  }

  if (action === 'get_payroll_runs') {
    const rows = await sbPayroll('runs?select=*&order=year.desc,month.desc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', runs: rows });
  }

  if (action === 'get_payslips') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const rows = await sbPayroll(`payslips?run_id=eq.${encodeURIComponent(run_id)}&select=*&order=user_id.asc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', payslips: rows });
  }

  if (action === 'delete_run') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const runRow = await sbPayroll(`runs?id=eq.${encodeURIComponent(id)}`);
    if (!runRow?.error && runRow[0] && runRow[0].status === 'finalized') {
      return NextResponse.json({ result: 'error', message: 'Cannot delete a finalized run' }, { status: 400 });
    }
    const del = await sbPayroll(`runs?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_run', 'runs', id);
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
