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

function _compareOp(a, op, b) {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

// IF/THEN branching: a field's own condition rules (payroll.field_condition_rules)
// are checked in priority order before falling back to its normal
// person/grade/role-resolved amount. source_key is either another field's
// key or the special 'tenure_years' (years since joining_date, as of the
// run's period). First matching rule wins — later rules are the "else if"
// chain, and no match at all is the implicit "else" (normal resolution).
function _resolveFieldValue(fieldKey, fieldsByKey, ctx, memo, visiting) {
  if (memo.has(fieldKey)) return memo.get(fieldKey);
  if (visiting.has(fieldKey)) return 0; // circular percent-of-field reference — treat as 0 rather than infinite recurse
  const field = fieldsByKey[fieldKey];
  if (!field) { memo.set(fieldKey, 0); return 0; }
  visiting.add(fieldKey);

  let amount = 0;
  const rules = ctx.conditionRulesByField[field.id] || [];
  let matchedRule = null;
  for (const rule of rules) {
    const srcVal = rule.source_key === 'tenure_years'
      ? _yearsSince(ctx.joiningDate, ctx.refDate)
      : _resolveFieldValue(rule.source_key, fieldsByKey, ctx, memo, visiting);
    if (_compareOp(srcVal, rule.operator, Number(rule.compare_value))) { matchedRule = rule; break; }
  }

  if (matchedRule) {
    if (matchedRule.then_calc_mode === 'percent_of_field' && matchedRule.then_base_field_key) {
      const baseAmt = _resolveFieldValue(matchedRule.then_base_field_key, fieldsByKey, ctx, memo, visiting);
      amount = ((Number(matchedRule.then_percent) || 0) / 100) * baseAmt;
    } else {
      amount = Number(matchedRule.then_value) || 0;
    }
  } else {
    const cfg = _resolveFieldConfig(field, ctx);
    if (field.calc_mode === 'percent_of_field' && cfg.base_field_key) {
      const baseAmt = _resolveFieldValue(cfg.base_field_key, fieldsByKey, ctx, memo, visiting);
      amount = ((Number(cfg.percent) || 0) / 100) * baseAmt;
    } else {
      amount = Number(cfg.value) || 0;
    }
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
  const applicableFields = ref.fields.filter(f => {
    if (f.is_grade_conditional && !(gradeId && ref.gradeConditionalSet.has(`${gradeId}:${f.id}`))) return false;
    if (f.is_role_conditional && !(ref.applicableRolesByField[f.id] || new Set()).has(role)) return false;
    return true;
  });
  const fieldsByKey = {}; ref.fields.forEach(f => { fieldsByKey[f.key] = f; });

  const personOverridesByField = {}; (ref.personOverridesByUser[personSetup.user_id] || []).forEach(o => { personOverridesByField[o.field_id] = o; });
  const gradeFieldsByField = {}; (gradeId ? (ref.gradeFieldsByGrade[gradeId] || []) : []).forEach(g => { gradeFieldsByField[g.field_id] = g; });
  const roleDefaultsByField = {}; ref.roleDefaults.filter(r => r.role === role).forEach(r => { roleDefaultsByField[r.field_id] = r; });

  const ctx = { personOverridesByField, gradeFieldsByField, roleDefaultsByField, joiningDate: personSetup.joining_date, refDate: new Date(Date.UTC(year, month, 0)), conditionRulesByField: ref.conditionRulesByField };
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

  // Leave/attendance deductions entered for this exact month/year.
  let leaveDeductionTotal = 0;
  (ref.leaveDeductionsByUser[personSetup.user_id] || []).forEach(l => { leaveDeductionTotal += Number(l.amount) || 0; });
  if (leaveDeductionTotal) { fieldValues['leave_deduction'] = leaveDeductionTotal; totalDeductions += leaveDeductionTotal; }

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
  const [fields, gradeFields, gradeConditional, roleDefaults, statutoryItemsRaw, sections, sectionEntriesRaw, bonusesRaw, allOverridesRaw, applicableRolesRaw, conditionRulesRaw, leaveDeductionsRaw] = await Promise.all([
    sbPayroll('fields?is_active=eq.true&select=*'),
    sbPayroll('grade_fields?select=*'),
    sbPayroll('grade_conditional_fields?select=*'),
    sbPayroll('field_role_defaults?select=*'),
    sbPayroll('statutory_items?is_active=eq.true&select=*'),
    sbPayroll('sections?select=*'),
    sbPayroll('section_entries?status=eq.active&select=*'),
    sbPayroll(`bonus_payments?status=eq.pending&month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}&select=*`),
    sbPayroll('person_field_overrides?select=*'),
    sbPayroll('field_applicable_roles?select=*'),
    sbPayroll('field_condition_rules?select=*&order=priority.asc'),
    sbPayroll(`leave_deductions?month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}&select=*`),
  ]);
  const gradeFieldsByGrade = {}; (gradeFields || []).forEach(g => { (gradeFieldsByGrade[g.grade_id] = gradeFieldsByGrade[g.grade_id] || []).push(g); });
  const gradeConditionalSet = new Set((gradeConditional || []).map(c => `${c.grade_id}:${c.field_id}`));
  const sectionsById = {}; (sections || []).forEach(s => { sectionsById[s.id] = s; });
  const sectionEntriesByUser = {}; (sectionEntriesRaw || []).forEach(e => { (sectionEntriesByUser[e.user_id] = sectionEntriesByUser[e.user_id] || []).push(e); });
  const bonusesByUser = {}; (bonusesRaw || []).forEach(b => { (bonusesByUser[b.user_id] = bonusesByUser[b.user_id] || []).push(b); });
  const personOverridesByUser = {}; (allOverridesRaw || []).forEach(o => { (personOverridesByUser[o.user_id] = personOverridesByUser[o.user_id] || []).push(o); });
  const applicableRolesByField = {}; (applicableRolesRaw || []).forEach(a => { (applicableRolesByField[a.field_id] = applicableRolesByField[a.field_id] || new Set()).add(a.role); });
  const conditionRulesByField = {}; (conditionRulesRaw || []).forEach(r => { (conditionRulesByField[r.field_id] = conditionRulesByField[r.field_id] || []).push(r); });
  const leaveDeductionsByUser = {}; (leaveDeductionsRaw || []).forEach(l => { (leaveDeductionsByUser[l.user_id] = leaveDeductionsByUser[l.user_id] || []).push(l); });
  return {
    fields: fields || [], gradeFieldsByGrade, gradeConditionalSet, roleDefaults: roleDefaults || [],
    statutoryItems: statutoryItemsRaw || [], sectionsById, sectionEntriesByUser, bonusesByUser, personOverridesByUser,
    applicableRolesByField, conditionRulesByField, leaveDeductionsByUser,
  };
}

async function _rolesForUsers(userIds) {
  if (!userIds.length) return {};
  const rows = await _teacherSchemaFetch(`app_users?user_id=in.(${userIds.map(id => encodeURIComponent(id)).join(',')})&select=user_id,role`);
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { map[r.user_id] = String(r.role || '').split(',')[0].trim(); });
  return map;
}

// Shared by the run_payroll POST action and the GET cron endpoint below —
// one place computes and persists a draft run for a period so both entry
// points behave identically.
async function _runPayrollForPeriod(month, year, actorUserId) {
  if (!month || !year) return { error: 'month and year are required', status: 400 };
  const peopleRows = await sbPayroll('person_setup?is_active=eq.true&select=*');
  if (peopleRows?.error) return { error: peopleRows.error, status: 500 };
  const people = peopleRows || [];
  if (!people.length) return { error: 'No active people set up under the People tab yet', status: 400 };

  const existingRun = await sbPayroll(`runs?month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}`);
  let run = (!existingRun?.error && existingRun[0]) || null;
  if (!run) {
    const created = await sbPayroll('runs', 'POST', { month: Number(month), year: Number(year), status: 'draft' });
    if (created?.error) return { error: created.error, status: 500 };
    run = Array.isArray(created) ? created[0] : created;
  } else if (run.status === 'finalized') {
    return { error: 'This run is already finalized and cannot be recomputed', status: 400 };
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
  _prAudit(actorUserId, 'run_payroll', 'runs', run.id, { month, year, count: slips.length });
  return { run, generated: slips.length };
}

// Vercel Cron hits this (GET only, per Vercel's cron contract, see
// vercel.json) once a month to auto-generate a DRAFT run — it still
// requires a human to Submit for Approval / Approve & Finalize in the UI,
// so an unattended run never pays anyone by itself, only saves someone
// having to remember to click "Run Payroll" on the 1st. Auth relies on
// Vercel's own convention: when a CRON_SECRET env var is set, Vercel signs
// every cron-triggered request with `Authorization: Bearer <CRON_SECRET>`
// automatically — no secret needs to live in this repo or in vercel.json.
export async function GET(req) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ result: 'error', message: 'Unauthorized' }, { status: 401 });
  }
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const result = await _runPayrollForPeriod(month, year, 'cron');
  if (result.error) return NextResponse.json({ result: 'error', message: result.error }, { status: result.status || 500 });
  return NextResponse.json({ result: 'success', run: result.run, generated: result.generated });
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
    const { id, key, label, category, calc_mode, calc_base_field_key, increment_mode, increment_value, is_grade_conditional, is_role_conditional, is_active, sort_order } = payload;
    if (!key || !label) return NextResponse.json({ result: 'error', message: 'Key and label are required' }, { status: 400 });
    const rowData = {
      key, label,
      category: category || 'earning',
      calc_mode: calc_mode || 'fixed',
      calc_base_field_key: calc_base_field_key || null,
      increment_mode: increment_mode || null,
      increment_value: increment_value === '' || increment_value == null ? null : Number(increment_value),
      is_grade_conditional: !!is_grade_conditional,
      is_role_conditional: !!is_role_conditional,
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

  // ── Field conditional logic: role-gated applicability + IF/THEN rules ──
  if (action === 'get_field_conditions') {
    const { field_id } = payload;
    if (!field_id) return NextResponse.json({ result: 'error', message: 'field_id required' }, { status: 400 });
    const [applicableRoles, rules] = await Promise.all([
      sbPayroll(`field_applicable_roles?field_id=eq.${encodeURIComponent(field_id)}&select=*`),
      sbPayroll(`field_condition_rules?field_id=eq.${encodeURIComponent(field_id)}&select=*&order=priority.asc`),
    ]);
    if (applicableRoles?.error) return NextResponse.json({ result: 'error', message: applicableRoles.error }, { status: 500 });
    if (rules?.error) return NextResponse.json({ result: 'error', message: rules.error }, { status: 500 });
    return NextResponse.json({ result: 'success', applicable_roles: applicableRoles, condition_rules: rules });
  }

  if (action === 'toggle_field_applicable_role') {
    const { field_id, role, enabled } = payload;
    if (!field_id || !role) return NextResponse.json({ result: 'error', message: 'field_id and role required' }, { status: 400 });
    if (enabled) {
      const saved = await sbPayroll('field_applicable_roles', 'POST', { field_id, role });
      if (saved?.error && !String(saved.error).includes('duplicate')) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    } else {
      const del = await sbPayroll(`field_applicable_roles?field_id=eq.${encodeURIComponent(field_id)}&role=eq.${encodeURIComponent(role)}`, 'DELETE');
      if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    }
    _prAudit(user_id, 'toggle_field_applicable_role', 'field_applicable_roles', `${field_id}:${role}`, { enabled });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'save_field_condition_rule') {
    const { id, field_id, priority, source_key, operator, compare_value, then_calc_mode, then_value, then_percent, then_base_field_key } = payload;
    if (!field_id || !source_key || !operator || compare_value === '' || compare_value == null) {
      return NextResponse.json({ result: 'error', message: 'field, source, operator and compare value are required' }, { status: 400 });
    }
    const rowData = {
      field_id, priority: priority == null ? 0 : Number(priority),
      source_key, operator, compare_value: Number(compare_value),
      then_calc_mode: then_calc_mode || 'fixed',
      then_value: then_value === '' || then_value == null ? null : Number(then_value),
      then_percent: then_percent === '' || then_percent == null ? null : Number(then_percent),
      then_base_field_key: then_base_field_key || null,
    };
    const saved = id
      ? await sbPayroll(`field_condition_rules?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('field_condition_rules', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_field_condition_rule', 'field_condition_rules', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', rule: savedRow });
  }

  if (action === 'delete_field_condition_rule') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`field_condition_rules?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_field_condition_rule', 'field_condition_rules', id);
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

  // Bulk-seed person_setup so every teacher/staff member is picked up by
  // run_payroll (which only looks at person_setup?is_active=true) without
  // requiring the admin to click through the People tab one at a time.
  // Existing rows are left untouched — this only fills in what's missing.
  if (action === 'bulk_add_people') {
    const { user_ids } = payload;
    if (!Array.isArray(user_ids) || !user_ids.length) return NextResponse.json({ result: 'error', message: 'user_ids required' }, { status: 400 });
    const existing = await sbPayroll('person_setup?select=user_id');
    const existingSet = new Set((!existing?.error ? existing : []).map(p => p.user_id));
    const missing = [...new Set(user_ids)].filter(id => id && !existingSet.has(id));
    if (!missing.length) return NextResponse.json({ result: 'success', added: 0 });
    const rows = missing.map(user_id => ({ user_id, grade_id: null, joining_date: null, is_active: true }));
    const saved = await sbPayroll('person_setup', 'POST', rows);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'bulk_add_people', 'person_setup', null, { added: missing.length });
    return NextResponse.json({ result: 'success', added: missing.length });
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

  // Approved leave requests overlapping the given month/year — pulled from
  // the existing teacher.leave_requests table (the real staff leave
  // system) so an admin doesn't have to separately remember who was on
  // leave when entering a leave deduction; still a manual "convert to
  // deduction" step since payroll has no way to know which leave types are
  // unpaid vs paid without that being modeled here too.
  if (action === 'get_leave_requests_for_period') {
    const { month, year } = payload;
    if (!month || !year) return NextResponse.json({ result: 'error', message: 'month and year required' }, { status: 400 });
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0));
    const rows = await _teacherSchemaFetch(`leave_requests?status=eq.approved&select=*,leave_types(name)&order=start_date.desc`);
    const overlapping = (Array.isArray(rows) ? rows : []).filter(r => {
      if (!r.start_date || !r.end_date) return false;
      const s = new Date(r.start_date), e = new Date(r.end_date);
      return s <= periodEnd && e >= periodStart;
    }).map(r => {
      const s = new Date(r.start_date) < periodStart ? periodStart : new Date(r.start_date);
      const e = new Date(r.end_date) > periodEnd ? periodEnd : new Date(r.end_date);
      const days = Math.round((e - s) / 86400000) + 1;
      return { teacher_id: r.teacher_id, leave_type: r.leave_types?.name || '', start_date: r.start_date, end_date: r.end_date, days_in_period: days };
    });
    return NextResponse.json({ result: 'success', requests: overlapping });
  }

  // ── Leave / attendance-linked deductions (one-off, tied to a specific month) ──
  if (action === 'get_leave_deductions') {
    const { month, year } = payload;
    let q = 'leave_deductions?select=*&order=created_at.desc';
    if (month) q += `&month=eq.${encodeURIComponent(month)}`;
    if (year) q += `&year=eq.${encodeURIComponent(year)}`;
    const rows = await sbPayroll(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', deductions: rows });
  }

  if (action === 'save_leave_deduction') {
    const { id, user_id: personId, days, amount, month, year, note } = payload;
    if (!personId || !amount || !month || !year) return NextResponse.json({ result: 'error', message: 'Person, amount, month and year are required' }, { status: 400 });
    const rowData = { user_id: personId, days: days === '' || days == null ? null : Number(days), amount: Number(amount), month: Number(month), year: Number(year), note: note || null };
    const saved = id
      ? await sbPayroll(`leave_deductions?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('leave_deductions', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_leave_deduction', 'leave_deductions', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', deduction: savedRow });
  }

  if (action === 'delete_leave_deduction') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`leave_deductions?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_leave_deduction', 'leave_deductions', id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Excel import (per section, with calculated-column validation) ──
  // rows are plain objects straight from XLSX.utils.sheet_to_json — header
  // names in the sheet must match the field names documented per target in
  // the client's import modal. Returns { imported, errors: [{row, message}] }
  // so the caller shows exactly which rows failed and why rather than an
  // all-or-nothing failure.
  if (action === 'import_rows') {
    const { target, rows, section_id } = payload;
    if (!target || !Array.isArray(rows) || !rows.length) return NextResponse.json({ result: 'error', message: 'target and rows are required' }, { status: 400 });

    const errors = [];
    let imported = 0;

    if (target === 'people') {
      const gradesRes = await sbPayroll('grades?select=id,name');
      const gradeByName = {}; (gradesRes || []).forEach(g => { gradeByName[String(g.name).toLowerCase()] = g.id; });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.user_id) { errors.push({ row: i + 2, message: 'user_id is required' }); continue; }
        const grade_id = r.grade_name ? (gradeByName[String(r.grade_name).toLowerCase()] || null) : null;
        if (r.grade_name && !grade_id) { errors.push({ row: i + 2, message: `Grade "${r.grade_name}" not found` }); continue; }
        const rowData = {
          user_id: String(r.user_id), grade_id,
          joining_date: r.joining_date || null,
          is_active: true,
          bank_name: r.bank_name || null, bank_account_no: r.bank_account_no || null,
          mobile_banking_provider: r.mobile_banking_provider || null, mobile_banking_number: r.mobile_banking_number || null,
        };
        const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(rowData.user_id)}`);
        const saved = (!existing?.error && existing.length)
          ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(rowData.user_id)}`, 'PATCH', rowData)
          : await sbPayroll('person_setup', 'POST', rowData);
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else if (target === 'section_entries') {
      let sectionsByName = {};
      if (!section_id) {
        const sectionsRes = await sbPayroll('sections?select=id,name');
        (sectionsRes || []).forEach(s => { sectionsByName[String(s.name).toLowerCase()] = s.id; });
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const sid = section_id || (r.section_name ? sectionsByName[String(r.section_name).toLowerCase()] : null);
        if (!sid) { errors.push({ row: i + 2, message: r.section_name ? `Section "${r.section_name}" not found` : 'section_name is required' }); continue; }
        if (!r.user_id || !r.total_amount) { errors.push({ row: i + 2, message: 'user_id and total_amount are required' }); continue; }
        if (!r.emi_amount && !r.emi_months) { errors.push({ row: i + 2, message: 'Set either emi_amount or emi_months' }); continue; }
        // Calculated-column check: if the sheet supplies all three, the math must agree.
        if (r.emi_amount && r.emi_months) {
          const expected = Number(r.total_amount) / Number(r.emi_months);
          if (Math.abs(expected - Number(r.emi_amount)) > 0.5) {
            errors.push({ row: i + 2, message: `emi_amount (${r.emi_amount}) doesn't match total_amount/emi_months (${expected.toFixed(2)})` });
            continue;
          }
        }
        const rowData = {
          section_id: sid, user_id: String(r.user_id), total_amount: Number(r.total_amount),
          emi_amount: r.emi_amount ? Number(r.emi_amount) : null, emi_months: r.emi_months ? Number(r.emi_months) : null,
          remaining_amount: Number(r.total_amount), note: r.note || null,
        };
        const saved = await sbPayroll('section_entries', 'POST', rowData);
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else if (target === 'bonus_payments') {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.user_id || !r.label || !r.amount || !r.month || !r.year) { errors.push({ row: i + 2, message: 'user_id, label, amount, month and year are required' }); continue; }
        const saved = await sbPayroll('bonus_payments', 'POST', { user_id: String(r.user_id), label: r.label, amount: Number(r.amount), month: Number(r.month), year: Number(r.year), status: 'pending', note: r.note || null });
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else if (target === 'leave_deductions') {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.user_id || !r.amount || !r.month || !r.year) { errors.push({ row: i + 2, message: 'user_id, amount, month and year are required' }); continue; }
        // Calculated-column check: if the sheet supplies days + a per-day rate, the amount must agree.
        if (r.days && r.per_day_rate) {
          const expected = Number(r.days) * Number(r.per_day_rate);
          if (Math.abs(expected - Number(r.amount)) > 0.5) {
            errors.push({ row: i + 2, message: `amount (${r.amount}) doesn't match days×per_day_rate (${expected.toFixed(2)})` });
            continue;
          }
        }
        const saved = await sbPayroll('leave_deductions', 'POST', { user_id: String(r.user_id), days: r.days ? Number(r.days) : null, amount: Number(r.amount), month: Number(r.month), year: Number(r.year), note: r.note || null });
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else {
      return NextResponse.json({ result: 'error', message: 'Unknown import target' }, { status: 400 });
    }

    _prAudit(user_id, 'import_rows', target, section_id || null, { imported, error_count: errors.length });
    return NextResponse.json({ result: 'success', imported, errors });
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
    const result = await _runPayrollForPeriod(month, year, user_id);
    if (result.error) return NextResponse.json({ result: 'error', message: result.error }, { status: result.status || 500 });
    return NextResponse.json({ result: 'success', run: result.run, generated: result.generated });
  }

  if (action === 'get_payroll_runs') {
    const rows = await sbPayroll('runs?select=*&order=year.desc,month.desc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', runs: rows });
  }

  // Bank/mobile-banking disbursement sheet — the payment-info columns a bank
  // or bKash/Nagad bulk-upload actually expects, joined onto net pay.
  if (action === 'get_payslips_with_payment_info') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const [slips, people] = await Promise.all([
      sbPayroll(`payslips?run_id=eq.${encodeURIComponent(run_id)}&select=user_id,net`),
      sbPayroll('person_setup?select=user_id,bank_name,bank_account_no,mobile_banking_provider,mobile_banking_number'),
    ]);
    if (slips?.error) return NextResponse.json({ result: 'error', message: slips.error }, { status: 500 });
    const paymentByUser = {}; (people || []).forEach(p => { paymentByUser[p.user_id] = p; });
    const rows = (slips || []).map(s => ({ ...s, ...(paymentByUser[s.user_id] || {}) }));
    return NextResponse.json({ result: 'success', rows });
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
