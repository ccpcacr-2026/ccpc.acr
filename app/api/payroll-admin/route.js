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

async function _isPayrollAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Accounts Admin');
}

// Role-based, not a hardcoded id — a manually locked run can only be
// unlocked by whoever holds the 'Super Admin' role (assigned the same way
// as any other role, via app_users.role), never by a regular Payroll/
// Accounts Admin.
async function _isSuperAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Super Admin');
}

// The MPO Amount screen's single global lock — same manual-lock/Super-
// Admin-unlock shape as payroll.runs.is_locked, but for a value with no
// "run" of its own to attach a flag to (mpo_amount is one live column,
// re-entered whole every year, not a per-period record).
async function _isMpoLocked() {
  const rows = await sbPayroll('mpo_lock?id=eq.1&select=is_locked');
  return !rows?.error && rows[0] && rows[0].is_locked === true;
}

// Reads from the `teacher_staff` schema (staff directory) — same raw-fetch pattern.
async function _teacherSchemaFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher_staff' },
  });
  if (!res.ok) return [];
  return res.json();
}

// Write counterpart — used only by create_payroll_person, which is the one
// place this route touches app_users/users_profile instead of the payroll
// schema tables everything else here deals with.
async function _teacherSchemaWrite(path, method, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation', 'Accept-Profile': 'teacher_staff', 'Content-Profile': 'teacher_staff',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Case/spacing-insensitive so "Md. Karim  Uddin" from a hand-typed sheet
// still matches "md. karim uddin" in users_profile.full_name.
function _normPersonName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

// Reads from the `student` schema — used only for bus_stoppages, the fare
// lookup table for staff-child bus fare entries (see Sections tab).
async function _studentSchemaFetch(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'student' },
  });
  if (!res.ok) return [];
  return res.json();
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
  const gf = ctx.gradeFieldsByField[field.id];
  const rd = ctx.roleDefaultsByField[field.id];
  const value = gf?.value ?? rd?.value ?? null;
  const percent = gf?.percent ?? rd?.percent ?? null;
  const base_field_key = gf?.base_field_key || rd?.base_field_key || field.calc_base_field_key || null;
  // Grade-level only (no role-default equivalent) — a fixed reference step
  // within the person's OWN grade to compute a percent field's base from,
  // instead of the person's own resolved value. e.g. "Incentive = 20% of
  // Basic at Step 1," true for everyone on this grade regardless of which
  // step they're actually sitting at. Unset (the default) keeps today's
  // behaviour.
  const base_step_id = gf?.base_step_id ?? null;
  return { value, percent, base_field_key, base_step_id };
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

// Evaluates one arithmetic "value node" of a logic_tree — terms joined by
// ops, standard precedence (*, / before +, -; max/min lowest, same pass as
// +/-), each term another field's resolved value, a percent of another
// field's value, or a literal constant. Shape: { terms: [{kind:'field',
// key} | {kind:'percent_of_field', key, percent} | {kind:'const', value}],
// ops: ['+','-','*','/','max','min', ...] } with terms.length === ops.length + 1.
// 'max' between two values is how a floor/minimum is expressed (the LARGER
// of the computed amount and a fixed floor); 'min' is a cap/maximum (the
// SMALLER of the two) — see the matching UI labels in _prLogicOpOptionsHtml.
function _evalLogicValueNode(node, fieldsByKey, ctx, memo, visiting) {
  const terms = (node.terms || []).map(t => {
    if (t.kind === 'field') return _resolveFieldValue(t.key, fieldsByKey, ctx, memo, visiting);
    if (t.kind === 'percent_of_field') return ((Number(t.percent) || 0) / 100) * _resolveFieldValue(t.key, fieldsByKey, ctx, memo, visiting);
    return Number(t.value) || 0;
  });
  if (!terms.length) return 0;
  const ops = node.ops || [];
  // Pass 1: collapse * and / left to right.
  const vals = [terms[0]];
  const opsLeft = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === '*' || ops[i] === '/') {
      const prev = vals.pop();
      vals.push(ops[i] === '*' ? prev * terms[i + 1] : prev / (terms[i + 1] || 1));
    } else {
      vals.push(terms[i + 1]);
      opsLeft.push(ops[i]);
    }
  }
  // Pass 2: +, -, max (floor), min (cap) left to right.
  let result = vals[0];
  for (let i = 0; i < opsLeft.length; i++) {
    const b = vals[i + 1];
    if (opsLeft[i] === '+') result += b;
    else if (opsLeft[i] === '-') result -= b;
    else if (opsLeft[i] === 'max') result = Math.max(result, b);
    else if (opsLeft[i] === 'min') result = Math.min(result, b);
  }
  return result;
}

// The right-hand side of a condition — a literal number (value_kind
// 'const', or absent, for every tree saved before this existed), another
// field's resolved value ('field'), or a percent of one ('percent_of_field')
// — the same three kinds a Then/Else value-node term can be.
function _evalLogicConditionValue(cond, fieldsByKey, ctx, memo, visiting) {
  if (cond.value_kind === 'field') return _resolveFieldValue(cond.value_key, fieldsByKey, ctx, memo, visiting);
  if (cond.value_kind === 'percent_of_field') return ((Number(cond.value_percent) || 0) / 100) * _resolveFieldValue(cond.value_key, fieldsByKey, ctx, memo, visiting);
  return Number(cond.value) || 0;
}

// One comparison within an if node's condition group — source is either
// another field's key or 'tenure_years'; source_percent (field sources
// only — percent of a tenure doesn't mean anything) lets the LEFT side be
// "N% of Basic" rather than only ever Basic's full value, e.g. "if 50% of
// Basic > 3550" — the mirror of _evalLogicConditionValue on the right side.
function _evalLogicCondition(cond, fieldsByKey, ctx, memo, visiting) {
  let srcVal;
  if (cond.source === 'tenure_years') srcVal = _yearsSince(ctx.joiningDate, ctx.refDate);
  else {
    srcVal = _resolveFieldValue(cond.source, fieldsByKey, ctx, memo, visiting);
    if (cond.source_percent != null) srcVal = ((Number(cond.source_percent) || 0) / 100) * srcVal;
  }
  return _compareOp(srcVal, cond.op, _evalLogicConditionValue(cond, fieldsByKey, ctx, memo, visiting));
}

// Recursively evaluates a field's Advanced Logic tree (payroll.fields.
// logic_tree) — an arbitrarily-deep nested if/else, where each branch is
// EITHER another { if, then, else } node or a terminal arithmetic value
// node (see _evalLogicValueNode). Replaces condition_rules/calc_mode
// entirely for a field that has one set (checked first, in
// _resolveFieldValue below) rather than layering on top of them.
// node.if = { join: 'AND'|'OR', conditions: [{source,op,value}, ...] } —
// one or more comparisons combined with AND (all must match) or OR (any
// one matches).
function _evalLogicNode(node, fieldsByKey, ctx, memo, visiting) {
  if (!node) return 0;
  if (node.if) {
    const conditions = node.if.conditions || [];
    const results = conditions.map(c => _evalLogicCondition(c, fieldsByKey, ctx, memo, visiting));
    const matched = node.if.join === 'OR' ? results.some(Boolean) : results.every(Boolean);
    return _evalLogicNode(matched ? node.then : node.else, fieldsByKey, ctx, memo, visiting);
  }
  return _evalLogicValueNode(node, fieldsByKey, ctx, memo, visiting);
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

  // An active Section entry linked to this exact field (a loan repayment
  // or recurring allowance set up under Sections > Loan and Advance, etc.)
  // — wins over everything, including a manual person_field_values entry,
  // since it's a deliberate transactional amount with its own start/stop
  // lifecycle rather than a static override. See _computePayslipForPerson
  // for how ctx.sectionEntryByFieldId is built.
  const sectionAmount = ctx.sectionEntryByFieldId ? ctx.sectionEntryByFieldId[field.id] : null;
  if (sectionAmount != null) {
    visiting.delete(fieldKey);
    memo.set(fieldKey, sectionAmount);
    return sectionAmount;
  }

  // A manually-entered or imported value for this specific person — see
  // payroll.person_field_values — always wins outright over condition
  // rules, percent-of-field calc, grade/role defaults, and yearly
  // increments. It exists specifically to say "for this person, use this
  // exact number instead," so nothing downstream should adjust it further.
  const manualValue = ctx.personFieldValuesRow ? ctx.personFieldValuesRow[field.key] : null;
  if (manualValue != null) {
    const amount = Number(manualValue) || 0;
    visiting.delete(fieldKey);
    memo.set(fieldKey, amount);
    return amount;
  }

  let amount = 0;
  if (field.logic_tree) {
    // Advanced Logic (nested if/else) fully replaces condition_rules/
    // calc_mode for this field when set — a field uses one mechanism or
    // the other, never both, so there's no ambiguity about which wins.
    amount = _evalLogicNode(field.logic_tree, fieldsByKey, ctx, memo, visiting);
    if (field.increment_mode) {
      const years = _yearsSince(ctx.joiningDate, ctx.refDate);
      if (field.increment_mode === 'yearly_percent') amount = amount * Math.pow(1 + (Number(field.increment_value) || 0) / 100, years);
      else if (field.increment_mode === 'yearly_fixed') amount = amount + (Number(field.increment_value) || 0) * years;
    }
    visiting.delete(fieldKey);
    memo.set(fieldKey, amount);
    return amount;
  }
  const rules = ctx.conditionRulesByField[field.id] || [];
  let matchedRule = null;
  for (const rule of rules) {
    const srcVal = rule.source_key === 'tenure_years'
      ? _yearsSince(ctx.joiningDate, ctx.refDate)
      : _resolveFieldValue(rule.source_key, fieldsByKey, ctx, memo, visiting);
    if (_compareOp(srcVal, rule.operator, Number(rule.compare_value))) { matchedRule = rule; break; }
  }

  if (matchedRule) {
    if (matchedRule.then_calc_mode === 'percent_or_floor' && matchedRule.then_base_field_key) {
      // Slab-style allowance (e.g. House Rent): whichever is greater of
      // percent% of the base field, or a fixed minimum floor.
      const baseAmt = _resolveFieldValue(matchedRule.then_base_field_key, fieldsByKey, ctx, memo, visiting);
      const percentAmt = ((Number(matchedRule.then_percent) || 0) / 100) * baseAmt;
      amount = Math.max(percentAmt, Number(matchedRule.then_value) || 0);
    } else if (matchedRule.then_calc_mode === 'percent_of_field' && matchedRule.then_base_field_key) {
      const baseAmt = _resolveFieldValue(matchedRule.then_base_field_key, fieldsByKey, ctx, memo, visiting);
      amount = ((Number(matchedRule.then_percent) || 0) / 100) * baseAmt;
    } else {
      amount = Number(matchedRule.then_value) || 0;
    }
  } else {
    const cfg = _resolveFieldConfig(field, ctx);
    if (field.calc_mode === 'percent_of_field' && cfg.base_field_key) {
      // A fixed reference step overrides the usual "resolve the base field
      // for this person" lookup — go straight to that (grade, step) cell's
      // Basic instead, ignoring which step the person is actually on.
      const baseAmt = cfg.base_step_id && ctx.gradeId
        ? (Number(ctx.gradeStepValuesByGradeStep[`${ctx.gradeId}:${cfg.base_step_id}`]) || 0)
        : _resolveFieldValue(cfg.base_field_key, fieldsByKey, ctx, memo, visiting);
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
function _computePayslipForPerson(personSetup, roles, category, ref, month, year) {
  const roleList = Array.isArray(roles) ? roles : (roles ? [roles] : []);
  const gradeId = personSetup?.grade_id || null;

  // Active loan/advance/allowance Section entries for this person, split by
  // whether their SECTION is linked to a specific Field (the link lives on
  // the section, picked once — see save_section — and every entry under it
  // inherits it). A field-linked section's entries have their computed
  // amount become that field's own resolved value (see
  // ctx.sectionEntryByFieldId / _resolveFieldValue) — direction then comes
  // from the FIELD's own category (deduction = loan repayment, addition =
  // allowance), not the section's fixed direction. An entry under an
  // unlinked section is the older, unattributed style: a lump sum still
  // added straight onto gross/totalDeductions per the section's own
  // direction.
  const personEntries = ref.sectionEntriesByUser[personSetup.user_id] || [];
  const entryAmountById = {};
  const sectionEntryByFieldId = {};
  personEntries.forEach(entry => {
    const section = ref.sectionsById[entry.section_id];
    // A 'per_unit' section (see save_section) computes its entries' rate
    // fresh from the section's OWN current unit_rate/unit_max every run —
    // never from anything stored on the entry itself — so a policy change
    // (rate goes up, cap changes) takes effect for every entry
    // immediately, with nothing to re-save by hand.
    const flatRate = entry.unit_count != null && section
      ? (Number(section.unit_rate) || 0) * Math.min(Number(entry.unit_count) || 0, section.unit_max != null ? Number(section.unit_max) : Infinity)
      : (entry.emi_amount != null ? Number(entry.emi_amount) : (Number(entry.total_amount) / (Number(entry.emi_months) || 1)));
    // Capped at what's actually still owed — total_amount doesn't always
    // divide evenly by the flat rate (e.g. Tk.50000 total at a fixed
    // Tk.4000/month is 12 full installments + a final Tk.2000), and
    // without this the LAST month would deduct the full flat rate even
    // though only the remainder is actually owed, overcharging the person
    // by the difference. remaining_amount is the authoritative running
    // balance (kept in sync by approve_run/revert_run_to_draft), so
    // whatever's left simply wins once it's less than a full installment.
    // Recurring entries have no remaining_amount (null) and are never
    // capped — there's no total to run out against.
    const amt = entry.remaining_amount != null ? Math.min(flatRate, Number(entry.remaining_amount)) : flatRate;
    entryAmountById[entry.id] = amt;
    if (section && section.field_id) sectionEntryByFieldId[section.field_id] = amt;
  });

  const applicableFields = ref.fields.filter(f => {
    // A field this person has an active linked entry for is included
    // regardless of its own grade/role/category gates — attaching a loan/
    // allowance to it is an explicit per-person choice that shouldn't be
    // silently defeated by an unrelated conditional the admin never meant
    // to apply here.
    if (sectionEntryByFieldId[f.id] != null) return true;
    if (f.is_grade_conditional && !(gradeId && ref.gradeConditionalSet.has(`${gradeId}:${f.id}`))) return false;
    if (f.is_role_conditional && !roleList.some(r => (ref.applicableRolesByField[f.id] || new Set()).has(r))) return false;
    if (f.is_category_conditional && !(ref.applicableCategoriesByField[f.id] || new Set()).has(category)) return false;
    return true;
  });
  const fieldsByKey = {}; ref.fields.forEach(f => { fieldsByKey[f.key] = f; });

  const gradeFieldsByField = {}; (gradeId ? (ref.gradeFieldsByGrade[gradeId] || []) : []).forEach(g => { gradeFieldsByField[g.field_id] = g; });
  // If more than one of the person's roles has its own default for the same
  // field, the earlier role in their role list wins — same "first listed
  // role is primary" convention the rest of the app already uses.
  const roleDefaultsByField = {};
  roleList.forEach(r => {
    ref.roleDefaults.filter(rd => rd.role === r).forEach(rd => { if (!(rd.field_id in roleDefaultsByField)) roleDefaultsByField[rd.field_id] = rd; });
  });

  const ctx = {
    personFieldValuesRow: ref.personFieldValuesByUser[personSetup.user_id] || null,
    sectionEntryByFieldId,
    gradeFieldsByField, roleDefaultsByField,
    joiningDate: personSetup.joining_date, refDate: new Date(Date.UTC(year, month, 0)),
    conditionRulesByField: ref.conditionRulesByField,
    gradeId, gradeStepValuesByGradeStep: ref.gradeStepValuesByGradeStep,
  };
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

  // section_amounts is still recorded for EVERY active entry regardless of
  // field-linkage — approve_run/revert_run_to_draft key off it to know how
  // much to move on/off remaining_amount. Only entries under an unlinked
  // section add their amount directly here; entries under a field-linked
  // section were already folded into gross/totalDeductions via fieldValues
  // above (see sectionEntryByFieldId).
  const sectionAmounts = {};
  personEntries.forEach(entry => {
    const section = ref.sectionsById[entry.section_id];
    if (!section) return;
    const amt = entryAmountById[entry.id];
    sectionAmounts[entry.id] = amt;
    if (section.field_id) return;
    if (section.direction === 'add') gross += amt; else totalDeductions += amt;
  });

  // Pending bonus payments for this exact month/year — each one either
  // folds into the generic Bonus column (fieldValues.bonus_total, the
  // default) or, when it has a merge_field_key (see save/add_bulk_bonus),
  // adds directly into that field's OWN resolved value instead, so it
  // shows up as part of an existing column rather than a separate line.
  // A merge target may not have been in applicableFields at all (e.g. a
  // grade-conditional field this person doesn't otherwise qualify for) —
  // fieldValues[key] simply starts from 0 in that case via the `|| 0`
  // below, same end result either way.
  let bonusTotal = 0;
  (ref.bonusesByUser[personSetup.user_id] || []).forEach(b => {
    const amt = Number(b.amount) || 0;
    if (b.merge_field_key && fieldsByKey[b.merge_field_key]) {
      fieldValues[b.merge_field_key] = (fieldValues[b.merge_field_key] || 0) + amt;
      gross += amt;
    } else {
      bonusTotal += amt;
    }
  });
  if (bonusTotal) { fieldValues['bonus_total'] = bonusTotal; gross += bonusTotal; }

  // Leave/attendance deductions entered for this exact month/year.
  let leaveDeductionTotal = 0;
  (ref.leaveDeductionsByUser[personSetup.user_id] || []).forEach(l => { leaveDeductionTotal += Number(l.amount) || 0; });
  if (leaveDeductionTotal) { fieldValues['leave_deduction'] = leaveDeductionTotal; totalDeductions += leaveDeductionTotal; }

  // Staff-child bus fare — child_count x the selected stoppage's fare for
  // the chosen trip type, recurring every month while the entry is active.
  // Fare comes from student.bus_stoppages (a shared registry, not
  // Payroll's own data) so a fare change there takes effect immediately.
  let busFareTotal = 0;
  (ref.busFareEntriesByUser[personSetup.user_id] || []).forEach(e => {
    const stoppage = ref.stoppagesById[e.stoppage_id];
    if (!stoppage) return;
    const fare = e.trip_type === 'one_way' ? Number(stoppage.one_way_fare) : Number(stoppage.round_trip_fare);
    busFareTotal += (fare || 0) * (Number(e.child_count) || 1);
  });
  if (busFareTotal) { fieldValues['bus_fare'] = busFareTotal; totalDeductions += busFareTotal; }

  const net = gross - totalDeductions;
  // MPO/College split — a person with a government-approved MPO amount
  // (set once a year, not monthly — see save_person_setup/import_rows)
  // has that much of their GROSS pay funded by the government; College
  // covers the rest of gross. Deductions still apply against the whole
  // net salary regardless of funding source — this only splits where the
  // money comes FROM, not what's deducted. Capped at gross so a stale/
  // oversized mpo_amount can never exceed what's actually being paid.
  const mpoAmount = Math.max(0, Math.min(Number(personSetup.mpo_amount) || 0, gross));
  const collegeAmount = gross - mpoAmount;

  return {
    user_id: personSetup.user_id,
    grade_id: gradeId,
    field_values: { ...fieldValues, ...statutoryValues },
    section_amounts: sectionAmounts,
    gross: Math.round(gross * 100) / 100,
    total_deductions: Math.round(totalDeductions * 100) / 100,
    net: Math.round(net * 100) / 100,
    mpo_amount: Math.round(mpoAmount * 100) / 100,
    college_amount: Math.round(collegeAmount * 100) / 100,
  };
}

// Shared by add_section_entry and update_section_entry — an EMI entry's
// stored fields, given a total, an optional fixed rate/months, and how
// many installments were already paid before this entry existed (or, on
// an edit, is being redefined) in this system. See add_section_entry for
// why "Installments Already Paid" backs remaining_amount down to match.
function _computeEmiEntryFields(payload) {
  const { total_amount, emi_amount, emi_months } = payload;
  if (!total_amount) return { error: 'Total amount is required' };
  if (!emi_amount && !emi_months) return { error: 'Set either a fixed EMI amount or a number of EMI months' };
  const totalNum = Number(total_amount);
  const emiAmountNum = emi_amount ? Number(emi_amount) : null;
  const emiMonthsNum = emi_months ? Number(emi_months) : null;
  const emiRate = emiAmountNum != null ? emiAmountNum : (totalNum / (emiMonthsNum || 1));
  const monthsTotal = emiMonthsNum || (emiRate ? Math.round(totalNum / emiRate) : 0);
  // Clamped to the loan's own span — an accidental "20 already paid" on a
  // 12-month loan would otherwise show as a nonsensical "20 of 12" in
  // loan-statement remarks, on top of never actually reaching remaining
  // <= 0 via that overshoot (Math.max(0, ...) below stops the balance
  // itself from going negative either way).
  const alreadyPaid = Math.max(0, Math.min(Math.floor(Number(payload.already_paid) || 0), monthsTotal || Infinity));
  const remaining = Math.max(0, Math.round((totalNum - alreadyPaid * emiRate) * 100) / 100);
  const fields = {
    total_amount: totalNum, emi_amount: emiAmountNum, emi_months: emiMonthsNum,
    remaining_amount: remaining, paid_installments: alreadyPaid,
  };
  if (remaining <= 0) fields.status = 'completed';
  return { fields };
}

// Fetches every table the engine needs, once, for a given set of user ids + period.
async function _loadPayrollRef(userIds, month, year) {
  const [fields, gradeFields, gradeConditional, roleDefaults, statutoryItemsRaw, sections, sectionEntriesRaw, bonusesRaw, personFieldValuesRaw, applicableRolesRaw, conditionRulesRaw, leaveDeductionsRaw, applicableCategoriesRaw, busFareEntriesRaw, busStoppagesRaw, gradeStepValuesRaw] = await Promise.all([
    sbPayroll('fields?is_active=eq.true&select=*'),
    sbPayroll('grade_fields?select=*'),
    sbPayroll('grade_conditional_fields?select=*'),
    sbPayroll('field_role_defaults?select=*'),
    sbPayroll('statutory_items?is_active=eq.true&select=*'),
    sbPayroll('sections?select=*'),
    sbPayroll('section_entries?status=eq.active&select=*'),
    sbPayroll(`bonus_payments?status=eq.pending&month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}&select=*`),
    sbPayroll('person_field_values?select=*'),
    sbPayroll('field_applicable_roles?select=*'),
    sbPayroll('field_condition_rules?select=*&order=priority.asc'),
    sbPayroll(`leave_deductions?month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}&select=*`),
    sbPayroll('field_applicable_categories?select=*'),
    sbPayroll('bus_fare_entries?is_active=eq.true&select=*'),
    _studentSchemaFetch('bus_stoppages?select=*'),
    sbPayroll('grade_step_values?select=*'),
  ]);
  const gradeFieldsByGrade = {}; (gradeFields || []).forEach(g => { (gradeFieldsByGrade[g.grade_id] = gradeFieldsByGrade[g.grade_id] || []).push(g); });
  // Keyed "grade_id:step_id" -> that cell's fixed Basic — lets a percent
  // grade field target a SPECIFIC step's Basic (e.g. "20% of Basic at Step
  // 1") regardless of which step the person is actually sitting at, via
  // grade_fields.base_step_id. See _resolveFieldConfig/_resolveFieldValue.
  const gradeStepValuesByGradeStep = {};
  (gradeStepValuesRaw || []).forEach(c => { gradeStepValuesByGradeStep[`${c.grade_id}:${c.step_id}`] = c.basic_value; });
  const gradeConditionalSet = new Set((gradeConditional || []).map(c => `${c.grade_id}:${c.field_id}`));
  const sectionsById = {}; (sections || []).forEach(s => { sectionsById[s.id] = s; });
  const sectionEntriesByUser = {}; (sectionEntriesRaw || []).forEach(e => { (sectionEntriesByUser[e.user_id] = sectionEntriesByUser[e.user_id] || []).push(e); });
  const bonusesByUser = {}; (bonusesRaw || []).forEach(b => { (bonusesByUser[b.user_id] = bonusesByUser[b.user_id] || []).push(b); });
  // One row per person, one real column per field (payroll.person_field_values)
  // — see _resolveFieldValue for how a non-null cell here outranks
  // everything else (condition rules, calc mode, grade/role defaults).
  const personFieldValuesByUser = {}; (personFieldValuesRaw || []).forEach(row => { personFieldValuesByUser[row.user_id] = row; });
  const applicableRolesByField = {}; (applicableRolesRaw || []).forEach(a => { (applicableRolesByField[a.field_id] = applicableRolesByField[a.field_id] || new Set()).add(a.role); });
  const conditionRulesByField = {}; (conditionRulesRaw || []).forEach(r => { (conditionRulesByField[r.field_id] = conditionRulesByField[r.field_id] || []).push(r); });
  const leaveDeductionsByUser = {}; (leaveDeductionsRaw || []).forEach(l => { (leaveDeductionsByUser[l.user_id] = leaveDeductionsByUser[l.user_id] || []).push(l); });
  const applicableCategoriesByField = {}; (applicableCategoriesRaw || []).forEach(a => { (applicableCategoriesByField[a.field_id] = applicableCategoriesByField[a.field_id] || new Set()).add(a.category); });
  const stoppagesById = {}; (busStoppagesRaw || []).forEach(s => { stoppagesById[s.id] = s; });
  const busFareEntriesByUser = {}; (busFareEntriesRaw || []).forEach(e => { (busFareEntriesByUser[e.user_id] = busFareEntriesByUser[e.user_id] || []).push(e); });
  return {
    fields: fields || [], gradeFieldsByGrade, gradeConditionalSet, roleDefaults: roleDefaults || [],
    statutoryItems: statutoryItemsRaw || [], sectionsById, sectionEntriesByUser, bonusesByUser, personFieldValuesByUser,
    applicableRolesByField, conditionRulesByField, leaveDeductionsByUser, applicableCategoriesByField,
    stoppagesById, busFareEntriesByUser, gradeStepValuesByGradeStep,
  };
}

// Returns every role a person holds (app_users.role is comma-separated,
// e.g. "Teacher,VP") — a role-conditional field must match ANY of them,
// not just whichever happens to be listed first.
async function _rolesForUsers(userIds) {
  if (!userIds.length) return {};
  const rows = await _teacherSchemaFetch(`app_users?user_id=in.(${userIds.map(id => encodeURIComponent(id)).join(',')})&select=user_id,role`);
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { map[r.user_id] = String(r.role || '').split(',').map(s => s.trim()).filter(Boolean); });
  return map;
}

// Category (Teacher School / Teacher College / Staff, or whatever's
// actually in use — System > Users' free-text Category field) drives
// category-conditional fields, the same mechanism as role/grade
// conditionals but keyed off users_profile.category instead.
async function _categoriesForUsers(userIds) {
  if (!userIds.length) return {};
  const rows = await _teacherSchemaFetch(`users_profile?teacher_id=in.(${userIds.map(id => encodeURIComponent(id)).join(',')})&select=teacher_id,category`);
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach(r => { map[r.teacher_id] = (r.category || '').trim(); });
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
  } else if (run.is_locked) {
    return { error: 'This run is locked and cannot be recomputed', status: 400 };
  } else if (run.status === 'finalized') {
    return { error: 'This run is already finalized and cannot be recomputed', status: 400 };
  }

  const roles = await _rolesForUsers(people.map(p => p.user_id));
  const categories = await _categoriesForUsers(people.map(p => p.user_id));
  const ref = await _loadPayrollRef(people.map(p => p.user_id), month, year);
  const slips = people.map(p => _computePayslipForPerson(p, roles[p.user_id] || [], categories[p.user_id] || '', ref, Number(month), Number(year)));

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
    const { id, key, label, category, calc_mode, calc_base_field_key, increment_mode, increment_value, is_grade_conditional, is_role_conditional, is_category_conditional, is_active, sort_order } = payload;
    if (!key || !label) return NextResponse.json({ result: 'error', message: 'Key and label are required' }, { status: 400 });

    // key becomes a real column name in payroll.person_field_values (the
    // wide Manual/Import values table — see add_field_column below), so a
    // NEW field's key must be a safe Postgres identifier. Editing an
    // existing field never changes its key, so that column mapping stays
    // stable for the field's whole lifetime.
    let finalKey = key;
    if (!id) {
      if (!/^[a-z][a-z0-9_]{0,58}$/.test(key)) {
        return NextResponse.json({ result: 'error', message: 'Key must be lowercase letters, numbers and underscores only, starting with a letter (e.g. "festival_bonus").' }, { status: 400 });
      }
    } else {
      const existingField = await sbPayroll(`fields?id=eq.${encodeURIComponent(id)}&select=key`);
      if (existingField?.error) return NextResponse.json({ result: 'error', message: existingField.error }, { status: 500 });
      finalKey = (existingField && existingField[0] && existingField[0].key) || key;
    }

    const rowData = {
      key: finalKey, label,
      category: category || 'earning',
      calc_mode: calc_mode || 'fixed',
      calc_base_field_key: calc_base_field_key || null,
      increment_mode: increment_mode || null,
      increment_value: increment_value === '' || increment_value == null ? null : Number(increment_value),
      is_grade_conditional: !!is_grade_conditional,
      is_role_conditional: !!is_role_conditional,
      is_category_conditional: !!is_category_conditional,
      is_active: is_active !== false,
      sort_order: sort_order == null ? 0 : Number(sort_order),
    };
    const saved = id
      ? await sbPayroll(`fields?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('fields', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;

    if (!id) {
      const colResult = await sbPayroll('rpc/add_field_column', 'POST', { col_name: finalKey });
      if (colResult?.error) {
        _prAudit(user_id, 'save_field', 'fields', savedRow?.id, rowData);
        return NextResponse.json({ result: 'error', message: `Field saved, but couldn't add its value column: ${colResult.error}. Make sure payroll_schema_v7.sql has been run in Supabase.` }, { status: 500 });
      }
    }
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
    const [applicableRoles, rules, applicableCategories] = await Promise.all([
      sbPayroll(`field_applicable_roles?field_id=eq.${encodeURIComponent(field_id)}&select=*`),
      sbPayroll(`field_condition_rules?field_id=eq.${encodeURIComponent(field_id)}&select=*&order=priority.asc`),
      sbPayroll(`field_applicable_categories?field_id=eq.${encodeURIComponent(field_id)}&select=*`),
    ]);
    if (applicableRoles?.error) return NextResponse.json({ result: 'error', message: applicableRoles.error }, { status: 500 });
    if (rules?.error) return NextResponse.json({ result: 'error', message: rules.error }, { status: 500 });
    if (applicableCategories?.error) return NextResponse.json({ result: 'error', message: applicableCategories.error }, { status: 500 });
    return NextResponse.json({ result: 'success', applicable_roles: applicableRoles, condition_rules: rules, applicable_categories: applicableCategories });
  }

  // Advanced Logic (nested if/else + multi-field arithmetic) — replaces
  // condition_rules/calc_mode entirely for this field when set. Stored as
  // one JSONB tree rather than rows, since it's arbitrarily nested; see
  // _evalLogicNode for the shape and evaluation. logic_tree already comes
  // back on every `fields` row (get_fields does select=*), so there's no
  // separate get action — only save/clear.
  if (action === 'save_field_logic_tree') {
    const { field_id, logic_tree } = payload;
    if (!field_id) return NextResponse.json({ result: 'error', message: 'field_id required' }, { status: 400 });
    const saved = await sbPayroll(`fields?id=eq.${encodeURIComponent(field_id)}`, 'PATCH', { logic_tree: logic_tree || null });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_field_logic_tree', 'fields', field_id, { logic_tree });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'clear_field_logic_tree') {
    const { field_id } = payload;
    if (!field_id) return NextResponse.json({ result: 'error', message: 'field_id required' }, { status: 400 });
    const saved = await sbPayroll(`fields?id=eq.${encodeURIComponent(field_id)}`, 'PATCH', { logic_tree: null });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'clear_field_logic_tree', 'fields', field_id);
    return NextResponse.json({ result: 'success' });
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

  if (action === 'toggle_field_applicable_category') {
    const { field_id, category: cat, enabled } = payload;
    if (!field_id || !cat) return NextResponse.json({ result: 'error', message: 'field_id and category required' }, { status: 400 });
    if (enabled) {
      const saved = await sbPayroll('field_applicable_categories', 'POST', { field_id, category: cat });
      if (saved?.error && !String(saved.error).includes('duplicate')) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    } else {
      const del = await sbPayroll(`field_applicable_categories?field_id=eq.${encodeURIComponent(field_id)}&category=eq.${encodeURIComponent(cat)}`, 'DELETE');
      if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    }
    _prAudit(user_id, 'toggle_field_applicable_category', 'field_applicable_categories', `${field_id}:${cat}`, { enabled });
    return NextResponse.json({ result: 'success' });
  }

  // Distinct category values currently in use across staff, for the
  // Conditions panel's category checklist — same source as the People
  // tab's "Add People" category filter (users_profile.category).
  if (action === 'get_staff_categories') {
    const rows = await _teacherSchemaFetch('users_profile?select=category');
    if (!Array.isArray(rows)) return NextResponse.json({ result: 'success', categories: [] });
    const categories = [...new Set(rows.map(r => (r.category || '').trim()).filter(Boolean))].sort();
    return NextResponse.json({ result: 'success', categories });
  }

  // Login email per user_id — allStaffCache (getAllStaffData) doesn't carry
  // this, so Export's "Sort By Email" option needs its own small fetch.
  if (action === 'get_staff_emails') {
    const rows = await _teacherSchemaFetch('app_users?select=user_id,email');
    return NextResponse.json({ result: 'success', emails: Array.isArray(rows) ? rows : [] });
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

  // Unfiltered (every grade, not just one) — feeds the Fields tab's hover
  // summary, which cross-references a field against how every grade has
  // it configured, rather than each grade's own detail screen fetching
  // this one grade at a time.
  if (action === 'get_all_grade_fields') {
    const rows = await sbPayroll('grade_fields?select=*');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', grade_fields: rows });
  }

  if (action === 'save_grade') {
    const { id, name, description, sort_order, pay_system } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name is required' }, { status: 400 });
    const rowData = { name, description: description || null, sort_order: sort_order == null ? 0 : Number(sort_order) };
    // pay_system is set once at creation (defaults to 'regular') and left out
    // of an edit's PATCH unless explicitly resent, so editing a grade's name
    // never silently flips it back to 'regular'.
    if (!id) rowData.pay_system = pay_system === 'contractual' ? 'contractual' : 'regular';
    else if (pay_system) rowData.pay_system = pay_system === 'contractual' ? 'contractual' : 'regular';
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
    const { grade_id, field_id, value, percent, base_field_key, base_step_id } = payload;
    if (!grade_id || !field_id) return NextResponse.json({ result: 'error', message: 'grade_id and field_id required' }, { status: 400 });
    // A field is fixed-amount or percent-of-field by its own calc_mode, never
    // both — _resolveFieldConfig only ever reads one side depending on that,
    // so force the other side to null server-side too (not just in the
    // admin UI) so no caller (bulk import, a direct API call) can persist a
    // row with both set, which would silently strand the ignored one.
    const [fieldRows, gradeRows] = await Promise.all([
      sbPayroll(`fields?id=eq.${encodeURIComponent(field_id)}&select=calc_mode`),
      sbPayroll(`grades?id=eq.${encodeURIComponent(grade_id)}&select=pay_system`),
    ]);
    // Contractual grades are fixed-only — every field is entered as its own
    // flat amount, with no percent-of-another-field linkage at all — so a
    // contractual grade forces isPercent off server-side regardless of what
    // the field's own calc_mode says, the same defense-in-depth as below.
    const isContractual = Array.isArray(gradeRows) && gradeRows[0] && gradeRows[0].pay_system === 'contractual';
    const isPercent = !isContractual && Array.isArray(fieldRows) && fieldRows[0] && fieldRows[0].calc_mode === 'percent_of_field';
    const rowData = {
      grade_id, field_id,
      value: isPercent || value === '' || value == null ? null : Number(value),
      percent: !isPercent || percent === '' || percent == null ? null : Number(percent),
      base_field_key: base_field_key || null,
      // Only meaningful alongside a percent value — a fixed step to compute
      // the percent's base from instead of the person's own resolved value.
      base_step_id: isPercent && base_step_id ? Number(base_step_id) : null,
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

  // ── Pay Scale Grid (Grade x Step -> fixed Basic) ──
  // Steps are columns shared across every grade row — "Add Step" appends
  // one globally, "Add Grade" (existing action above) appends a row. Each
  // cell is optional (a grade need not fill every step) so the grid can
  // grow in either direction without every combination needing a value.
  if (action === 'get_pay_steps') {
    const rows = await sbPayroll('pay_steps?select=*&order=sort_order.asc,step_number.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', steps: rows });
  }

  if (action === 'save_pay_step') {
    const { id, step_number, sort_order } = payload;
    const n = Number(step_number);
    // Step numbering starts at 0 (Step 0 is a real, valid step) — 0 is
    // falsy, so this must check for missing/blank explicitly rather than
    // with a bare !step_number, which would wrongly reject it.
    if (step_number === '' || step_number == null || Number.isNaN(n)) return NextResponse.json({ result: 'error', message: 'Step number is required' }, { status: 400 });
    const rowData = { step_number: n, sort_order: sort_order == null ? n : Number(sort_order) };
    const saved = id
      ? await sbPayroll(`pay_steps?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('pay_steps', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_pay_step', 'pay_steps', id || null, rowData);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'delete_pay_step') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`pay_steps?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_pay_step', 'pay_steps', id, null);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_grade_step_matrix') {
    const cells = await sbPayroll('grade_step_values?select=*');
    if (cells?.error) return NextResponse.json({ result: 'error', message: cells.error }, { status: 500 });
    return NextResponse.json({ result: 'success', cells });
  }

  if (action === 'save_grade_step_value') {
    const { grade_id, step_id, basic_value } = payload;
    if (!grade_id || !step_id) return NextResponse.json({ result: 'error', message: 'grade_id and step_id required' }, { status: 400 });
    const rowData = { grade_id, step_id, basic_value: basic_value === '' || basic_value == null ? null : Number(basic_value) };
    const existing = await sbPayroll(`grade_step_values?grade_id=eq.${encodeURIComponent(grade_id)}&step_id=eq.${encodeURIComponent(step_id)}&select=grade_id`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`grade_step_values?grade_id=eq.${encodeURIComponent(grade_id)}&step_id=eq.${encodeURIComponent(step_id)}`, 'PATCH', rowData)
      : await sbPayroll('grade_step_values', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_grade_step_value', 'grade_step_values', `${grade_id}:${step_id}`, rowData);
    return NextResponse.json({ result: 'success' });
  }

  // ── People (grade assignment + per-person field overrides) ──
  if (action === 'get_people_setup') {
    const rows = await sbPayroll('person_setup?select=*&order=created_at.desc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', people: rows });
  }

  // Unfiltered (every person's history, not just one) — the roster embeds
  // joining date + every later promotion date inline per row, so it needs
  // the whole table up front rather than one fetch per person.
  if (action === 'get_grade_history') {
    const rows = await sbPayroll('person_grade_history?select=*&order=effective_date.asc,created_at.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', history: rows });
  }

  // Pure history-log insert — no person_setup write, no Basic push. For
  // backfilling REAL historical dates (e.g. parsed from a source sheet's own
  // join/promotion column) as a one-off import, as distinct from
  // save_person_grade_step's combined "change it now and log it" behavior.
  // grade_id/step_id may be null for a date whose resulting grade isn't
  // independently known — the row still records that *something* happened
  // on that date rather than silently dropping it.
  if (action === 'add_grade_history_row') {
    const { user_id: personId, grade_id, step_id, pay_type, effective_date, note } = payload;
    if (!personId || !effective_date) return NextResponse.json({ result: 'error', message: 'user_id and effective_date required' }, { status: 400 });
    const rowData = {
      user_id: personId, grade_id: grade_id || null, step_id: step_id || null,
      pay_type: pay_type === 'contractual' ? 'contractual' : 'regular',
      effective_date, note: note || null, created_by: user_id || null,
    };
    const saved = await sbPayroll('person_grade_history', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'add_grade_history_row', 'person_grade_history', personId, rowData);
    return NextResponse.json({ result: 'success', id: Array.isArray(saved) && saved[0] ? saved[0].id : null });
  }

  // Narrow — only ever touches joining_date, for the same backfill reason
  // as add_grade_history_row: correcting/populating a real historical fact
  // without risking the full save_person_setup upsert clobbering grade/
  // step/bank info it wasn't given.
  if (action === 'set_joining_date') {
    const { user_id: personId, joining_date } = payload;
    if (!personId || !joining_date) return NextResponse.json({ result: 'error', message: 'user_id and joining_date required' }, { status: 400 });
    const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}&select=user_id`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', { joining_date })
      : await sbPayroll('person_setup', 'POST', { user_id: personId, joining_date });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'set_joining_date', 'person_setup', personId, { joining_date });
    return NextResponse.json({ result: 'success' });
  }

  // Narrow — only ever touches mpo_amount, for the dedicated MPO screen's
  // per-row inline edit and its focused Excel import. mpo_amount is a pure
  // accounting split (how much of this person's Gross the government's
  // Monthly Pay Order covers vs. the institution) that changes every year
  // independent of anything else about the person, so it gets its own
  // narrow save the same way joining_date does — never risking any other
  // person_setup column via a broader upsert.
  if (action === 'get_mpo_lock') {
    const rows = await sbPayroll('mpo_lock?id=eq.1&select=*');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', lock: (rows && rows[0]) || { is_locked: false } });
  }

  if (action === 'lock_mpo') {
    const saved = await sbPayroll('mpo_lock?id=eq.1', 'PATCH', { is_locked: true, locked_by: user_id, locked_at: new Date().toISOString() });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'lock_mpo', 'mpo_lock', 1, {});
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'unlock_mpo') {
    if (!(await _isSuperAdmin(user_id))) return NextResponse.json({ result: 'error', message: 'Only the Super Admin can unlock MPO amounts.' }, { status: 403 });
    const saved = await sbPayroll('mpo_lock?id=eq.1', 'PATCH', { is_locked: false, locked_by: null, locked_at: null });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'unlock_mpo', 'mpo_lock', 1, {});
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'set_mpo_amount') {
    if (await _isMpoLocked()) return NextResponse.json({ result: 'error', message: 'MPO amounts are locked. Ask the Super Admin to unlock them first.' }, { status: 400 });
    const { user_id: personId, mpo_amount } = payload;
    if (!personId) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const rowData = { mpo_amount: mpo_amount === '' || mpo_amount == null ? null : Number(mpo_amount) };
    const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}&select=user_id`);
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', rowData)
      : await sbPayroll('person_setup', 'POST', { user_id: personId, ...rowData });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'set_mpo_amount', 'person_setup', personId, rowData);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'save_person_setup') {
    const { user_id: personId, grade_id, step_id, pay_type, effective_date, joining_date, is_active, bank_name, bank_account_no, mobile_banking_provider, mobile_banking_number, mpo_amount } = payload;
    if (!personId) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const normPayType = pay_type === 'contractual' ? 'contractual' : 'regular';
    const rowData = {
      user_id: personId,
      grade_id: grade_id || null,
      step_id: step_id || null,
      pay_type: normPayType,
      joining_date: joining_date || null,
      is_active: is_active !== false,
      bank_name: bank_name || null,
      bank_account_no: bank_account_no || null,
      mobile_banking_provider: mobile_banking_provider || null,
      mobile_banking_number: mobile_banking_number || null,
      mpo_amount: mpo_amount === '' || mpo_amount == null ? null : Number(mpo_amount),
    };
    const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`);
    const prior = !existing?.error && existing[0];
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', rowData)
      : await sbPayroll('person_setup', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });

    // Log a promotion-history row only when the grade/step/pay type actually
    // changed — so the People Setup roster can show every past promotion
    // date, not just today's, without one row per unrelated field edit
    // (bank info, joining date, etc.) cluttering the timeline.
    if (grade_id && (!prior || prior.grade_id !== grade_id || prior.step_id !== step_id || prior.pay_type !== normPayType)) {
      const histRow = {
        user_id: personId, grade_id, step_id: step_id || null, pay_type: normPayType,
        effective_date: effective_date || new Date().toISOString().slice(0, 10),
        created_by: user_id || null,
      };
      const histSaved = await sbPayroll('person_grade_history', 'POST', histRow);
      if (!(histSaved && histSaved.error)) _prAudit(user_id, 'save_grade_history', 'person_grade_history', personId, histRow);
    }

    // Grade+Step together determine Basic — when both are set and the grid
    // has a value for that cell, push it straight into the existing
    // per-person override (person_field_values.basic), which already
    // outranks the grade's flat default and the Basic field's
    // yearly-increment formula (see _resolveFieldValue). Deliberately never
    // clears an existing override on its own — if step_id is blank/removed,
    // whatever Basic value is already saved for this person is left alone;
    // clearing it is a separate, explicit action via the Values screen.
    if (grade_id && step_id) {
      const cellRows = await sbPayroll(`grade_step_values?grade_id=eq.${encodeURIComponent(grade_id)}&step_id=eq.${encodeURIComponent(step_id)}&select=basic_value`);
      const basicValue = Array.isArray(cellRows) && cellRows[0] && cellRows[0].basic_value != null ? Number(cellRows[0].basic_value) : null;
      if (basicValue != null) {
        const pfvExisting = await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}&select=user_id`);
        const pfvRow = { user_id: personId, basic: basicValue };
        const pfvSaved = (!pfvExisting?.error && pfvExisting.length)
          ? await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', pfvRow)
          : await sbPayroll('person_field_values', 'POST', pfvRow);
        if (!(pfvSaved && pfvSaved.error)) _prAudit(user_id, 'save_field_value', 'person_field_values', `${personId}:basic`, pfvRow);
      }
    }

    _prAudit(user_id, 'save_person_setup', 'person_setup', personId, rowData);
    return NextResponse.json({ result: 'success', person: Array.isArray(saved) ? saved[0] : saved });
  }

  // "Abandon from Payroll" / "Reactivate" — the payroll-scoped counterpart
  // to HR's own (destructive) Delete User. Touches ONLY is_active, so
  // grade/step/bank info/field overrides/history all survive untouched and
  // this is fully reversible; run_payroll already only ever looks at
  // is_active=true rows, so an abandoned person simply stops being paid
  // starting the next run — nothing about their account, login, or
  // teacher_staff profile is affected, which is the whole point of doing
  // this here instead of in HR's user list.
  if (action === 'set_person_active') {
    const { user_id: personId, is_active } = payload;
    if (!personId) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}&select=user_id`);
    if (!existing?.error && !existing.length) return NextResponse.json({ result: 'error', message: 'This person has no payroll setup yet' }, { status: 400 });
    const saved = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', { is_active: is_active !== false });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, is_active !== false ? 'reactivate_person' : 'abandon_person', 'person_setup', personId, { is_active: is_active !== false });
    return NextResponse.json({ result: 'success' });
  }

  // Narrow inline-edit path for the People Setup roster table's Grade/Step
  // selects — touches ONLY grade_id/step_id (+ the resulting Basic push),
  // never the rest of person_setup, unlike save_person_setup's full-row
  // upsert which would null out bank info/joining date/etc. if called with
  // just these two fields.
  if (action === 'save_person_grade_step') {
    const { user_id: personId, grade_id, step_id, pay_type, effective_date, skip_history } = payload;
    if (!personId) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const rowData = { grade_id: grade_id || null, step_id: step_id || null };
    // pay_type is only touched when the caller actually sends it (the
    // roster's Pay Type pill does; a plain grade/step edit doesn't) — this
    // stays the narrow, single-purpose save the comment above promises.
    if (pay_type) rowData.pay_type = pay_type === 'contractual' ? 'contractual' : 'regular';
    // select=user_id,grade_id,step_id only — NOT pay_type. Before the
    // Contractual-system migration is run, pay_type doesn't exist as a
    // column yet; asking for it here would make this whole select fail
    // (existing?.error truthy), which previously fell through to the POST
    // branch below and hit a duplicate-key error for every row that
    // already existed. pay_type is only ever read from `prior` for the
    // history-change comparison further down, which safely treats a
    // missing/undefined value as "no prior pay_type" either way.
    const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}&select=user_id,grade_id,step_id`);
    const prior = !existing?.error && existing[0];
    const saved = (!existing?.error && existing.length)
      ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', rowData)
      : await sbPayroll('person_setup', 'POST', { user_id: personId, ...rowData });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });

    // history_id is returned so a caller that knows it made a mistake (the
    // People Setup bulk "Upgrade to Next Step" tool's Undo) can delete
    // exactly the row it just created, rather than leaving an up-then-down
    // blip in the timeline. skip_history lets that same Undo revert the
    // grade/step here without logging the revert itself as a promotion.
    let historyId = null;
    if (!skip_history && grade_id && (!prior || prior.grade_id !== grade_id || prior.step_id !== step_id || (pay_type && prior.pay_type !== rowData.pay_type))) {
      const histRow = {
        user_id: personId, grade_id, step_id: step_id || null,
        pay_type: rowData.pay_type || (prior && prior.pay_type) || 'regular',
        effective_date: effective_date || new Date().toISOString().slice(0, 10),
        created_by: user_id || null,
      };
      const histSaved = await sbPayroll('person_grade_history', 'POST', histRow);
      if (!(histSaved && histSaved.error)) {
        historyId = Array.isArray(histSaved) && histSaved[0] ? histSaved[0].id : null;
        _prAudit(user_id, 'save_grade_history', 'person_grade_history', personId, histRow);
      }
    }

    if (grade_id && step_id) {
      const cellRows = await sbPayroll(`grade_step_values?grade_id=eq.${encodeURIComponent(grade_id)}&step_id=eq.${encodeURIComponent(step_id)}&select=basic_value`);
      const basicValue = Array.isArray(cellRows) && cellRows[0] && cellRows[0].basic_value != null ? Number(cellRows[0].basic_value) : null;
      if (basicValue != null) {
        const pfvExisting = await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}&select=user_id`);
        const pfvRow = { user_id: personId, basic: basicValue };
        const pfvSaved = (!pfvExisting?.error && pfvExisting.length)
          ? await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', pfvRow)
          : await sbPayroll('person_field_values', 'POST', pfvRow);
        if (!(pfvSaved && pfvSaved.error)) _prAudit(user_id, 'save_field_value', 'person_field_values', `${personId}:basic`, pfvRow);
      }
    }

    _prAudit(user_id, 'save_person_grade_step', 'person_setup', personId, rowData);
    return NextResponse.json({ result: 'success', history_id: historyId });
  }

  // Deletes specific promotion-history rows by id — used only by the bulk
  // "Upgrade to Next Step" tool's Undo, to remove exactly the rows a
  // mistaken upgrade just created rather than leaving a spurious
  // up-then-reverted entry in everyone's timeline.
  if (action === 'delete_grade_history') {
    const { ids } = payload;
    if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ result: 'error', message: 'ids required' }, { status: 400 });
    const del = await sbPayroll(`person_grade_history?id=in.(${ids.map(id => encodeURIComponent(id)).join(',')})`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_grade_history', 'person_grade_history', null, { ids });
    return NextResponse.json({ result: 'success' });
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

  // Creates a brand-new person from scratch — Full Name, Designation, Grade
  // (Regular/Contractual + grade/step), Joining Date — for support staff who
  // don't exist in the system at all yet. `users_profile.teacher_id` is a
  // foreign key into `app_users` (login table), so a profile can't exist
  // without a login row; a synthetic id/email is generated to satisfy that
  // constraint, with the same default password ('1234') the HR "Add
  // Teacher/Staff" form pre-fills, and role 'Staff' (no elevated access).
  if (action === 'create_payroll_person') {
    const { full_name, designation, department, pay_type, grade_id, step_id, joining_date } = payload;
    if (!full_name || !full_name.trim()) return NextResponse.json({ result: 'error', message: 'Full name is required' }, { status: 400 });
    if (!designation || !designation.trim()) return NextResponse.json({ result: 'error', message: 'Designation is required' }, { status: 400 });
    if (!joining_date) return NextResponse.json({ result: 'error', message: 'Joining date is required' }, { status: 400 });
    const normPayType = pay_type === 'contractual' ? 'contractual' : 'regular';

    // Synthetic id, prefixed '9' so it's visibly distinct from the org's own
    // hand-assigned teacher_id numbering (which never starts with 9) —
    // retried on the astronomically unlikely chance of a collision.
    let teacherId = null;
    for (let i = 0; i < 5 && !teacherId; i++) {
      const candidate = '9' + String(Math.floor(10000000 + Math.random() * 90000000));
      const clash = await _teacherSchemaFetch(`app_users?user_id=eq.${encodeURIComponent(candidate)}&select=user_id`);
      if (Array.isArray(clash) && !clash.length) teacherId = candidate;
    }
    if (!teacherId) return NextResponse.json({ result: 'error', message: 'Could not generate a unique id, try again' }, { status: 500 });

    const email = `person.${teacherId}@payroll.local`;
    // Same default the HR "Add Teacher/Staff" form pre-fills for a new
    // account — a known, communicable password rather than an unshared
    // random one, since this person (or whoever tells them their login)
    // needs to actually be able to give it to them.
    const password = '1234';

    const userRow = { user_id: teacherId, email, password, role: 'Staff' };
    const savedUser = await _teacherSchemaWrite('app_users', 'POST', userRow);
    if (savedUser?.error) return NextResponse.json({ result: 'error', message: savedUser.error }, { status: 500 });

    const profileRow = {
      teacher_id: teacherId, email, full_name: full_name.trim(), category: 'Staff',
      department: department || null, designation: designation.trim(), joining_date,
    };
    const savedProfile = await _teacherSchemaWrite('users_profile', 'POST', profileRow);
    if (savedProfile?.error) {
      // Roll back the login row so a failed profile insert doesn't leave an
      // orphan account behind.
      await _teacherSchemaWrite(`app_users?user_id=eq.${encodeURIComponent(teacherId)}`, 'DELETE', {});
      return NextResponse.json({ result: 'error', message: savedProfile.error }, { status: 500 });
    }

    const personRow = {
      user_id: teacherId, grade_id: grade_id || null, step_id: step_id || null,
      pay_type: normPayType, joining_date, is_active: true,
    };
    const savedPerson = await sbPayroll('person_setup', 'POST', personRow);
    if (savedPerson?.error) {
      // Roll back both the login row and the profile row so a failed
      // person_setup insert (e.g. schema not yet migrated) never leaves an
      // orphan login account with no payroll record behind.
      await _teacherSchemaWrite(`users_profile?teacher_id=eq.${encodeURIComponent(teacherId)}`, 'DELETE', {});
      await _teacherSchemaWrite(`app_users?user_id=eq.${encodeURIComponent(teacherId)}`, 'DELETE', {});
      return NextResponse.json({ result: 'error', message: savedPerson.error }, { status: 500 });
    }

    if (grade_id) {
      const histRow = { user_id: teacherId, grade_id, step_id: step_id || null, pay_type: normPayType, effective_date: joining_date, created_by: user_id || null };
      const histSaved = await sbPayroll('person_grade_history', 'POST', histRow);
      if (!(histSaved && histSaved.error)) _prAudit(user_id, 'save_grade_history', 'person_grade_history', teacherId, histRow);
    }

    if (grade_id && step_id) {
      const cellRows = await sbPayroll(`grade_step_values?grade_id=eq.${encodeURIComponent(grade_id)}&step_id=eq.${encodeURIComponent(step_id)}&select=basic_value`);
      const basicValue = Array.isArray(cellRows) && cellRows[0] && cellRows[0].basic_value != null ? Number(cellRows[0].basic_value) : null;
      if (basicValue != null) {
        const pfvRow = { user_id: teacherId, basic: basicValue };
        const pfvSaved = await sbPayroll('person_field_values', 'POST', pfvRow);
        if (!(pfvSaved && pfvSaved.error)) _prAudit(user_id, 'save_field_value', 'person_field_values', `${teacherId}:basic`, pfvRow);
      }
    }

    _prAudit(user_id, 'create_payroll_person', 'users_profile', teacherId, { full_name, designation, pay_type: normPayType });
    return NextResponse.json({ result: 'success', user_id: teacherId, full_name: full_name.trim() });
  }

  // ── Export row order (global, persistent — see payroll.export_row_order) ──
  if (action === 'get_export_row_order') {
    const rows = await sbPayroll('export_row_order?select=user_id,position');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', order: rows });
  }

  if (action === 'set_export_row_order') {
    const { user_id: rowUserId, position } = payload;
    if (!rowUserId || position == null) return NextResponse.json({ result: 'error', message: 'user_id and position required' }, { status: 400 });
    const rowData = { user_id: rowUserId, position: Number(position), updated_at: new Date().toISOString() };
    const existing = await sbPayroll(`export_row_order?user_id=eq.${encodeURIComponent(rowUserId)}&select=user_id`);
    if (existing?.error) return NextResponse.json({ result: 'error', message: existing.error }, { status: 500 });
    const saved = existing.length
      ? await sbPayroll(`export_row_order?user_id=eq.${encodeURIComponent(rowUserId)}`, 'PATCH', rowData)
      : await sbPayroll('export_row_order', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'clear_export_row_order') {
    const del = await sbPayroll('export_row_order?user_id=neq.__none__', 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'clear_export_row_order', 'export_row_order', null);
    return NextResponse.json({ result: 'success' });
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

  // NOTE: the Statutory Items admin UI (get_statutory_items/
  // save_statutory_item/delete_statutory_item) was removed here — the
  // user decided to keep PF as two plain fields (PF 10% addition, PF 20%
  // deduction) instead of the employee/employer-match model this fed.
  // _computePayslipForPerson still folds in payroll.statutory_items rows
  // if any ever exist (harmless no-op with the table empty); the table
  // itself was left in place, not dropped.

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

  // Edits an EXISTING bonus payment only — plain label/amount/month/year/
  // note correction, same shape regardless of how it was originally
  // created. See add_bulk_bonus for creating new ones (one person or all,
  // fixed or percent-of-field) — that richer flow only makes sense once,
  // at creation; editing stays this simple on purpose.
  if (action === 'save_bonus_payment') {
    const { id, user_id: personId, label, amount, month, year, status, note } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    if (!personId || !label || !amount || !month || !year) return NextResponse.json({ result: 'error', message: 'Person, label, amount, month and year are required' }, { status: 400 });
    const rowData = { user_id: personId, label, amount: Number(amount), month: Number(month), year: Number(year), status: status || 'pending', note: note || null };
    const saved = await sbPayroll(`bonus_payments?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_bonus_payment', 'bonus_payments', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', payment: savedRow });
  }

  // Creates one or more new bonus payments in one go — the three choices
  // behind "Add Bonus": who it applies to (scope: 'one' picks a single
  // person via user_id, 'all' applies to every active person in Payroll),
  // how the amount is decided (amount_mode: 'fixed' is a flat Taka figure
  // same for everyone in scope, 'percent' resolves each targeted person's
  // OWN value of base_field_key for this exact month/year through the same
  // engine a real payroll run uses, then takes `percent` of it — computed
  // once now and stored as a plain amount, not a live formula), and where
  // it shows up (merge_field_key null = the generic Bonus column, set =
  // folds into that field's own value instead — see
  // _computePayslipForPerson).
  if (action === 'add_bulk_bonus') {
    const { scope, user_id: personId, label, month, year, note, merge_field_key } = payload;
    const amount_mode = payload.amount_mode === 'percent' ? 'percent' : 'fixed';
    if (!label || !month || !year) return NextResponse.json({ result: 'error', message: 'Label, month and year are required' }, { status: 400 });
    if (scope === 'one' && !personId) return NextResponse.json({ result: 'error', message: 'Person is required' }, { status: 400 });
    if (amount_mode === 'percent' && (!payload.base_field_key || !payload.percent)) {
      return NextResponse.json({ result: 'error', message: 'Pick a field and a percentage' }, { status: 400 });
    }
    if (amount_mode === 'fixed' && !payload.amount) {
      return NextResponse.json({ result: 'error', message: 'Amount is required' }, { status: 400 });
    }

    let targetIds;
    if (scope === 'all') {
      const peopleRows = await sbPayroll('person_setup?is_active=eq.true&select=user_id');
      if (peopleRows?.error) return NextResponse.json({ result: 'error', message: peopleRows.error }, { status: 500 });
      targetIds = (peopleRows || []).map(p => p.user_id);
    } else {
      targetIds = [personId];
    }
    if (!targetIds.length) return NextResponse.json({ result: 'error', message: 'No one to apply this to' }, { status: 400 });

    const amountByUser = {};
    if (amount_mode === 'percent') {
      const idList = targetIds.map(id => encodeURIComponent(id)).join(',');
      const peopleRows = await sbPayroll(`person_setup?user_id=in.(${idList})&select=*`);
      if (peopleRows?.error) return NextResponse.json({ result: 'error', message: peopleRows.error }, { status: 500 });
      const people = peopleRows || [];
      const [roles, categories, ref] = await Promise.all([
        _rolesForUsers(people.map(p => p.user_id)),
        _categoriesForUsers(people.map(p => p.user_id)),
        _loadPayrollRef(people.map(p => p.user_id), month, year),
      ]);
      people.forEach(p => {
        const slip = _computePayslipForPerson(p, roles[p.user_id] || [], categories[p.user_id] || '', ref, Number(month), Number(year));
        const baseVal = Number(slip.field_values[payload.base_field_key]) || 0;
        amountByUser[p.user_id] = Math.round(baseVal * (Number(payload.percent) / 100) * 100) / 100;
      });
    } else {
      targetIds.forEach(id => { amountByUser[id] = Number(payload.amount); });
    }

    const rowsToInsert = targetIds.filter(id => amountByUser[id] != null).map(id => ({
      user_id: id, label, amount: amountByUser[id], month: Number(month), year: Number(year),
      status: 'pending', note: note || null, amount_mode,
      base_field_key: amount_mode === 'percent' ? payload.base_field_key : null,
      percent: amount_mode === 'percent' ? Number(payload.percent) : null,
      merge_field_key: merge_field_key || null,
    }));
    if (!rowsToInsert.length) return NextResponse.json({ result: 'error', message: 'Nothing to create' }, { status: 400 });
    const saved = await sbPayroll('bonus_payments', 'POST', rowsToInsert);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'add_bulk_bonus', 'bonus_payments', null, { scope, label, month, year, count: rowsToInsert.length });
    return NextResponse.json({ result: 'success', count: Array.isArray(saved) ? saved.length : rowsToInsert.length });
  }

  if (action === 'delete_bonus_payment') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`bonus_payments?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_bonus_payment', 'bonus_payments', id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Manual run lock — independent of runs.status. A locked run rejects
  // every mutation below (recompute/submit/approve/revert/delete) for
  // anyone; only a Super Admin can unlock it again. Locking itself is a
  // regular Payroll Admin action ("manual, not automatic" per the user) —
  // it never happens as a side effect of anything else. ──
  if (action === 'lock_run') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const saved = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`, 'PATCH', { is_locked: true, locked_by: user_id, locked_at: new Date().toISOString() });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'lock_run', 'runs', run_id);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'unlock_run') {
    if (!(await _isSuperAdmin(user_id))) return NextResponse.json({ result: 'error', message: 'Only the Super Admin can unlock a run.' }, { status: 403 });
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const saved = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`, 'PATCH', { is_locked: false, locked_by: null, locked_at: null });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'unlock_run', 'runs', run_id);
    return NextResponse.json({ result: 'success' });
  }

  // ── Run approval workflow (on top of runs.status: draft → pending_approval → finalized) ──
  if (action === 'submit_run_for_approval') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const lockCheck = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}&select=is_locked`);
    if (!lockCheck?.error && lockCheck[0]?.is_locked) return NextResponse.json({ result: 'error', message: 'This run is locked.' }, { status: 400 });
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
    if (runRow.is_locked) return NextResponse.json({ result: 'error', message: 'This run is locked.' }, { status: 400 });
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
          // A 'recurring' entry (mode='recurring', total_amount left null)
          // has no balance to pay off — it stays active indefinitely until
          // manually cancelled, so finalizing a run must never touch it.
          if (entry.total_amount == null) continue;
          const newRemaining = Math.max(0, Number(entry.remaining_amount) - Number(sectionAmounts[entryId]));
          await sbPayroll(`section_entries?id=eq.${encodeURIComponent(entryId)}`, 'PATCH', {
            remaining_amount: newRemaining,
            status: newRemaining <= 0 ? 'completed' : 'active',
            paid_installments: (Number(entry.paid_installments) || 0) + 1,
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

  // Puts a wrongly-finalized (or wrongly-submitted) run back to draft so it
  // can be corrected and recomputed. For a finalized run this also reverses
  // exactly what approve_run applied — adds each loan/EMI entry's deducted
  // amount back onto remaining_amount (re-opening it if it had completed),
  // and puts any bonus payments this run marked paid back to pending —
  // rather than just flipping the status and leaving those side effects in
  // place.
  if (action === 'revert_run_to_draft') {
    const { run_id } = payload;
    if (!run_id) return NextResponse.json({ result: 'error', message: 'run_id required' }, { status: 400 });
    const runRows = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`);
    const runRow = (!runRows?.error && runRows[0]) || null;
    if (!runRow) return NextResponse.json({ result: 'error', message: 'Run not found' }, { status: 404 });
    if (runRow.is_locked) return NextResponse.json({ result: 'error', message: 'This run is locked.' }, { status: 400 });
    if (runRow.status === 'draft') return NextResponse.json({ result: 'error', message: 'Already a draft' }, { status: 400 });

    if (runRow.status === 'finalized') {
      const slips = await sbPayroll(`payslips?run_id=eq.${encodeURIComponent(run_id)}&select=*`);
      if (!slips?.error && Array.isArray(slips)) {
        for (const slip of slips) {
          const sectionAmounts = slip.section_amounts || {};
          for (const entryId of Object.keys(sectionAmounts)) {
            const entryRows = await sbPayroll(`section_entries?id=eq.${encodeURIComponent(entryId)}`);
            const entry = (!entryRows?.error && entryRows[0]) || null;
            if (!entry) continue;
            if (entry.total_amount == null) continue; // recurring entry — see the matching guard in approve_run
            const restoredRemaining = Number(entry.remaining_amount) + Number(sectionAmounts[entryId]);
            await sbPayroll(`section_entries?id=eq.${encodeURIComponent(entryId)}`, 'PATCH', {
              remaining_amount: restoredRemaining,
              status: 'active',
              paid_installments: Math.max(0, (Number(entry.paid_installments) || 0) - 1),
            });
          }
        }
        const userIds = slips.map(s => s.user_id);
        if (userIds.length) {
          const bonusRows = await sbPayroll(`bonus_payments?status=eq.paid&month=eq.${encodeURIComponent(runRow.month)}&year=eq.${encodeURIComponent(runRow.year)}&select=id,user_id`);
          const toRevert = (!bonusRows?.error ? bonusRows : []).filter(b => userIds.includes(b.user_id));
          for (const b of toRevert) await sbPayroll(`bonus_payments?id=eq.${encodeURIComponent(b.id)}`, 'PATCH', { status: 'pending' });
        }
      }
    }

    const saved = await sbPayroll(`runs?id=eq.${encodeURIComponent(run_id)}`, 'PATCH', {
      status: 'draft', approved_by: null, approved_at: null, submitted_by: null, submitted_at: null,
    });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'revert_run_to_draft', 'runs', run_id, { was_status: runRow.status });
    return NextResponse.json({ result: 'success' });
  }

  // Approved leave requests overlapping the given month/year — pulled from
  // the existing teacher_staff.leave_requests table (the real staff leave
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

  // ── Staff-child bus fare entries (child_count x stoppage fare, recurring) ──
  if (action === 'get_bus_stoppages_for_payroll') {
    const rows = await _studentSchemaFetch('bus_stoppages?is_active=eq.true&select=*&order=name.asc');
    return NextResponse.json({ result: 'success', stoppages: Array.isArray(rows) ? rows : [] });
  }

  if (action === 'get_bus_fare_entries') {
    const rows = await sbPayroll('bus_fare_entries?select=*&order=created_at.desc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', entries: rows });
  }

  if (action === 'save_bus_fare_entry') {
    const { id, user_id: personId, stoppage_id, trip_type, child_count } = payload;
    if (!personId || !stoppage_id) return NextResponse.json({ result: 'error', message: 'Person and stoppage are required' }, { status: 400 });
    const rowData = {
      user_id: personId, stoppage_id,
      trip_type: trip_type === 'one_way' ? 'one_way' : 'round_trip',
      child_count: Math.max(1, Number(child_count) || 1),
      is_active: true,
    };
    const saved = id
      ? await sbPayroll(`bus_fare_entries?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('bus_fare_entries', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_bus_fare_entry', 'bus_fare_entries', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', entry: savedRow });
  }

  if (action === 'delete_bus_fare_entry') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`bus_fare_entries?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_bus_fare_entry', 'bus_fare_entries', id);
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
    if (target === 'mpo_only' && await _isMpoLocked()) return NextResponse.json({ result: 'error', message: 'MPO amounts are locked. Ask the Super Admin to unlock them first.' }, { status: 400 });

    const errors = [];
    let imported = 0;

    if (target === 'people') {
      const gradesRes = await sbPayroll('grades?select=id,name');
      const gradeByName = {}; (gradesRes || []).forEach(g => { gradeByName[String(g.name).toLowerCase()] = g.id; });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.user_id) { errors.push({ row: i + 2, message: 'user_id is required' }); continue; }
        // Only ever touches a column the row actually provided — a sheet
        // with just User ID + MPO Amount (a common yearly-update shape)
        // must not silently null out everyone's grade/bank/active-status
        // just because those columns weren't in it. New people (no
        // existing row) still get sensible defaults for what's missing.
        const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(String(r.user_id))}`);
        const isNew = !(!existing?.error && existing.length);
        const rowData = { user_id: String(r.user_id) };
        if (r.grade_name) {
          const grade_id = gradeByName[String(r.grade_name).toLowerCase()] || null;
          if (!grade_id) { errors.push({ row: i + 2, message: `Grade "${r.grade_name}" not found` }); continue; }
          rowData.grade_id = grade_id;
        } else if (isNew) rowData.grade_id = null;
        if (r.joining_date) rowData.joining_date = r.joining_date; else if (isNew) rowData.joining_date = null;
        if (isNew) rowData.is_active = true;
        if (r.bank_name) rowData.bank_name = r.bank_name; else if (isNew) rowData.bank_name = null;
        if (r.bank_account_no) rowData.bank_account_no = r.bank_account_no; else if (isNew) rowData.bank_account_no = null;
        if (r.mobile_banking_provider) rowData.mobile_banking_provider = r.mobile_banking_provider; else if (isNew) rowData.mobile_banking_provider = null;
        if (r.mobile_banking_number) rowData.mobile_banking_number = r.mobile_banking_number; else if (isNew) rowData.mobile_banking_number = null;
        if (r.mpo_amount !== '' && r.mpo_amount != null) rowData.mpo_amount = Number(r.mpo_amount); else if (isNew) rowData.mpo_amount = null;
        const saved = !isNew
          ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(rowData.user_id)}`, 'PATCH', rowData)
          : await sbPayroll('person_setup', 'POST', rowData);
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else if (target === 'mpo_only') {
      // The dedicated MPO screen's own import — touches mpo_amount and
      // nothing else, ever, so a yearly re-upload can never accidentally
      // wipe anyone's grade/bank/active-status the way a partial row in
      // the general People import used to before that was fixed above.
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.user_id) { errors.push({ row: i + 2, message: 'user_id is required' }); continue; }
        const rowData = { mpo_amount: r.mpo_amount === '' || r.mpo_amount == null ? null : Number(r.mpo_amount) };
        const existing = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(String(r.user_id))}&select=user_id`);
        const saved = (!existing?.error && existing.length)
          ? await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(String(r.user_id))}`, 'PATCH', rowData)
          : await sbPayroll('person_setup', 'POST', { user_id: String(r.user_id), ...rowData });
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
    } else if (target === 'field_values') {
      const { field_id } = payload;
      if (!field_id) return NextResponse.json({ result: 'error', message: 'field_id required' }, { status: 400 });
      const fieldRows = await sbPayroll(`fields?id=eq.${encodeURIComponent(field_id)}&select=key`);
      if (fieldRows?.error) return NextResponse.json({ result: 'error', message: fieldRows.error }, { status: 500 });
      const fieldKey = fieldRows && fieldRows[0] && fieldRows[0].key;
      if (!fieldKey) return NextResponse.json({ result: 'error', message: 'Field not found' }, { status: 404 });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r.user_id || r.value === '' || r.value == null) { errors.push({ row: i + 2, message: 'user_id and value are required' }); continue; }
        const rowData = { user_id: String(r.user_id), [fieldKey]: Number(r.value) };
        const existing = await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(rowData.user_id)}&select=user_id`);
        const saved = (!existing?.error && existing.length)
          ? await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(rowData.user_id)}`, 'PATCH', rowData)
          : await sbPayroll('person_field_values', 'POST', rowData);
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else if (target === 'field_values_bulk') {
      // One row per person, one column per field — matches the wide
      // person_field_values table's own shape (and the paper salary
      // sheet's layout), instead of importing one field at a time.
      // Calculated (percent-of-field) fields are filtered out client-side
      // before this ever runs, but re-validated here too rather than
      // trusting the client — a stray column matching a calculated
      // field's key is silently ignored, not written.
      const fieldsRes = await sbPayroll('fields?select=key,calc_mode');
      if (fieldsRes?.error) return NextResponse.json({ result: 'error', message: fieldsRes.error }, { status: 500 });
      const writableKeys = new Set((fieldsRes || []).filter(f => f.calc_mode !== 'percent_of_field').map(f => f.key));

      // A real paper-style sheet (like the actual salary sheet this bulk
      // import mirrors) often has names but no ID column at all, so a row
      // may give a name instead of a user_id — resolved here against
      // teacher_staff.users_profile rather than trusting the client to
      // have matched it correctly.
      const needsNameLookup = rows.some(r => !r.user_id && r.name);
      let userIdByName = new Map();
      if (needsNameLookup) {
        const profiles = await _teacherSchemaFetch('users_profile?select=teacher_id,full_name');
        (Array.isArray(profiles) ? profiles : []).forEach(p => {
          const key = _normPersonName(p.full_name);
          if (!key) return;
          if (!userIdByName.has(key)) userIdByName.set(key, []);
          userIdByName.get(key).push(p.teacher_id);
        });
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let userId = r.user_id ? String(r.user_id) : '';
        if (!userId && r.name) {
          const matches = userIdByName.get(_normPersonName(r.name)) || [];
          if (!matches.length) { errors.push({ row: i + 2, message: `No matching person found for name "${r.name}"` }); continue; }
          if (matches.length > 1) { errors.push({ row: i + 2, message: `Multiple people match name "${r.name}" — use User ID for this row instead` }); continue; }
          userId = matches[0];
        }
        if (!userId) { errors.push({ row: i + 2, message: 'User ID or Name is required' }); continue; }

        const rowData = { user_id: userId };
        let hasAny = false;
        Object.keys(r).forEach(k => {
          if (k === 'user_id' || k === 'name' || !writableKeys.has(k)) return;
          if (r[k] === '' || r[k] == null) return; // blank cell = leave that field's existing value alone
          rowData[k] = Number(r[k]);
          hasAny = true;
        });
        if (!hasAny) { errors.push({ row: i + 2, message: 'No field values found for this row' }); continue; }
        const existing = await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(rowData.user_id)}&select=user_id`);
        const saved = (!existing?.error && existing.length)
          ? await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(rowData.user_id)}`, 'PATCH', rowData)
          : await sbPayroll('person_field_values', 'POST', rowData);
        if (saved?.error) { errors.push({ row: i + 2, message: saved.error }); continue; }
        imported++;
      }
    } else {
      return NextResponse.json({ result: 'error', message: 'Unknown import target' }, { status: 400 });
    }

    _prAudit(user_id, 'import_rows', target, section_id || null, { imported, error_count: errors.length });
    return NextResponse.json({ result: 'success', imported, errors });
  }

  // ── Additions & Deductions: per-field values (Manual / Import modes) ──
  // Logical mode instead reads the field's own calc_mode / condition rules
  // (see Fields' Conditions modal) — nothing to fetch here for that case.
  if (action === 'get_field_values') {
    const { field_id } = payload;
    if (!field_id) return NextResponse.json({ result: 'error', message: 'field_id required' }, { status: 400 });
    const fieldRows = await sbPayroll(`fields?id=eq.${encodeURIComponent(field_id)}&select=*`);
    if (fieldRows?.error) return NextResponse.json({ result: 'error', message: fieldRows.error }, { status: 500 });
    const field = fieldRows && fieldRows[0];
    if (!field) return NextResponse.json({ result: 'error', message: 'Field not found' }, { status: 404 });

    const [people, valuesRaw] = await Promise.all([
      sbPayroll('person_setup?select=*'),
      sbPayroll(`person_field_values?select=user_id,${field.key}`),
    ]);
    if (people?.error) return NextResponse.json({ result: 'error', message: people.error }, { status: 500 });
    if (valuesRaw?.error) return NextResponse.json({ result: 'error', message: valuesRaw.error }, { status: 500 });
    const manualByUser = {}; (valuesRaw || []).forEach(r => { manualByUser[r.user_id] = r[field.key]; });

    const peopleList = people || [];
    const userIds = peopleList.map(p => p.user_id);
    const [roles, categories] = await Promise.all([_rolesForUsers(userIds), _categoriesForUsers(userIds)]);
    const now = new Date();
    const month = now.getUTCMonth() + 1, year = now.getUTCFullYear();
    const ref = await _loadPayrollRef(userIds, month, year);
    const logicalByUser = {};
    peopleList.forEach(p => {
      const slip = _computePayslipForPerson(p, roles[p.user_id] || [], categories[p.user_id] || '', ref, month, year);
      logicalByUser[p.user_id] = slip.field_values[field.key] ?? 0;
    });

    // Anyone with Logical config (a person_setup row, for the computed
    // preview) OR a manual value already saved — the client merges this
    // against its own live staff directory (allStaffCache) so someone with
    // neither yet still shows up in their category list, ready for a
    // first Manual entry.
    const allIds = new Set([...userIds, ...Object.keys(manualByUser)]);
    const rows = [...allIds].map(uid => ({
      user_id: uid,
      manual_value: manualByUser[uid] ?? null,
      logical_value: logicalByUser[uid] ?? null,
    }));
    return NextResponse.json({ result: 'success', field, rows });
  }

  // One person's manual overrides across every field in one call — the
  // person-centric counterpart to get_field_values (which is one field
  // across every person) — feeds the People Setup detail panel's "Field
  // Overrides" section so editing one person's values doesn't require
  // hunting through each field's own Values screen for their row.
  if (action === 'get_person_field_values') {
    const { user_id: personId } = payload;
    if (!personId) return NextResponse.json({ result: 'error', message: 'user_id required' }, { status: 400 });
    const rows = await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}&select=*`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', values: (rows && rows[0]) || {} });
  }

  if (action === 'save_field_value') {
    const { field_key, user_id: personId, value } = payload;
    if (!field_key || !personId) return NextResponse.json({ result: 'error', message: 'field_key and user_id required' }, { status: 400 });
    if (!/^[a-z][a-z0-9_]{0,58}$/.test(field_key)) return NextResponse.json({ result: 'error', message: 'Invalid field key' }, { status: 400 });
    const rowData = { user_id: personId, [field_key]: (value === '' || value == null) ? null : Number(value) };
    const existing = await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}&select=user_id`);
    if (existing?.error) return NextResponse.json({ result: 'error', message: existing.error }, { status: 500 });
    const saved = existing.length
      ? await sbPayroll(`person_field_values?user_id=eq.${encodeURIComponent(personId)}`, 'PATCH', rowData)
      : await sbPayroll('person_field_values', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'save_field_value', 'person_field_values', `${personId}:${field_key}`, rowData);
    return NextResponse.json({ result: 'success' });
  }

  // ── Loan / Advance sections ──
  // ── Saved Export Templates (column layout/formatting + person selection) ──
  if (action === 'get_export_templates') {
    const rows = await sbPayroll('export_templates?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', templates: rows });
  }

  if (action === 'save_export_template') {
    const { id, name, config, person_selection } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name is required' }, { status: 400 });
    const rowData = {
      name, config: config || {}, person_selection: person_selection || { mode: 'all' },
      updated_at: new Date().toISOString(),
    };
    if (!id) rowData.created_by = user_id || null;
    const saved = id
      ? await sbPayroll(`export_templates?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPayroll('export_templates', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'save_export_template', 'export_templates', savedRow?.id, { name });
    return NextResponse.json({ result: 'success', template: savedRow });
  }

  if (action === 'delete_export_template') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const del = await sbPayroll(`export_templates?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _prAudit(user_id, 'delete_export_template', 'export_templates', id);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_sections') {
    const rows = await sbPayroll('sections?select=*&order=id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', sections: rows });
  }

  if (action === 'save_section') {
    const { id, name, field_id } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name is required' }, { status: 400 });
    // Direction is decided in exactly one place: when a Field is linked, it
    // comes from that field's own category (deduction = loan repayment,
    // addition = allowance) so every entry under this section inherits it
    // automatically. Only an unlinked (legacy-style, plain lump-sum) section
    // falls back to a manually-picked direction.
    let direction = payload.direction === 'add' ? 'add' : 'deduct';
    if (field_id) {
      const fieldRows = await sbPayroll(`fields?id=eq.${encodeURIComponent(field_id)}&select=category`);
      const field = Array.isArray(fieldRows) && fieldRows[0];
      if (!field) return NextResponse.json({ result: 'error', message: 'Field not found' }, { status: 400 });
      direction = field.category === 'deduction' ? 'deduct' : 'add';
    }
    // 'per_unit' sections compute every entry's amount fresh each run from
    // unit_rate x unit_count (capped at unit_max) instead of a typed
    // amount — see _computePayslipForPerson — so a rate/cap change here
    // applies to every entry under it immediately, nothing to re-save.
    // What's actually being counted (children, sessions, whatever the next
    // such need turns out to be) is admin-named via unit_singular/plural
    // rather than hardcoded, so this same mechanism covers any future
    // count-based allowance, not just this one.
    const calc_style = payload.calc_style === 'per_unit' ? 'per_unit' : 'amount';
    const rowData = {
      name, direction, field_id: field_id || null, calc_style,
      unit_rate: calc_style === 'per_unit' ? (Number(payload.unit_rate) || 0) : null,
      unit_max: calc_style === 'per_unit' ? (Number(payload.unit_max) || null) : null,
      unit_singular: calc_style === 'per_unit' ? (payload.unit_singular || 'Child') : 'Child',
      unit_plural: calc_style === 'per_unit' ? (payload.unit_plural || 'Children') : 'Children',
    };
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
    const { section_id, user_id: personId, note } = payload;
    if (!section_id || !personId) return NextResponse.json({ result: 'error', message: 'Section and person are required' }, { status: 400 });

    // A 'per_unit' section (see save_section) skips the EMI/One-Time/
    // Recurring picker entirely — an entry here is just a count of
    // whatever the section is counting, and always behaves like a
    // recurring entry (ongoing, no total to pay off), since
    // _computePayslipForPerson computes the actual amount fresh every run
    // from the section's own current unit_rate/unit_max rather than
    // anything stored on the entry.
    const sectionRows = await sbPayroll(`sections?id=eq.${encodeURIComponent(section_id)}&select=calc_style`);
    const targetSection = Array.isArray(sectionRows) && sectionRows[0];
    if (targetSection && targetSection.calc_style === 'per_unit') {
      const unitCount = Math.max(0, Math.floor(Number(payload.unit_count)));
      if (!Number.isFinite(unitCount) || payload.unit_count === '' || payload.unit_count == null) {
        return NextResponse.json({ result: 'error', message: 'A count is required' }, { status: 400 });
      }
      const rowData = {
        section_id, user_id: personId, note: note || null, paid_installments: 0,
        mode: 'recurring', total_amount: null, emi_amount: null, emi_months: null, remaining_amount: null,
        unit_count: unitCount,
      };
      const saved = await sbPayroll('section_entries', 'POST', rowData);
      if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
      const savedRow = Array.isArray(saved) ? saved[0] : saved;
      _prAudit(user_id, 'add_section_entry', 'section_entries', savedRow?.id, rowData);
      return NextResponse.json({ result: 'success', entry: savedRow });
    }

    const mode = ['emi', 'one_time', 'recurring'].includes(payload.mode) ? payload.mode : 'emi';

    // Which field (if any) this entry counts under comes from the section
    // itself, not a per-entry choice — see save_section.
    let rowData = { section_id, user_id: personId, mode, note: note || null, paid_installments: 0, unit_count: null };
    if (mode === 'emi') {
      // An EMI can be set up mid-flight for a loan that already had some
      // installments paid before it existed in this system (migrating from
      // paper records, or adopted partway through) — "Installments Already
      // Paid" backs the starting remaining_amount down to match, using the
      // same flat per-month rate _computePayslipForPerson derives (fixed
      // emi_amount if set, else total/emi_months), so the balance and
      // eventual completion land on the correct month either way.
      const computed = _computeEmiEntryFields(payload);
      if (computed.error) return NextResponse.json({ result: 'error', message: computed.error }, { status: 400 });
      Object.assign(rowData, computed.fields);
    } else if (mode === 'one_time') {
      // Applies to exactly the next payroll calculation, then stops — built
      // as an EMI whose total equals one installment, so it reuses the
      // exact same finalize (auto-completes after that one run) and revert
      // (re-opens if that run is undone/recalculated) bookkeeping as a
      // multi-month EMI, rather than a separate mechanism to keep in sync.
      const amount = Number(payload.amount);
      if (!amount) return NextResponse.json({ result: 'error', message: 'Amount is required' }, { status: 400 });
      rowData = { ...rowData, total_amount: amount, emi_amount: amount, emi_months: 1, remaining_amount: amount };
    } else {
      // recurring — a flat amount every month with no total to pay off;
      // total_amount/remaining_amount stay null and approve_run/
      // revert_run_to_draft skip it entirely, so it just keeps applying
      // until manually cancelled.
      const amount = Number(payload.amount);
      if (!amount) return NextResponse.json({ result: 'error', message: 'Amount is required' }, { status: 400 });
      rowData = { ...rowData, total_amount: null, emi_amount: amount, emi_months: null, remaining_amount: null };
    }

    const saved = await sbPayroll('section_entries', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    _prAudit(user_id, 'add_section_entry', 'section_entries', savedRow?.id, rowData);
    return NextResponse.json({ result: 'success', entry: savedRow });
  }

  // Corrects an existing entry rather than deleting and re-adding it (which
  // would lose its note/history and, worse, its running paid_installments
  // count). What's editable depends on the entry's shape:
  //   - a 'per_unit' entry (see save_section) is always safe to fully edit
  //     — the amount is computed fresh every run from the section's own
  //     rate/cap, never stored, so there's no history to disturb.
  //   - a 'recurring' (amount-style) entry has no total/remaining
  //     bookkeeping either — its flat monthly amount is safe to change.
  //   - an 'emi'/'one_time' entry can only be fully redefined while still
  //     untouched (no run has been finalized against it yet — remaining_
  //     amount still equals total_amount and paid_installments is 0).
  //     Once a run has been finalized, its total/rate are refused rather
  //     than silently reinterpreted; the admin cancels it and adds a fresh
  //     entry instead, the same way a mid-flight policy change would.
  if (action === 'update_section_entry') {
    const { id, note } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const entryRows = await sbPayroll(`section_entries?id=eq.${encodeURIComponent(id)}&select=*`);
    const entry = Array.isArray(entryRows) && entryRows[0];
    if (!entry) return NextResponse.json({ result: 'error', message: 'Entry not found' }, { status: 404 });
    const sectionRows = await sbPayroll(`sections?id=eq.${encodeURIComponent(entry.section_id)}&select=*`);
    const section = Array.isArray(sectionRows) && sectionRows[0];

    let rowData = { note: note !== undefined ? (note || null) : entry.note };

    if (section && section.calc_style === 'per_unit') {
      const unitCount = Math.max(0, Math.floor(Number(payload.unit_count)));
      if (!Number.isFinite(unitCount) || payload.unit_count === '' || payload.unit_count == null) {
        return NextResponse.json({ result: 'error', message: 'A count is required' }, { status: 400 });
      }
      rowData.unit_count = unitCount;
    } else if (entry.mode === 'recurring') {
      const amount = Number(payload.amount);
      if (!amount) return NextResponse.json({ result: 'error', message: 'Amount is required' }, { status: 400 });
      rowData.emi_amount = amount;
    } else {
      // Sending an amount field at all means the admin is trying to
      // redefine the loan itself — only safe while still untouched.
      // Omitting them (editing just the Note, which the frontend disables
      // these inputs for anyway once touched) is always fine regardless
      // of payment history.
      const wantsAmountChange = entry.mode === 'emi' ? payload.total_amount !== undefined : payload.amount !== undefined;
      if (wantsAmountChange) {
        const untouched = Number(entry.paid_installments) === 0 && Number(entry.remaining_amount) === Number(entry.total_amount);
        if (!untouched) {
          return NextResponse.json({ result: 'error', message: 'This entry already has a payment recorded against it — cancel it and add a new one instead of changing the amount.' }, { status: 400 });
        }
      }
      if (entry.mode === 'emi' && wantsAmountChange) {
        const computed = _computeEmiEntryFields(payload);
        if (computed.error) return NextResponse.json({ result: 'error', message: computed.error }, { status: 400 });
        Object.assign(rowData, computed.fields);
      } else if (entry.mode !== 'emi' && wantsAmountChange) { // one_time
        const amount = Number(payload.amount);
        if (!amount) return NextResponse.json({ result: 'error', message: 'Amount is required' }, { status: 400 });
        Object.assign(rowData, { total_amount: amount, emi_amount: amount, emi_months: 1, remaining_amount: amount });
      }
    }

    const saved = await sbPayroll(`section_entries?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _prAudit(user_id, 'update_section_entry', 'section_entries', id, rowData);
    return NextResponse.json({ result: 'success' });
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
  // Runs the real engine (_computePayslipForPerson) against this person's
  // CURRENT setup, with no writes — the same numbers a real payroll run for
  // this month would produce, so "what would this person actually get paid
  // right now" never requires running one to find out.
  if (action === 'preview_payslip') {
    const { user_id: personId, month, year } = payload;
    if (!personId || !month || !year) return NextResponse.json({ result: 'error', message: 'user_id, month and year are required' }, { status: 400 });
    const personRows = await sbPayroll(`person_setup?user_id=eq.${encodeURIComponent(personId)}`);
    const personSetup = (!personRows?.error && personRows[0]) || { user_id: personId, grade_id: null, joining_date: null };
    const roles = await _rolesForUsers([personId]);
    const categories = await _categoriesForUsers([personId]);
    const [ref, profileRows, gradeRows] = await Promise.all([
      _loadPayrollRef([personId], month, year),
      _teacherSchemaFetch(`users_profile?teacher_id=eq.${encodeURIComponent(personId)}&select=full_name,designation`),
      personSetup.grade_id ? sbPayroll(`grades?id=eq.${encodeURIComponent(personSetup.grade_id)}&select=name`) : Promise.resolve([]),
    ]);
    const slip = _computePayslipForPerson(personSetup, roles[personId] || [], categories[personId] || '', ref, Number(month), Number(year));
    // Name/designation/grade name/step number — the preview shows a bare
    // gross/net breakdown otherwise, with no way to tell who or what setup
    // it's even for.
    const profile = (Array.isArray(profileRows) && profileRows[0]) || {};
    slip.full_name = profile.full_name || null;
    slip.designation = profile.designation || null;
    slip.grade_name = (Array.isArray(gradeRows) && gradeRows[0] && gradeRows[0].name) || null;
    slip.step_id = personSetup.step_id || null;
    // Enrich section_amounts (keyed by entry id -> a bare number in `slip`)
    // with the section's own name/direction, and give the frontend a label
    // for every `statutory:<key>` field_values entry — both are looked up
    // by id/key elsewhere but never returned with a human-readable label,
    // which a one-off preview needs to actually be readable.
    const fieldByIdForLines = {}; ref.fields.forEach(f => { fieldByIdForLines[f.id] = f; });
    const sectionLines = (ref.sectionEntriesByUser[personId] || []).map(entry => {
      const section = ref.sectionsById[entry.section_id];
      const field = section && section.field_id ? fieldByIdForLines[section.field_id] : null;
      return {
        entry_id: entry.id, section_name: section ? section.name : `Section #${entry.section_id}`,
        field_label: field ? field.label : null,
        // A field-linked entry's direction comes from the FIELD's own
        // category (deduction = loan repayment, addition = allowance),
        // not the section's fixed direction — see _computePayslipForPerson.
        direction: field ? field.category === 'deduction' ? 'deduct' : 'add' : (section ? section.direction : 'deduct'),
        mode: entry.mode || 'emi',
        amount: slip.section_amounts[entry.id] || 0, note: entry.note || null,
      };
    });
    const statutoryLabels = {}; ref.statutoryItems.forEach(s => { statutoryLabels[s.key] = s.label || s.name || s.key; });
    return NextResponse.json({ result: 'success', payslip: slip, section_lines: sectionLines, statutory_labels: statutoryLabels });
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
    if (!runRow?.error && runRow[0] && runRow[0].is_locked) {
      return NextResponse.json({ result: 'error', message: 'This run is locked and cannot be deleted' }, { status: 400 });
    }
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
