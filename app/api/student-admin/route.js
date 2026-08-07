import { NextResponse } from 'next/server';

// ── Student Portal Admin (relocated from ccpc-students' own admin panel) ────
// This route re-implements, verbatim in logic, the admin-only actions that
// used to live in ccpc-students/app/api/portal/route.js. It targets the SAME
// Supabase project (wugeppgvmcmsnetksies) but the `student` schema, via
// Accept-Profile/Content-Profile headers — same project, same env vars this
// app already has, just a different schema than ccpc-teachers' own `teacher`.
//
// Auth model: no separate admin login. The caller sends their OWN
// ccpc-teachers user_id (the one they already logged in with); every request
// is re-verified fresh against teacher.app_users for the 'Admin' role, same
// pattern as _isCordOrAdmin() in ccpc-teachers' own /api/exec.
//
// NOT ported: manual_attendance_entry / bulk_attendance_import — grepped the
// entire ccpc-students frontend and found no caller for either action (their
// only UI, showManualAttendanceForm/showBulkAttendanceImport, is never
// invoked from any button) — nothing to relocate for unreachable code.
//
// Also NOT ported: set_student_pin and the self-service reset_pin action.
// Both are meant to be called by a logged-in STUDENT (from their own
// Personal Hub / the login screen's "Forgot PIN?"), but every action on this
// route requires an admin user_id (_isAdmin below) — a student calling
// through here would just get 403'd, so there's no reachable path to them.
// admin_reset_pin (an admin clearing a student's PIN) IS ported below, since
// that's a real admin action.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Text columns in students_data sensible as a shared-secret login password —
// see the matching comment in ccpc-students' route.js for the full
// reasoning (excludes categorical/shared columns like gender/house/blood
// that many students share the exact same value for).
const LOGIN_PASSWORD_CANDIDATES = ['phone_number', 'father_phone', 'mother_phone', 'fathers_name', 'mothers_name', 'nick_name', 'student_name'];

const GP_PROD_URL  = 'https://bluebird.grameenphone.com/alo-paas';
const GP_STAGE_URL = 'https://bluebird.grameenphone.com/alo-paas-stage';

async function sb(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      'Accept-Profile': 'student',
      'Content-Profile': 'student',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// PostgREST silently caps ANY select at this project's configured max_rows
// (3000) regardless of an explicit &limit= in the querystring — confirmed
// live: students_data has 3913 rows, and a plain `&limit=10000` GET was
// still only ever returning 3000 of them (whichever 3000 happened to come
// back first, with no guaranteed order), so entire classes could be
// partially or fully missing from any admin view built this way. Fetches
// in Range-paginated pages instead of trusting a single request to return
// everything past that cap.
async function sbAllRows(path) {
  const PAGE = 3000;
  let all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Accept-Profile': 'student',
        Range: `${offset}-${offset + PAGE - 1}`,
      },
    });
    if (!res.ok) return { error: await res.text() };
    const page = await res.json();
    if (!Array.isArray(page)) return { error: 'Unexpected response shape' };
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Same shape as sb(), scoped to the `teacher` schema instead — used by
// Payroll/Leave Management, whose tables live alongside users_profile etc.
async function sbTeacher(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      'Accept-Profile': 'teacher',
      'Content-Profile': 'teacher',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Same shape as sb()/sbTeacher(), scoped to the `exam` schema — Term/Class/
// Subject/Component/Exam Pattern/Exam/Entry-Sheet/Marks setup all live there
// (kept out of `student` so the exam-rebuild tables aren't mixed in with the
// student roster tables). `extraHeaders` lets a caller opt into upsert
// semantics (`Prefer: resolution=merge-duplicates`) for exam_marks' atomic
// save without forcing that header on every other exam-schema write.
async function sbExam(path, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      'Accept-Profile': 'exam',
      'Content-Profile': 'exam',
      ...extraHeaders,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// ── Shortname resolution for the staff-directory search ─────────────────────
// Shortnames aren't a DB column anywhere — they only exist in the routine
// Google Sheet's "Logged in info" tab (Full Name ↔ NAME IN SHORT), same
// source /api/exec's getRoutineDirectory reads. Local copies of the CSV
// fetch/parse helpers, matching the project's accepted cross-route
// duplication (ccpc-students carries its own copy too).
const ROUTINE_SHEET_ID = '11l3oc1mpbR8UerpDxCatzuhcBNqkbdNzWzOTiPPdKgk';

function _parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function _normalizeName(name) {
  return String(name || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

// normalized full_name -> shortname. Best-effort: any failure returns an
// empty map so the staff directory still works, just without shortnames.
async function _shortnameByName() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${ROUTINE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Logged in info')}&_=${Date.now()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) return {};
    const rows = _parseCsv(await res.text());
    const header = rows[0] || [];
    const fnIdx = header.findIndex(h => String(h).trim() === 'Full Name');
    const snIdx = header.findIndex(h => String(h).trim() === 'NAME IN SHORT');
    if (fnIdx < 0 || snIdx < 0) return {};
    const out = {};
    for (let i = 1; i < rows.length; i++) {
      const key = _normalizeName(rows[i][fnIdx]);
      const sn = String(rows[i][snIdx] || '').trim();
      if (key && sn) out[key] = sn;
    }
    return out;
  } catch { return {}; }
}

async function psSave(key, value) {
  const existing = await sb(`portal_settings?key=eq.${encodeURIComponent(key)}`);
  if (existing?.error) return { ok: false, message: 'Lookup failed: ' + existing.error };
  const res = existing.length
    ? await sb(`portal_settings?key=eq.${encodeURIComponent(key)}`, 'PATCH', { value, updated_at: new Date().toISOString() })
    : await sb('portal_settings', 'POST', { key, value, updated_at: new Date().toISOString() });
  if (res?.error) return { ok: false, message: 'Write failed: ' + res.error };
  return { ok: true };
}

// NOTE: set_gp_credentials saves {api_key, environment, channel} (see
// get_tracking_config, which reads those same names back for display) --
// this used to read gp_api_key/gp_env/gp_channel instead, a leftover from
// an earlier naming, so credentials the admin saved were never actually
// found and this always threw "GP API credentials not configured."
async function getGPToken(settings) {
  const apiKey  = settings.api_key;
  const channel = settings.channel  || 'ALOEXT';
  const baseUrl = settings.environment === 'staging' ? GP_STAGE_URL : GP_PROD_URL;
  if (!apiKey) throw new Error('GP API credentials not configured.');

  const r = await fetch(`${baseUrl}/auth/token`, {
    headers: { 'api-key': apiKey, channel },
  });
  const data = await r.json();
  if (data?.data?.token) return { token: data.data.token, baseUrl };
  throw new Error('GP token fetch failed: ' + JSON.stringify(data));
}

// GP throttles rapid token requests, so reuse one across calls instead of
// minting fresh per request (module-scope — best-effort across a warm
// serverless instance, not a hard guarantee, but avoids the common case of
// two admin clicks in quick succession both hitting /auth/token). Refreshes
// a bit before GP's own ~30min expiry.
let _gpTokenCache = null; // { token, baseUrl, expiresAt }
async function _getGPTokenCached(settings) {
  const now = Date.now();
  if (_gpTokenCache && _gpTokenCache.expiresAt > now) return _gpTokenCache;
  const { token, baseUrl } = await getGPToken(settings);
  _gpTokenCache = { token, baseUrl, expiresAt: now + 25 * 60 * 1000 };
  return _gpTokenCache;
}

// Step 2 of the GP ALO PAAS contract (see [[bus-tracking-system]] memory):
// POST {baseUrl}/api/v1/vts/location/current-attributes with api-key +
// channel + Bearer token + {"imei":[...]} -> data[] with
// latitude/longitude/engineStatus/locationTime/speed/heading/address. This
// was referenced by get_bus_data/check_bus below but never actually written
// anywhere in this repo -- every call threw "queryGPLocations is not
// defined", surfaced to the user as "BUS NOT FOUND / OFFLINE".
async function queryGPLocations(settings, imeis, _retried = false) {
  const { token, baseUrl } = await _getGPTokenCached(settings);
  const r = await fetch(`${baseUrl}/api/v1/vts/location/current-attributes`, {
    method: 'POST',
    headers: {
      'api-key': settings.api_key,
      channel: settings.channel || 'ALOEXT',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imei: imeis }),
  });
  const json = await r.json().catch(() => null);
  if (!Array.isArray(json?.data)) {
    // A cached token that's actually expired/revoked server-side shows up as
    // a 401 here -- drop the cache and retry once with a fresh one before
    // surfacing an error.
    if (r.status === 401 && !_retried) {
      _gpTokenCache = null;
      return queryGPLocations(settings, imeis, true);
    }
    throw new Error('GP location fetch failed: ' + JSON.stringify(json));
  }
  return json.data;
}

// Same conditional-tab evaluator as ccpc-students (used by get_tabs when a
// student_id is passed — admin's own caller always omits it and gets every
// tab back unfiltered, but porting the full function keeps behavior identical).
function normKey(s) { return String(s || '').toLowerCase().replace(/[\s_]/g, ''); }
async function evalRule(rule, profile, submissions) {
  const profileKeys = Object.keys(profile);
  const targetKey = profileKeys.find(k => normKey(k) === normKey(rule.column));
  const val = String(profile[targetKey || rule.column] || '').toLowerCase();
  const target = String(rule.value || '').toLowerCase();
  const targets = target.split(',').map(s => s.trim());
  switch (rule.operator) {
    case 'eq':       return targets.includes(val);
    case 'neq':      return !targets.includes(val);
    case 'contains': return targets.some(t => val.includes(t));
    case 'in_sheet': {
      const sid = profile.student_id;
      return submissions.some(s => s.student_id === sid && s.tab_name === rule.value);
    }
    case 'not_in_sheet': {
      const sid = profile.student_id;
      return !submissions.some(s => s.student_id === sid && s.tab_name === rule.value);
    }
    default: return true;
  }
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

// 'Admin' (controls everything) OR 'Student Portal Admin' (delegated, this module only).
async function _isAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Student Portal Admin');
}

// ── Per-tab module access (admin console nav pills) ──────────────────────
// Which roles can use each tab is admin-configurable (see
// get_admin_tab_visibility / save_admin_tab_visibility below), stored in
// teacher.system_settings under key 'admin_tab_visibility' as
// { tabKey: [role, ...] }. 'Admin' always passes, same as the outer
// MODULE_REGISTRY matrix in _src/app.js. Originally only the 5 ERP tabs
// were covered here (everything else just needed _isAdmin) — extended to
// cover every Student Portal subnav item so an admin can grant a narrower
// role (e.g. "Class Teacher") access to just some of them. A shared
// backend action (e.g. get_staff_directory, used by Access/Data/Assign
// Class Teacher alike) may legitimately belong to more than one tab's set —
// the caller only needs to clear ONE of them, not all.
const ADMIN_TAB_ACTIONS = {
  fees: new Set(['get_fee_types', 'save_fee_type', 'delete_fee_type', 'get_fee_structures', 'save_fee_structure', 'delete_fee_structure', 'get_late_fee_rules', 'save_late_fee_rule', 'delete_late_fee_rule', 'generate_classwise_fees', 'generate_individual_fee', 'remove_individual_fee', 'set_discount', 'get_discounts', 'set_partial_split', 'record_payment', 'get_student_fees', 'get_defaulters_list', 'get_fees_collection_report', 'get_fee_accounts', 'save_fee_account', 'record_account_transaction', 'get_account_register']),
  attendance: new Set(['get_attendance_report', 'save_manual_attendance', 'save_bulk_manual_attendance', 'get_staff_attendance_report', 'get_attendance_devices', 'save_attendance_device', 'delete_attendance_device', 'get_punch_log']),
  exams: new Set([
    'get_exam_terms', 'save_exam_term', 'archive_exam_term',
    'get_class_pattern_setup', 'get_class_patterns', 'save_class_pattern', 'save_class_pattern_map',
    'get_class_pattern_usage', 'delete_class_pattern',
    'get_subjects', 'save_subject', 'delete_subject', 'get_subject_pattern_map', 'save_subject_pattern_map',
    'get_exam_component_types', 'save_exam_component_type', 'get_subject_components_setup', 'save_subject_component', 'delete_subject_component',
    'get_exam_patterns', 'save_exam_pattern', 'duplicate_exam_pattern', 'delete_exam_pattern',
    'get_exams', 'save_exam', 'lock_exam', 'archive_exam', 'duplicate_exam',
    'get_exam_entry_sheets', 'save_exam_entry_sheets_bulk',
    'get_exam_marks_for_entry', 'save_exam_marks_bulk',
    'process_exam_result',
    'get_grade_scales', 'save_grade_scale', 'delete_grade_scale',
    'save_board_exam_record', 'get_board_exam_records',
  ]),
  // Leave Management lives under the Payroll nav tab (its "Leave" sub-tab) —
  // one toggle controls both, matching what the tab actually shows.
  payroll: new Set(['get_salary_structures', 'save_salary_structure', 'get_payroll_runs', 'run_payroll', 'get_payslips', 'mark_payroll_paid', 'get_leave_types', 'save_leave_type', 'get_leave_requests', 'approve_leave_request']),
  transport: new Set(['get_transport_routes', 'save_transport_route', 'get_transport_vehicles', 'save_transport_vehicle', 'get_pickup_points', 'save_pickup_point', 'assign_route_pickup_point', 'get_route_pickup_points', 'assign_vehicle_to_route', 'get_vehicle_assignments', 'get_transport_fee_master', 'save_transport_fee_master', 'generate_student_transport_fee', 'get_student_transport_fees']),
  setup: new Set(['get_tabs', 'get_profile_sections', 'get_student_data_headers', 'get_editable_fields', 'save_editable_fields', 'get_permanent_tabs_config', 'set_permanent_tabs_config', 'get_login_password_columns', 'set_login_password_columns', 'promote_tab_to_profile', 'unpromote_tab_from_profile', 'delete_tab', 'save_tab', 'admin_reset_pin']),
  add_custom_form: new Set(['get_tabs', 'get_student_data_headers', 'save_tab', 'delete_tab']),
  data: new Set(['get_tabs', 'get_tab_data', 'get_tab_submission_status', 'get_staff_list', 'get_tab_data_access', 'set_tab_data_access', 'get_staff_directory', 'get_class_sections', 'get_tab_class_access', 'set_tab_class_access', 'get_field_categories', 'get_tab_category_link', 'set_tab_category_link']),
  // Class Teacher assignment (get_class_teacher_assignments/save_teacher_
  // class_assignment) lives here too, not its own tab key — it's part of
  // the same "Staff Access & Roles" unified panel as the field-category and
  // class-wide grants, sharing one staff picker in the frontend.
  access: new Set(['get_field_categories', 'get_student_data_headers', 'save_field_category', 'delete_field_category', 'get_staff_directory', 'get_field_access_grants', 'get_scope_column_values', 'set_field_access_grants', 'get_class_sections', 'get_class_access_grants', 'set_class_access_grants', 'search_students', 'bulk_update_students', 'create_student', 'preview_rename_student_id_impact', 'download_students_by_category', 'get_class_teacher_assignments', 'save_teacher_class_assignment']),
  history: new Set(['search_edit_history']),
  photo: new Set(['get_student_basic', 'upload_photo']),
  notices: new Set(['get_notices_admin', 'save_notice', 'delete_notice', 'reorder_notices']),
  import: new Set(['get_student_data_headers', 'preview_bulk_import', 'bulk_import_new_students']),
  bus_tracker: new Set(['get_tracking_config', 'get_bus_data']),
};

// Columns get_class_sections' dynamic (Assign Class Teacher) mode will never
// offer as a grouping column, plus class/section themselves (already the
// fixed base of every row). Two kinds excluded:
//  - identity/system/free-text columns that don't represent class
//    structure at all (student_id, phone numbers, photo, pin, etc).
//  - per-student personal attributes (gender, house, blood) — these vary
//    within literally every class+section (individual student traits, not
//    an administrative split), so offering them would show 5+ irrelevant
//    narrowing dropdowns on EVERY class+section instead of only the
//    columns that actually organize students into cohorts (group, shift,
//    version, session, or whatever else the school's data adds later).
const CT_EXCLUDED_COLS = new Set([
  'id', 'student_id', 'student_name', 'class', 'section', 'roll',
  'phone_number', 'father_phone', 'mother_phone', 'nfc_uid', 'submitted_at',
  'fathers_name', 'mothers_name', 'nick_name', 'balance', 'daily_limit',
  'monthly_limit', 'card_status', 'photo', 'pin',
  'gender', 'house', 'blood',
]);

// Salary/payslip data is HR-sensitive — a delegated "Student Portal Admin"
// has no business seeing it by default, unlike the rest of these, which
// default to the same Admin/Student Portal Admin pair the console has
// always required (so extending this list changes nothing until an admin
// actively widens or narrows one from the Access tab).
const ADMIN_TAB_DEFAULTS = {
  fees: ['Admin', 'Student Portal Admin'],
  attendance: ['Admin', 'Student Portal Admin'],
  exams: ['Admin', 'Student Portal Admin'],
  payroll: ['Admin', 'HR'],
  transport: ['Admin', 'Student Portal Admin'],
  setup: ['Admin', 'Student Portal Admin'],
  add_custom_form: ['Admin', 'Student Portal Admin'],
  data: ['Admin', 'Student Portal Admin'],
  access: ['Admin', 'Student Portal Admin'],
  history: ['Admin', 'Student Portal Admin'],
  photo: ['Admin', 'Student Portal Admin'],
  notices: ['Admin', 'Student Portal Admin'],
  import: ['Admin', 'Student Portal Admin'],
  bus_tracker: ['Admin', 'Student Portal Admin'],
};

// An action can legitimately belong to more than one tab's Set (shared
// utility reads like get_staff_directory) — the caller only needs to clear
// ONE of the tabs it appears in, checked by the caller of this function.
function _tabKeysForAction(action) {
  return Object.entries(ADMIN_TAB_ACTIONS).filter(([, set]) => set.has(action)).map(([tab]) => tab);
}

async function _getAdminTabVisibility() {
  const rows = await sbTeacher(`system_settings?key=eq.admin_tab_visibility&select=value`);
  if (rows?.error || !Array.isArray(rows) || !rows.length) return {};
  return rows[0].value || {};
}

function _isTabAllowed(tabKey, roles, matrix) {
  if (roles.includes('Admin')) return true;
  const allowed = (matrix && matrix[tabKey]) || ADMIN_TAB_DEFAULTS[tabKey] || [];
  return allowed.some(r => roles.includes(r));
}

// ── Field-level access (viewers) ─────────────────────────────────────────
// A "viewer" is any non-admin user_id with at least one row in
// student.field_access_grants. Their visible fields = the union of every
// granted category's `fields` array. Full Admins/Student Portal Admins
// never consult this — they always see/edit every field, unchanged.
async function _getViewerCategories(userId) {
  if (!userId) return [];
  const rows = await sb(`field_access_grants?user_id=eq.${encodeURIComponent(userId)}&select=category_name`);
  if (rows?.error) return [];
  return rows.map(r => r.category_name);
}

async function _fieldsForCategories(categoryNames) {
  if (!categoryNames.length) return [];
  const rows = await sb(`field_categories?name=in.(${categoryNames.map(encodeURIComponent).join(',')})&select=fields`);
  if (rows?.error) return [];
  const union = new Set(['student_id']);
  rows.forEach(r => (Array.isArray(r.fields) ? r.fields : []).forEach(f => union.add(f)));
  return [...union];
}

async function _getViewerFields(userId) {
  return _fieldsForCategories(await _getViewerCategories(userId));
}

// Full per-category grant details (fields + can_edit + optional row_filter)
// — used wherever a category's row_filter needs to be enforced, not just
// its field list. row_filter shape: { column: [values] }, AND across
// columns, IN within each column's value list; null/missing = unrestricted.
async function _getViewerGrants(userId) {
  if (!userId) return [];
  const rows = await sb(`field_access_grants?user_id=eq.${encodeURIComponent(userId)}&select=category_name,can_edit,row_filter`);
  if (rows?.error || !rows.length) return [];
  const catNames = [...new Set(rows.map(r => r.category_name))];
  const cats = await sb(`field_categories?name=in.(${catNames.map(encodeURIComponent).join(',')})&select=name,fields`);
  const fieldsByName = {};
  (Array.isArray(cats) ? cats : []).forEach(c => { fieldsByName[c.name] = Array.isArray(c.fields) ? c.fields : []; });
  return rows.map(r => ({
    category_name: r.category_name,
    can_edit: !!r.can_edit,
    row_filter: (r.row_filter && typeof r.row_filter === 'object') ? r.row_filter : null,
    fields: [...new Set(['student_id', ...(fieldsByName[r.category_name] || [])])],
  }));
}
function _rowMatchesFilter(student, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([col, vals]) => {
    if (!Array.isArray(vals) || !vals.length) return true;
    const rawVal = col === 'group' ? (student.group || 'None') : student[col];
    return vals.includes(String(rawVal ?? '').trim());
  });
}

// An "editor" is a viewer whose grant additionally has can_edit=true — a
// strict subset of their viewable categories, never broader. Editable
// fields are the union of only those categories, same shape as viewer
// fields, so both can be enforced with the same field-membership check.
async function _getEditorCategories(userId) {
  if (!userId) return [];
  const rows = await sb(`field_access_grants?user_id=eq.${encodeURIComponent(userId)}&can_edit=eq.true&select=category_name`);
  if (rows?.error) return [];
  return rows.map(r => r.category_name);
}

async function _getEditorFields(userId) {
  return _fieldsForCategories(await _getEditorCategories(userId));
}

// ── Class-wide access (viewers) ──────────────────────────────────────────
// A stronger grant than a field category: covers EVERY core student field
// (same set an admin can edit, minus the same locked financial/security
// columns) AND every custom tab's submission data — but only for students
// inside the granted class+section+group combos. A user can hold any mix
// of field-category and class-wide grants at once; every VIEWER_SAFE_ACTIONS
// handler below unions whatever each type grants rather than picking one.
async function _getClassAccessGrants(userId) {
  if (!userId) return [];
  const rows = await sb(`class_access_grants?user_id=eq.${encodeURIComponent(userId)}&select=class,section,group,can_edit`);
  if (rows?.error) return [];
  return rows;
}
function _studentMatchesGrant(student, grant) {
  const grp = String(student.group || '').trim() || 'None';
  return String(student.class || '').trim() === grant.class
    && String(student.section || '').trim() === grant.section
    && grp === (grant.group || 'None');
}

// Shared chunked-PATCH used by both the full-admin bulk_update_students and
// the field-restricted viewer_bulk_update_students below.
async function _bulkPatchStudents(ids, updates) {
  let updated = 0;
  const errors = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const results = await Promise.all(chunk.map(id => sb(`students_data?student_id=eq.${encodeURIComponent(id)}`, 'PATCH', updates)));
    results.forEach((r, idx) => { if (r?.error) errors.push(`${chunk[idx]}: ${r.error}`); else updated++; });
  }
  return { updated, errors };
}

// Shared by both the viewer path above and the editor actions below.
// filters: { student_id?, class?, section?, roll?, group? } — any
// combination, all optional, AND-combined. projectFields, when given,
// limits the PostgREST `select=` to just those columns (used to enforce a
// viewer's field grant server-side); omit/empty for a full row (editors).
// extraFilter: { column: [values] } — an admin-configured row_filter from a
// Field Category grant (see _getViewerGrants) — AND-combined with the
// caller's own filters, IN-combined within each column's own value list.
async function _searchStudents(filters, projectFields, extraFilter) {
  const f = filters || {};
  const clauses = [];
  if (f.student_id) clauses.push(`student_id=eq.${encodeURIComponent(f.student_id)}`);
  if (f.class) clauses.push(`class=eq.${encodeURIComponent(f.class)}`);
  if (f.section) clauses.push(`section=eq.${encodeURIComponent(f.section)}`);
  if (f.roll) clauses.push(`roll=eq.${encodeURIComponent(f.roll)}`);
  if (f.group) clauses.push(`group=eq.${encodeURIComponent(f.group)}`);
  if (extraFilter) {
    Object.entries(extraFilter).forEach(([col, vals]) => {
      if (Array.isArray(vals) && vals.length) clauses.push(`${encodeURIComponent(col)}=in.(${vals.map(encodeURIComponent).join(',')})`);
    });
  }
  const select = (Array.isArray(projectFields) && projectFields.length)
    ? projectFields.map(encodeURIComponent).join(',')
    : '*';
  const query = `students_data?${clauses.length ? clauses.join('&') + '&' : ''}select=${select}&order=class.asc,section.asc,roll.asc&limit=500`;
  return sb(query);
}

// Looks up a category's field list, then runs _searchStudents projected to
// exactly those fields (+ student_id, + any admin-picked extraColumns),
// returning CSV-ready {headers, rows} where rows are arrays in the same
// order as headers — this direct field-list-to-column mapping is what
// guarantees the downloaded file matches the selected category (plus
// whatever was explicitly added on top). extraFilter: see _searchStudents
// above. extraColumns: only ever passed by the full-admin caller — the
// viewer path below never supplies it, so a restricted viewer can't widen
// their download past their own granted category's columns.
async function _downloadByCategory(categoryName, filters, extraFilter, extraColumns) {
  const catRows = await sb(`field_categories?name=eq.${encodeURIComponent(categoryName)}&select=fields`);
  if (catRows?.error) return { result: 'error', message: catRows.error };
  if (!catRows.length) return { result: 'error', message: 'Category not found.' };
  const catFields = Array.isArray(catRows[0].fields) ? catRows[0].fields : [];
  const base = catFields.includes('student_id') ? catFields : ['student_id', ...catFields];
  const extra = (Array.isArray(extraColumns) ? extraColumns : []).map(c => String(c || '').trim()).filter(Boolean);
  const headers = [...new Set([...base, ...extra])];
  const rows = await _searchStudents(filters, headers, extraFilter);
  if (rows?.error) return { result: 'error', message: rows.error };
  return { result: 'success', headers, rows: rows.map(r => headers.map(h => r[h] ?? '')) };
}

// Actions a restricted viewer (not a full Admin) may call. Everything else
// on this route still requires _isAdmin, exactly as before this feature.
const VIEWER_SAFE_ACTIONS = new Set([
  'get_my_access', 'search_students', 'download_students_by_category', 'viewer_bulk_update_students',
  'get_class_tabs', 'get_class_student_tab_data', 'save_class_student_tab_data',
]);

// Device-to-server sync endpoint's actual logic — authenticated by matching
// ip+credentials against a registered attendance_devices row (see the
// ingest_punch_log bypass in POST, above the _isAdmin gate).
async function _ingestPunchLog(payload) {
  const { device_ip, api_username, api_password, punches } = payload; // punches: [{device_user_id, punch_time, verify_method}]
  const devRows = await sb(`attendance_devices?ip=eq.${encodeURIComponent(device_ip || '')}&is_active=eq.true`);
  if (devRows?.error || !devRows.length) return NextResponse.json({ result: 'error', message: 'Unknown or inactive device.' }, { status: 403 });
  const device = devRows[0];
  if (device.api_username && (device.api_username !== api_username || device.api_password !== api_password)) {
    return NextResponse.json({ result: 'error', message: 'Invalid device credentials.' }, { status: 403 });
  }
  if (!Array.isArray(punches) || !punches.length) return NextResponse.json({ result: 'error', message: 'No punches provided.' });
  const rows = await Promise.all(punches.map(async p => {
    // Best-effort match: try teacher.app_users first, then students_data, by device_user_id.
    const staffMatch = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(p.device_user_id)}&select=user_id`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' } }).then(r => r.ok ? r.json() : []);
    let person_type = 'unmatched', person_id = null, matched = false;
    if (Array.isArray(staffMatch) && staffMatch.length) { person_type = 'staff'; person_id = p.device_user_id; matched = true; }
    else {
      const studentMatch = await sb(`students_data?student_id=eq.${encodeURIComponent(p.device_user_id)}&select=student_id`);
      if (!studentMatch?.error && studentMatch.length) { person_type = 'student'; person_id = p.device_user_id; matched = true; }
    }
    return { device_id: device.id, device_user_id: p.device_user_id, person_type, person_id, punch_time: p.punch_time || new Date().toISOString(), verify_method: p.verify_method || '', matched };
  }));
  const ins = await sb('attendance_punch_log', 'POST', rows);
  if (ins?.error) return NextResponse.json({ result: 'error', message: ins.error });
  await sb(`attendance_devices?id=eq.${encodeURIComponent(device.id)}`, 'PATCH', { last_sync_at: new Date().toISOString() });
  return NextResponse.json({ result: 'success', ingested: rows.length, unmatched: rows.filter(r => !r.matched).length });
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ result: 'error', message: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;

  // A device calls this unattended — no teacher user_id, authenticated by
  // matching ip+credentials against a registered attendance_devices row
  // instead, so it must bypass the _isAdmin/viewer gate below entirely.
  if (action === 'ingest_punch_log') {
    return _ingestPunchLog(payload);
  }

  // Self-service: any authenticated caller (Admin included) may ask which
  // admin-console tabs THEIR OWN role currently opens, so the Faculty
  // Portal sidebar can show direct shortcuts to just those tabs — this
  // never reveals or lets anyone edit the matrix itself (that stays
  // Admin-only via get_admin_tab_visibility above).
  if (action === 'get_my_tab_access') {
    const roles = await _getUserRoles(user_id);
    if (!roles.length) return NextResponse.json({ result: 'success', tabs: [] });
    const matrix = await _getAdminTabVisibility();
    const tabs = Object.keys(ADMIN_TAB_ACTIONS).filter(tab => _isTabAllowed(tab, roles, matrix));
    return NextResponse.json({ result: 'success', tabs });
  }

  // Any authenticated teacher/staff (not just Admin) may request their own
  // leave or view their own payslips — scoped to their own user_id only,
  // never trusting a teacher_id the client might try to pass instead.
  if (action === 'save_leave_request' || action === 'get_my_payslips') {
    const selfRows = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(user_id || '')}&select=user_id`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' } }).then(r => r.ok ? r.json() : []);
    if (!Array.isArray(selfRows) || !selfRows.length) return NextResponse.json({ result: 'error', message: 'Not a recognized staff account.' }, { status: 403 });
    if (action === 'save_leave_request') {
      const { leave_type_id, start_date, end_date, reason } = payload;
      if (!start_date || !end_date) return NextResponse.json({ result: 'error', message: 'Start and end date required.' });
      const r = await sbTeacher('leave_requests', 'POST', { teacher_id: user_id, leave_type_id: leave_type_id || null, start_date, end_date, reason: reason || '' });
      if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
      return NextResponse.json({ result: 'success' });
    }
    const rows = await sbTeacher(`payslips?teacher_id=eq.${encodeURIComponent(user_id)}&select=*,payroll_runs(month,year,status)&order=id.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', payslips: rows });
  }

  // Actions belonging to one of the admin-console tabs get gated by the
  // admin-configurable per-tab matrix instead of the plain _isAdmin check —
  // e.g. Payroll defaults to Admin/HR only, not Student Portal Admin, and
  // an Admin can widen/narrow any tab from the Access tab. An action shared
  // across several tabs (e.g. get_staff_directory) only needs ONE of them
  // to clear. Once cleared, treat the caller as admin for the rest of this
  // handler, same as the plain _isAdmin path below.
  //
  // A few of these (search_students, download_students_by_category) are
  // ALSO dual-purpose viewer-safe actions — a restricted viewer with a
  // Field Category grant calls the exact same action name the Access tab's
  // admin UI does, branching on `isAdmin` further down. Failing the tab
  // matrix must NOT hard-reject those — it must fall through with
  // isAdmin=false so the VIEWER_SAFE_ACTIONS check below gets a chance to
  // admit a genuine viewer, same as it always has.
  const tabKeys = _tabKeysForAction(action);
  let isAdmin;
  if (tabKeys.length) {
    const roles = await _getUserRoles(user_id);
    const matrix = await _getAdminTabVisibility();
    isAdmin = tabKeys.some(tk => _isTabAllowed(tk, roles, matrix));
    if (!isAdmin && !VIEWER_SAFE_ACTIONS.has(action)) {
      return NextResponse.json({ result: 'error', message: 'This module requires additional permissions.' }, { status: 403 });
    }
  } else {
    isAdmin = await _isAdmin(user_id);
  }
  let viewerCategories = [];
  let classGrants = [];
  if (!isAdmin) {
    if (!VIEWER_SAFE_ACTIONS.has(action)) {
      return NextResponse.json({ result: 'error', message: 'Admin access required.' }, { status: 403 });
    }
    [viewerCategories, classGrants] = await Promise.all([_getViewerCategories(user_id), _getClassAccessGrants(user_id)]);
    if (!viewerCategories.length && !classGrants.length) {
      return NextResponse.json({ result: 'error', message: 'No data access has been granted to this account.' }, { status: 403 });
    }
  }

  // ── Viewer-only actions (isAdmin === false, viewerCategories/classGrants non-empty) ──
  if (!isAdmin && action === 'get_my_access') {
    const fields = await _getViewerFields(user_id);
    const editableFields = await _getEditorFields(user_id);
    return NextResponse.json({ result: 'success', categories: viewerCategories, fields, editable_fields: editableFields, classAccess: classGrants });
  }
  if (!isAdmin && action === 'search_students') {
    // Class-wide grants see every core field for matching students, taking
    // priority on overlap; each field-category grant then fills in the rest
    // (limited to its own fields, and — if it has a row_filter — limited to
    // students matching that filter too) for whoever isn't already covered.
    const results = [];
    const seen = new Set();
    if (classGrants.length) {
      const fullRows = await _searchStudents(payload, null);
      if (!fullRows?.error) {
        fullRows.forEach(r => { if (classGrants.some(g => _studentMatchesGrant(r, g))) { seen.add(r.student_id); results.push(r); } });
      }
    }
    const grants = await _getViewerGrants(user_id);
    for (const g of grants) {
      const catRows = await _searchStudents(payload, g.fields, g.row_filter);
      if (!catRows?.error) catRows.forEach(r => { if (!seen.has(r.student_id)) { seen.add(r.student_id); results.push(r); } });
    }
    const allKeys = new Set();
    results.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
    const headers = allKeys.size ? [...allKeys] : [];
    return NextResponse.json({ result: 'success', headers, rows: results });
  }
  if (!isAdmin && action === 'download_students_by_category') {
    const { category_name } = payload;
    if (!viewerCategories.includes(category_name)) {
      return NextResponse.json({ result: 'error', message: 'That category has not been granted to this account.' }, { status: 403 });
    }
    const grants = await _getViewerGrants(user_id);
    const grant = grants.find(g => g.category_name === category_name);
    return NextResponse.json(await _downloadByCategory(category_name, payload, grant && grant.row_filter));
  }
  if (!isAdmin && action === 'get_class_tabs') {
    if (!classGrants.length) return NextResponse.json({ result: 'error', message: 'No class access granted.' }, { status: 403 });
    const tabRows = await sb('portal_tabs?select=tab_name,is_enabled&order=sort_order.asc,id.asc');
    if (tabRows?.error) return NextResponse.json({ result: 'error', message: tabRows.error });
    return NextResponse.json({ result: 'success', tabs: (tabRows || []).filter(t => t.is_enabled).map(t => ({ tab_name: t.tab_name })) });
  }
  if (!isAdmin && action === 'get_class_student_tab_data') {
    if (!classGrants.length) return NextResponse.json({ result: 'error', message: 'No class access granted.' }, { status: 403 });
    const { student_id, tab_name } = payload || {};
    if (!student_id || !tab_name) return NextResponse.json({ result: 'error', message: 'student_id and tab_name required.' });
    const studentRows = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=*`);
    if (studentRows?.error || !studentRows.length) return NextResponse.json({ result: 'error', message: 'Student not found.' });
    const grant = classGrants.find(g => _studentMatchesGrant(studentRows[0], g));
    if (!grant) return NextResponse.json({ result: 'error', message: 'This student is outside your granted class access.' }, { status: 403 });
    const tabRows = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}&select=fields_json`);
    if (tabRows?.error || !tabRows.length) return NextResponse.json({ result: 'error', message: 'Tab not found.' });
    let fields = [];
    try { fields = JSON.parse(tabRows[0].fields_json || '[]'); } catch {}
    const subRows = await sb(`portal_submissions?student_id=eq.${encodeURIComponent(student_id)}&tab_name=eq.${encodeURIComponent(tab_name)}&select=data`);
    const data = (!subRows?.error && subRows.length) ? subRows[0].data : {};
    return NextResponse.json({ result: 'success', fields, data: data || {}, can_edit: !!grant.can_edit });
  }
  if (!isAdmin && action === 'save_class_student_tab_data') {
    if (!classGrants.length) return NextResponse.json({ result: 'error', message: 'No class access granted.' }, { status: 403 });
    const { student_id, tab_name, data } = payload || {};
    if (!student_id || !tab_name) return NextResponse.json({ result: 'error', message: 'student_id and tab_name required.' });
    const studentRows = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=*`);
    if (studentRows?.error || !studentRows.length) return NextResponse.json({ result: 'error', message: 'Student not found.' });
    const grant = classGrants.find(g => _studentMatchesGrant(studentRows[0], g));
    if (!grant || !grant.can_edit) return NextResponse.json({ result: 'error', message: 'You do not have edit access for this student.' }, { status: 403 });
    const cleanData = (data && typeof data === 'object') ? data : {};
    const existing = await sb(`portal_submissions?student_id=eq.${encodeURIComponent(student_id)}&tab_name=eq.${encodeURIComponent(tab_name)}&select=id`);
    const r = (!existing?.error && existing.length)
      ? await sb(`portal_submissions?id=eq.${existing[0].id}`, 'PATCH', { data: cleanData, submitted_at: new Date().toISOString() })
      : await sb('portal_submissions', 'POST', { student_id, tab_name, data: cleanData });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (!isAdmin && action === 'viewer_bulk_update_students') {
    const { student_ids, updates } = payload;
    const ids = Array.isArray(student_ids) ? [...new Set(student_ids.map(s => String(s || '').trim()).filter(Boolean))] : [];
    if (!ids.length) return NextResponse.json({ result: 'error', message: 'Select at least one student.' });

    const rows = await sb(`students_data?student_id=in.(${ids.map(encodeURIComponent).join(',')})&select=*`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    const byId = {}; rows.forEach(r => { byId[r.student_id] = r; });

    const editorGrants = (await _getViewerGrants(user_id)).filter(g => g.can_edit);
    if (!editorGrants.length && !classGrants.some(g => g.can_edit)) {
      return NextResponse.json({ result: 'error', message: 'You do not have edit access to any category.' }, { status: 403 });
    }

    const rawUpdates = (updates && typeof updates === 'object') ? updates : {};
    let updated = 0; const errors = [];
    for (const id of ids) {
      const student = byId[id];
      if (!student) { errors.push(`${id}: not found`); continue; }
      // A student may be covered by several grants at once (class-wide,
      // and/or one or more field categories each with their own optional
      // row_filter) — the fields this specific student may have changed is
      // the union of every grant that actually applies to THEM, never
      // trusting the client's claim of what it's allowed to edit.
      const fullAccess = classGrants.some(g => g.can_edit && _studentMatchesGrant(student, g));
      const allowedFields = new Set();
      editorGrants.forEach(g => { if (_rowMatchesFilter(student, g.row_filter)) g.fields.forEach(f => allowedFields.add(f)); });
      const cleanUpdates = fullAccess
        ? Object.fromEntries(Object.entries(rawUpdates).filter(([k, v]) => k !== 'student_id' && k !== 'id' && v !== '' && v !== null && v !== undefined))
        : Object.fromEntries(Object.entries(rawUpdates).filter(([k, v]) => allowedFields.has(k) && k !== 'student_id' && v !== '' && v !== null && v !== undefined));
      if (!Object.keys(cleanUpdates).length) continue; // nothing this caller may change for this student — silently skip
      const r = await sb(`students_data?student_id=eq.${encodeURIComponent(id)}`, 'PATCH', cleanUpdates);
      if (r?.error) errors.push(`${id}: ${r.error}`); else updated++;
    }
    if (!updated && !errors.length) return NextResponse.json({ result: 'error', message: 'You do not have edit access to any of the fields you tried to change for these students.' });
    return NextResponse.json({ result: errors.length ? 'partial' : 'success', updated, errors });
  }

  // ── Notices ─────────────────────────────────────────────────────────────
  if (action === 'get_notices_admin') {
    const rows = await sb('portal_notices?order=sort_order.asc,id.asc');
    return NextResponse.json((rows && !rows.error) ? rows : []);
  }
  if (action === 'save_notice') {
    const { id, title, subtitle, body: noticeBody, is_enabled } = payload;
    const rowData = { title: title || '', subtitle: subtitle || '', body: noticeBody || '', is_enabled: is_enabled !== false, updated_at: new Date().toISOString() };
    if (id) {
      await sb(`portal_notices?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData);
      return NextResponse.json({ result: 'success', id });
    }
    const existing = await sb('portal_notices?select=sort_order&order=sort_order.desc&limit=1');
    const nextOrder = (existing && !existing.error && existing.length) ? existing[0].sort_order + 1 : 0;
    const created = await sb('portal_notices', 'POST', { ...rowData, sort_order: nextOrder });
    return NextResponse.json({ result: 'success', id: (created && !created.error && created[0]) ? created[0].id : null });
  }
  if (action === 'delete_notice') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required.' });
    await sb(`portal_notices?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'reorder_notices') {
    const { ids } = payload;
    if (!Array.isArray(ids)) return NextResponse.json({ result: 'error', message: 'ids array required.' });
    await Promise.all(ids.map((id, i) => sb(`portal_notices?id=eq.${encodeURIComponent(id)}`, 'PATCH', { sort_order: i })));
    return NextResponse.json({ result: 'success' });
  }

  // ── Tabs (builder) ──────────────────────────────────────────────────────
  if (action === 'get_tabs') {
    const { student_id } = payload;
    const tabRows = await sb('portal_tabs?order=sort_order.asc,id.asc');
    if (tabRows?.error) return NextResponse.json([]);
    const allTabs = (tabRows || []).map(t => ({
      tab_name: t.tab_name,
      fields_json: t.fields_json || '[]',
      is_enabled: t.is_enabled,
      condition_json: t.condition_json || '{}',
      icon_class: t.icon_class || 'bi-folder-fill',
      default_editable: t.default_editable || 'YES',
      include_fields_json: t.include_fields_json || '[]',
    }));
    if (!student_id || student_id === 'admin') return NextResponse.json(allTabs);

    const profileRows = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=*`);
    const profile = (profileRows && !profileRows.error && profileRows[0]) ? profileRows[0] : { student_id };
    const subRows = await sb(`portal_submissions?student_id=eq.${encodeURIComponent(student_id)}&select=tab_name`);
    const submissions = subRows?.error ? [] : subRows;

    const visible = [];
    for (const tab of allTabs) {
      if (!tab.is_enabled) continue;
      let condObj = null;
      try { condObj = JSON.parse(tab.condition_json || '{}'); } catch {}
      if (!condObj || !(condObj.rules?.length)) { visible.push(tab); continue; }
      const results = await Promise.all(condObj.rules.map(r => evalRule(r, profile, submissions)));
      const pass = condObj.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
      if (pass) visible.push(tab);
    }
    return NextResponse.json(visible);
  }
  if (action === 'save_tab') {
    const { tab_name, fields_json, is_enabled, condition_json, icon_class, default_editable, include_fields_json } = payload;
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'Tab name required.' });
    const existing = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}`);
    if (existing?.error) return NextResponse.json({ result: 'error', message: 'Could not look up existing tab: ' + existing.error });
    const rowData = { tab_name, fields_json, is_enabled, condition_json, icon_class, default_editable, include_fields_json };
    const writeRes = existing.length
      ? await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}`, 'PATCH', rowData)
      : await sb('portal_tabs', 'POST', { ...rowData, sort_order: 0 });
    if (writeRes?.error) return NextResponse.json({ result: 'error', message: 'Save failed: ' + writeRes.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_tab') {
    const r = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(payload.tab_name)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Login Password Columns (which students_data phone-like columns are
  // accepted as the login password) ────────────────────────────────────────
  if (action === 'get_login_password_columns') {
    const rows = await sb('portal_settings?key=eq.login_password_columns');
    const saved = (!rows?.error && rows[0]) ? rows[0].value : null;
    const selected = Array.isArray(saved) ? saved.filter(c => LOGIN_PASSWORD_CANDIDATES.includes(c)) : LOGIN_PASSWORD_CANDIDATES;
    return NextResponse.json({ candidates: LOGIN_PASSWORD_CANDIDATES, selected });
  }
  if (action === 'set_login_password_columns') {
    const columns = Array.isArray(payload?.columns) ? payload.columns.filter(c => LOGIN_PASSWORD_CANDIDATES.includes(c)) : [];
    if (!columns.length) return NextResponse.json({ result: 'error', message: 'Select at least one column — otherwise no student could log in.' });
    const r = await psSave('login_password_columns', columns);
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success' });
  }

  // ── Admin-triggered PIN reset (no phone verification — admin is already
  // authenticated) — for when a student is locked out. ───────────────────────
  if (action === 'admin_reset_pin') {
    const { student_id } = payload;
    if (!student_id) return NextResponse.json({ result: 'error', message: 'Student ID required.' });
    const rows = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=student_id`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: 'Database error.' });
    if (!rows.length) return NextResponse.json({ result: 'error', message: 'Student ID not found.' });
    const r = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}`, 'PATCH', { pin: null });
    if (r?.error) return NextResponse.json({ result: 'error', message: 'Could not reset PIN.' });
    return NextResponse.json({ result: 'success', message: `PIN cleared for ${student_id} — they can log in with their phone number again.` });
  }

  // ── Minimal single-student lookup for the admin Photo tab (no existing
  // action returns a bare students_data row to the client — get_tabs only
  // uses it internally to evaluate tab conditions). ───────────────────────
  if (action === 'get_student_basic') {
    const { student_id } = payload;
    if (!student_id) return NextResponse.json({ result: 'error', message: 'Student ID required.' });
    const rows = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=student_id,student_name,class,section,roll,photo`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: 'Database error.' });
    if (!rows.length) return NextResponse.json({ result: 'error', message: 'Student ID not found.' });
    return NextResponse.json({ result: 'success', student: rows[0] });
  }

  // ── Profile photo — admin-side upload into the public `students` Storage
  // bucket. Client sends an already square-cropped, already-compressed
  // (<=130KB, matching the bucket's own limit) JPEG data URL — see
  // handleStudentPhotoSelect in _src/app.js, copied from the equivalent
  // teacher-photo flow (handlePhotoSelect / uploadPhotoToDrive in
  // exec/route.js), just targeting a different bucket.
  if (action === 'upload_photo') {
    const { student_id, photo_base64 } = payload;
    if (!student_id || !photo_base64) return NextResponse.json({ result: 'error', message: 'Student ID and photo required.' });
    const raw = String(photo_base64).replace(/^data:[^;]+;base64,/, '');
    const binary = atob(raw);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    const contentType = (String(photo_base64).match(/data:([^;]+)/) || [])[1] || 'image/jpeg';

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/students/photo_${encodeURIComponent(student_id)}.jpg`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: buf,
    });
    if (!uploadRes.ok) return NextResponse.json({ result: 'error', message: 'Upload failed: ' + (await uploadRes.text()).slice(0, 200) });

    const publicUrl = `${SB_URL}/storage/v1/object/public/students/photo_${encodeURIComponent(student_id)}.jpg?v=${Date.now()}`;
    const patchRes = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}`, 'PATCH', { photo: publicUrl });
    if (patchRes?.error) return NextResponse.json({ result: 'error', message: 'Uploaded, but could not save to profile.' });
    return NextResponse.json({ result: 'success', photo: publicUrl });
  }

  // ── Edit History (admin-searchable audit trail, populated by a DB trigger
  // on every students_data UPDATE — see the edit_history table) ──────────────
  if (action === 'search_edit_history') {
    const q = String(payload?.query || '').trim();
    const limit = Math.min(Number(payload?.limit) || 50, 200);
    let path = `edit_history?select=*&order=created_at.desc&limit=${limit}`;
    if (q) {
      const esc = encodeURIComponent(q);
      path += `&or=(student_id.ilike.*${esc}*,name.ilike.*${esc}*,class.ilike.*${esc}*,section.ilike.*${esc}*,roll.ilike.*${esc}*)`;
    }
    const rows = await sb(path);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', rows: Array.isArray(rows) ? rows : [] });
  }

  // ── Permanent Tabs Visibility (Wallet/Canteen/Stationary/Teachers/Bus — the
  // built-in tabs, not the tab-builder's custom ones in portal_tabs) ──────────
  // Missing key or missing per-tab entry both mean "visible" — a fresh install
  // or a newly-added permanent tab should show up, not silently vanish.
  if (action === 'get_permanent_tabs_config') {
    const rows = await sb('portal_settings?key=eq.permanent_tabs_visibility');
    const cfg = (!rows?.error && rows[0]) ? rows[0].value : {};
    return NextResponse.json(cfg || {});
  }
  if (action === 'set_permanent_tabs_config') {
    const cfg = (payload && typeof payload === 'object') ? payload : {};
    const r = await psSave('permanent_tabs_visibility', cfg);
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success' });
  }

  // ── Delegated data access (who besides admins can view/export a tab's data) ──
  if (action === 'get_staff_list') {
    // teacher-schema read: faculty portal logins live in teacher.app_users
    const res = await fetch(`${SB_URL}/rest/v1/app_users?select=user_id,email,role&order=user_id.asc`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' },
    });
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json());
  }
  if (action === 'get_tab_data_access') {
    const rows = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(payload.tab_name)}&select=data_access_json`);
    let ids = [];
    try { ids = JSON.parse((rows && !rows.error && rows[0]?.data_access_json) || '[]'); } catch {}
    return NextResponse.json({ user_ids: Array.isArray(ids) ? ids : [] });
  }
  if (action === 'set_tab_data_access') {
    const { tab_name, user_ids } = payload;
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'Tab name required.' });
    const clean = [...new Set((Array.isArray(user_ids) ? user_ids : []).map(String).filter(Boolean))];
    const r = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}`, 'PATCH', { data_access_json: JSON.stringify(clean) });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', count: clean.length });
  }

  // ── Class-scoped tab access (student.tab_class_access) — the per-class
  // counterpart to the global data_access_json grants above. An admin
  // searches staff by name/id/shortname/phone and checks off which
  // class-sections of one tab's data that person may see. ────────────────────
  if (action === 'get_staff_directory') {
    // Rich search list: name + phone from users_profile, account fields from
    // app_users. Shortname prefers each teacher's own self-set
    // users_profile.shortname; only falls back to the routine sheet's
    // "Logged in info" lookup for whoever hasn't set one yet — the sheet
    // stays the sole source of truth for actual routine/schedule matching
    // elsewhere (that's tied to the sheet's own literal abbreviations and
    // is untouched by this), this is purely the directory's display value.
    const hdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' };
    const [profRes, userRes, shortnames] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/users_profile?select=teacher_id,full_name,designation,shortname,phone,whatsapp&order=full_name.asc&limit=1000`, { headers: hdrs }),
      fetch(`${SB_URL}/rest/v1/app_users?select=user_id,email,role,phone&limit=1000`, { headers: hdrs }),
      _shortnameByName(),
    ]);
    const profiles = profRes.ok ? await profRes.json() : [];
    const users = userRes.ok ? await userRes.json() : [];
    const profById = {};
    profiles.forEach(p => { profById[p.teacher_id] = p; });
    const out = users.map(u => {
      const p = profById[u.user_id] || {};
      return {
        user_id: u.user_id,
        full_name: p.full_name || '',
        shortname: p.shortname || shortnames[_normalizeName(p.full_name)] || '',
        designation: p.designation || '',
        phone: p.phone || p.whatsapp || u.phone || '',
        email: u.email || '',
        role: u.role || '',
      };
    }).sort((a, b) => (a.full_name || a.user_id).localeCompare(b.full_name || b.user_id));
    return NextResponse.json(out);
  }
  if (action === 'get_class_sections') {
    // PostgREST has no distinct param on plain selects — fetch every student
    // row and tally per unique combo here (a few thousand tiny rows, fine).
    // `count` is real students in that exact combo.
    //
    // Two shapes, by whether `payload.dynamic` is set:
    //  - Unset (Class-Wide Access / Class Access pickers — unchanged since
    //    before the Assign Class Teacher combo-picker existed): breaks out
    //    by class, section and group only, `{class,section,group,count}`.
    //  - Set (Assign Class Teacher's combo picker): discovers every real
    //    students_data column except CT_EXCLUDED_COLS (identity/system
    //    columns) and fetches all of them at once, `{class,section,
    //    extras:{col:val,...},count}` — lets the picker figure out, once an
    //    admin has picked a class+section, which OTHER columns actually
    //    vary within it (only those are worth a further narrowing
    //    dropdown — most class+sections need none at all), with no
    //    hardcoded list of "the columns that matter" to keep in sync as
    //    students_data itself changes.
    if (!payload?.dynamic) {
      const rows = await sbAllRows('students_data?select=class,section,group');
      if (rows?.error) return NextResponse.json([]);
      const seen = new Map();
      rows.forEach(r => {
        const cls = String(r.class || '').trim(), sec = String(r.section || '').trim();
        const grp = String(r.group || '').trim() || 'None';
        if (!cls || !sec) return;
        const key = `${cls}|${sec}|${grp}`;
        if (!seen.has(key)) seen.set(key, { class: cls, section: sec, group: grp, count: 0 });
        seen.get(key).count++;
      });
      const out = [...seen.values()];
      out.sort((a, b) => a.class.localeCompare(b.class) || a.section.localeCompare(b.section) || a.group.localeCompare(b.group));
      return NextResponse.json(out);
    }

    const headerRows = await sb('students_data?limit=1');
    if (headerRows?.error || !headerRows.length) return NextResponse.json({ candidateCols: [], rows: [] });
    const candidateCols = Object.keys(headerRows[0]).filter(c => !CT_EXCLUDED_COLS.has(c));
    const rows = await sbAllRows(`students_data?select=${['class', 'section', ...candidateCols].join(',')}`);
    if (rows?.error) return NextResponse.json({ candidateCols, rows: [] });
    const seen = new Map();
    rows.forEach(r => {
      const cls = String(r.class || '').trim(), sec = String(r.section || '').trim();
      if (!cls || !sec) return;
      const extras = {};
      candidateCols.forEach(c => { extras[c] = String(r[c] || '').trim() || 'None'; });
      const key = JSON.stringify([cls, sec, extras]);
      if (!seen.has(key)) seen.set(key, { class: cls, section: sec, extras, count: 0 });
      seen.get(key).count++;
    });
    const out = [...seen.values()].sort((a, b) => a.class.localeCompare(b.class) || a.section.localeCompare(b.section));
    return NextResponse.json({ candidateCols, rows: out });
  }
  if (action === 'get_tab_class_access') {
    const { tab_name } = payload;
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'Tab name required.' });
    const rows = await sb(`tab_class_access?tab_name=eq.${encodeURIComponent(tab_name)}&select=user_id,class,section,group&order=user_id.asc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    const byUser = {};
    rows.forEach(r => {
      (byUser[r.user_id] = byUser[r.user_id] || []).push({ class: r.class, section: r.section, group: r.group || 'None' });
    });
    return NextResponse.json({ grants: Object.entries(byUser).map(([user_id, class_sections]) => ({ user_id, class_sections })) });
  }
  if (action === 'set_tab_class_access') {
    const { tab_name, user_id: granteeId, class_sections } = payload;
    if (!tab_name || !granteeId) return NextResponse.json({ result: 'error', message: 'Tab name and user required.' });
    const clean = (Array.isArray(class_sections) ? class_sections : [])
      .map(cs => ({ class: String(cs.class || '').trim(), section: String(cs.section || '').trim(), group: String(cs.group || '').trim() || 'None' }))
      .filter(cs => cs.class && cs.section);
    // Replace-all semantics: delete existing rows for this (tab, user), then
    // insert the new set. An empty set = full revoke.
    const del = await sb(`tab_class_access?tab_name=eq.${encodeURIComponent(tab_name)}&user_id=eq.${encodeURIComponent(granteeId)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error });
    if (clean.length) {
      const ins = await sb('tab_class_access', 'POST', clean.map(cs => ({ tab_name, user_id: granteeId, class: cs.class, section: cs.section, group: cs.group })));
      if (ins?.error) return NextResponse.json({ result: 'error', message: ins.error });
    }
    return NextResponse.json({ result: 'success', count: clean.length });
  }

  // ── Tab ↔ Field Category live link — a simpler alternative to manually
  // picking users for Data Access / Class Access on this one tab: whoever
  // holds ANY of the linked categories (via field_access_grants)
  // automatically gets this tab's data too, re-evaluated fresh on every
  // request rather than copied once — a category grant with no row_filter
  // behaves like a global Data Access grant; one with a row_filter is
  // scoped exactly like that filter, live. A tab may link to several
  // categories at once (their grantees union together), same as one user
  // already holding several categories at once. Actually consumed by
  // exec/route.js's getMyTabDataAccess/getTabDataForUser (the self-service
  // "Student Data" card), the same consumer Data/Class Access already feed.
  if (action === 'get_tab_category_link') {
    const { tab_name } = payload || {};
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'Tab name required.' });
    const rows = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}&select=linked_categories_json`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    let categories = [];
    try { categories = JSON.parse((rows[0] && rows[0].linked_categories_json) || '[]'); } catch {}
    return NextResponse.json({ result: 'success', categories: Array.isArray(categories) ? categories : [] });
  }
  if (action === 'set_tab_category_link') {
    const { tab_name, categories } = payload || {};
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'Tab name required.' });
    const clean = [...new Set((Array.isArray(categories) ? categories : []).map(c => String(c || '').trim()).filter(Boolean))];
    const r = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}`, 'PATCH', { linked_categories_json: JSON.stringify(clean) });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', count: clean.length });
  }

  // ── Field categories (named, reusable groups of students_data columns) —
  // used both to scope a viewer's visible fields and to pick exactly which
  // columns a CSV export contains. Admin/editor-only management. ──────────
  if (action === 'get_field_categories') {
    const rows = await sb('field_categories?select=name,fields&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', categories: rows });
  }
  if (action === 'save_field_category') {
    const { name, fields } = payload;
    const cleanName = String(name || '').trim();
    if (!cleanName) return NextResponse.json({ result: 'error', message: 'Category name required.' });
    const cleanFields = Array.isArray(fields) ? [...new Set(fields.map(f => String(f || '').trim()).filter(Boolean))] : [];
    if (!cleanFields.length) return NextResponse.json({ result: 'error', message: 'Select at least one field.' });
    const existing = await sb(`field_categories?name=eq.${encodeURIComponent(cleanName)}`);
    if (existing?.error) return NextResponse.json({ result: 'error', message: existing.error });
    const rowData = { name: cleanName, fields: cleanFields, updated_at: new Date().toISOString() };
    const r = existing.length
      ? await sb(`field_categories?name=eq.${encodeURIComponent(cleanName)}`, 'PATCH', rowData)
      : await sb('field_categories', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_field_category') {
    const { name } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Category name required.' });
    // Grants referencing this category cascade-delete via the FK — no
    // separate cleanup needed here.
    const r = await sb(`field_categories?name=eq.${encodeURIComponent(name)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Field access grants (which users are viewers of which categories) —
  // a viewer's visible fields = the union of every category they're granted.
  // Replace-all semantics per user_id, same idiom as set_tab_class_access. ──
  if (action === 'get_field_access_grants') {
    const rows = await sb('field_access_grants?select=user_id,category_name,can_edit,row_filter&order=user_id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    const byUser = {};
    rows.forEach(r => { (byUser[r.user_id] = byUser[r.user_id] || []).push({ name: r.category_name, can_edit: !!r.can_edit, row_filter: r.row_filter || null }); });
    return NextResponse.json({ result: 'success', grants: Object.entries(byUser).map(([grant_user_id, categories]) => ({ user_id: grant_user_id, categories })) });
  }
  if (action === 'set_field_access_grants') {
    const { user_id: granteeId, categories } = payload;
    if (!granteeId) return NextResponse.json({ result: 'error', message: 'User required.' });
    const seen = new Set();
    const clean = (Array.isArray(categories) ? categories : [])
      .map(c => {
        // row_filter: { column: [values] } — only columns with >=1 selected
        // value are kept; an empty/missing column means "any value", so it's
        // dropped entirely rather than stored as an empty restriction.
        let rowFilter = null;
        if (c?.row_filter && typeof c.row_filter === 'object') {
          const clean_rf = {};
          Object.entries(c.row_filter).forEach(([col, vals]) => {
            if (Array.isArray(vals) && vals.length) clean_rf[col] = vals.map(v => String(v));
          });
          if (Object.keys(clean_rf).length) rowFilter = clean_rf;
        }
        return { name: String(c?.name || '').trim(), can_edit: !!c?.can_edit, row_filter: rowFilter };
      })
      .filter(c => c.name && !seen.has(c.name) && seen.add(c.name));
    const del = await sb(`field_access_grants?user_id=eq.${encodeURIComponent(granteeId)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error });
    if (clean.length) {
      const ins = await sb('field_access_grants', 'POST', clean.map(c => ({ user_id: granteeId, category_name: c.name, can_edit: c.can_edit, row_filter: c.row_filter })));
      if (ins?.error) return NextResponse.json({ result: 'error', message: 'One or more category names do not exist: ' + ins.error });
    }
    return NextResponse.json({ result: 'success', count: clean.length });
  }
  if (action === 'get_scope_column_values') {
    // Distinct values for the small set of categorical columns an admin can
    // scope a Field Category grant to (class/section/group/version) — shown
    // as checkboxes in the grant UI whenever a granted category includes
    // one of these columns.
    const rows = await sbAllRows('students_data?select=class,section,group,version');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    const sets = { class: new Set(), section: new Set(), group: new Set(), version: new Set() };
    rows.forEach(r => {
      if (r.class) sets.class.add(String(r.class).trim());
      if (r.section) sets.section.add(String(r.section).trim());
      sets.group.add(String(r.group || '').trim() || 'None');
      if (r.version) sets.version.add(String(r.version).trim());
    });
    const values = {};
    Object.entries(sets).forEach(([k, s]) => { values[k] = [...s].sort(); });
    return NextResponse.json({ result: 'success', values });
  }

  // ── Class-wide access grants (admin management) — a stronger, class-
  // scoped counterpart to the field categories above: every core field +
  // every custom tab's data for students in the granted class/section/
  // group combos, not just a named set of columns. Same replace-all-per-
  // user_id idiom as set_field_access_grants/set_tab_class_access. ────────
  if (action === 'get_class_access_grants') {
    const rows = await sb('class_access_grants?select=user_id,class,section,group,can_edit&order=user_id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    const byUser = {};
    rows.forEach(r => { (byUser[r.user_id] = byUser[r.user_id] || []).push({ class: r.class, section: r.section, group: r.group || 'None', can_edit: !!r.can_edit }); });
    return NextResponse.json({ result: 'success', grants: Object.entries(byUser).map(([user_id, class_sections]) => ({ user_id, class_sections })) });
  }
  if (action === 'set_class_access_grants') {
    const { user_id: granteeId, class_sections } = payload;
    if (!granteeId) return NextResponse.json({ result: 'error', message: 'User required.' });
    const clean = (Array.isArray(class_sections) ? class_sections : [])
      .map(cs => ({ class: String(cs.class || '').trim(), section: String(cs.section || '').trim(), group: String(cs.group || '').trim() || 'None', can_edit: !!cs.can_edit }))
      .filter(cs => cs.class && cs.section);
    const del = await sb(`class_access_grants?user_id=eq.${encodeURIComponent(granteeId)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error });
    if (clean.length) {
      const ins = await sb('class_access_grants', 'POST', clean.map(cs => ({ user_id: granteeId, class: cs.class, section: cs.section, group: cs.group, can_edit: cs.can_edit })));
      if (ins?.error) return NextResponse.json({ result: 'error', message: ins.error });
    }
    return NextResponse.json({ result: 'success', count: clean.length });
  }

  // ── Class Teacher assignments (student.class_teacher_assignments) — a
  // database-backed fallback for the Google-Sheet-driven class-teacher
  // detection in exec/route.js's _getClassTeacherAssignments: the sheet
  // stays authoritative, but any class/section it can't resolve a name for
  // (or doesn't list at all) falls back to whatever's assigned here.
  //
  // Model: one teacher (user_id) holds ANY NUMBER of class+section+criteria
  // combos at once (e.g. Mr. X is class teacher of BOTH Ten/D and
  // Ten/BS-E) — but a given combo can only ever belong to ONE teacher, so
  // "assign" is teacher-centric (save_teacher_class_assignment replaces one
  // teacher's *entire* combo list in one call) rather than per-row. extra_
  // criteria is a jsonb {column:value} object for whichever columns beyond
  // class+section narrow this specific combo (e.g. {"group":"Science"}) —
  // {} means the combo is the whole class+section, no further narrowing.
  if (action === 'get_class_teacher_assignments') {
    const rows = await sb('class_teacher_assignments?select=class,section,extra_criteria,user_id&order=class.asc,section.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', assignments: rows });
  }
  if (action === 'save_teacher_class_assignment') {
    const { user_id: assigneeId, combos } = payload;
    const cleanAssignee = String(assigneeId || '').trim();
    if (!cleanAssignee) return NextResponse.json({ result: 'error', message: 'Teacher required.' });
    const cleanCombos = (Array.isArray(combos) ? combos : [])
      .map(c => ({
        class: String(c?.class || '').trim(),
        section: String(c?.section || '').trim(),
        extra_criteria: (c?.extra_criteria && typeof c.extra_criteria === 'object' && !Array.isArray(c.extra_criteria)) ? c.extra_criteria : {},
      }))
      .filter(c => c.class && c.section);

    if (!cleanCombos.length) {
      // No combos left — fully unassign this teacher.
      const del = await sb(`class_teacher_assignments?user_id=eq.${encodeURIComponent(cleanAssignee)}`, 'DELETE');
      if (del?.error) return NextResponse.json({ result: 'error', message: del.error });
      return NextResponse.json({ result: 'success' });
    }

    // Reject any combo already claimed by a DIFFERENT teacher — compare
    // extra_criteria by normalized (sorted-key) JSON since key order isn't
    // guaranteed to match between what's stored and what the client sent.
    const normJson = (o) => JSON.stringify(Object.fromEntries(Object.entries(o || {}).sort()));
    const existing = await sb('class_teacher_assignments?select=class,section,extra_criteria,user_id');
    if (existing?.error) return NextResponse.json({ result: 'error', message: existing.error });
    for (const c of cleanCombos) {
      const clash = existing.find(e =>
        e.user_id !== cleanAssignee && e.class === c.class && e.section === c.section &&
        normJson(e.extra_criteria) === normJson(c.extra_criteria)
      );
      if (clash) {
        const extraLabel = Object.values(c.extra_criteria).join('/');
        const label = extraLabel ? `${c.class}/${c.section}/${extraLabel}` : `${c.class}/${c.section}`;
        return NextResponse.json({ result: 'error', message: `${label} is already assigned to another teacher.` });
      }
    }

    const del = await sb(`class_teacher_assignments?user_id=eq.${encodeURIComponent(cleanAssignee)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error });
    const ins = await sb('class_teacher_assignments', 'POST', cleanCombos.map(c => ({ class: c.class, section: c.section, extra_criteria: c.extra_criteria, user_id: cleanAssignee })));
    if (ins?.error) return NextResponse.json({ result: 'error', message: ins.error });
    return NextResponse.json({ result: 'success' });
  }

  // Strictly 'Admin' only (not Student Portal Admin) — this matrix controls
  // Payroll visibility among the other 4 tabs, and a delegated Student
  // Portal Admin shouldn't be able to grant themselves or others access to
  // HR-sensitive salary data by editing the matrix that gates it.
  if (action === 'get_admin_tab_visibility' || action === 'save_admin_tab_visibility') {
    const roles = await _getUserRoles(user_id);
    if (!roles.includes('Admin')) {
      return NextResponse.json({ result: 'error', message: 'Only Admin can view or change module access.' }, { status: 403 });
    }
    if (action === 'get_admin_tab_visibility') {
      const matrix = await _getAdminTabVisibility();
      return NextResponse.json({ result: 'success', tabs: Object.keys(ADMIN_TAB_ACTIONS), defaults: ADMIN_TAB_DEFAULTS, matrix });
    }
    const { matrix } = payload;
    const clean = {};
    Object.keys(ADMIN_TAB_ACTIONS).forEach(tab => {
      const roleList = Array.isArray(matrix?.[tab]) ? matrix[tab].filter(r => typeof r === 'string') : ADMIN_TAB_DEFAULTS[tab];
      clean[tab] = [...new Set(['Admin', ...roleList])];
    });
    // sbTeacher()'s POST always sends Prefer: return=minimal — an upsert via
    // on_conflict needs resolution=merge-duplicates too, so this one goes
    // through a raw fetch instead (same reason generate_classwise_fees does).
    const upRes = await fetch(`${SB_URL}/rest/v1/system_settings?on_conflict=key`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
        'Accept-Profile': 'teacher',
        'Content-Profile': 'teacher',
      },
      body: JSON.stringify({ key: 'admin_tab_visibility', value: clean }),
    });
    if (!upRes.ok) return NextResponse.json({ result: 'error', message: await upRes.text() });
    return NextResponse.json({ result: 'success', matrix: clean });
  }

  // ── Fees & Dues ───────────────────────────────────────────────────────────
  if (action === 'get_fee_types') {
    const rows = await sb('fee_types?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', fee_types: rows });
  }
  if (action === 'save_fee_type') {
    const { id, name, code, description, is_active } = payload;
    if (!name || !code) return NextResponse.json({ result: 'error', message: 'Name and code required.' });
    const rowData = { name, code, description: description || '', is_active: is_active !== false };
    const r = id
      ? await sb(`fee_types?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sb('fee_types', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_fee_type') {
    const r = await sb(`fee_types?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_fee_structures') {
    const rows = await sb('fee_structures?select=*,fee_types(name,code)&order=academic_year.desc,class.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', fee_structures: rows });
  }
  if (action === 'save_fee_structure') {
    const { id, fee_type_id, class: cls, section, academic_year, amount, collection_mode } = payload;
    if (!fee_type_id || !cls || !academic_year) return NextResponse.json({ result: 'error', message: 'Fee type, class, and academic year required.' });
    const rowData = { fee_type_id, class: cls, section: section || null, academic_year, amount: Number(amount) || 0, collection_mode: collection_mode || 'Monthly' };
    const r = id
      ? await sb(`fee_structures?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sb('fee_structures', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_fee_structure') {
    const r = await sb(`fee_structures?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_late_fee_rules') {
    const rows = await sb('late_fee_rules?select=*&order=rule_name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', rules: rows });
  }
  if (action === 'save_late_fee_rule') {
    const { id, rule_name, amount, due_day_of_month, conditions, is_active } = payload;
    if (!rule_name || !amount) return NextResponse.json({ result: 'error', message: 'Rule name and amount required.' });
    const day = Number(due_day_of_month);
    if (!day || day < 1 || day > 31) return NextResponse.json({ result: 'error', message: 'Due day must be between 1 and 31.' });
    const rowData = { rule_name, amount: Number(amount), due_day_of_month: day, conditions: conditions || '', is_active: is_active !== false };
    const r = id
      ? await sb(`late_fee_rules?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sb('late_fee_rules', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_late_fee_rule') {
    const r = await sb(`late_fee_rules?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // Applies the late fee (a fixed one-time amount, per the rule) to any
  // still-due student_fees row whose fee_month has passed due_day_of_month —
  // idempotent: only touches rows that don't already carry this rule.
  async function _applyLateFees() {
    const today = new Date();
    const day = today.getDate();
    const rules = await sb('late_fee_rules?is_active=eq.true&select=*');
    if (rules?.error || !Array.isArray(rules)) return;
    for (const rule of rules) {
      if (day <= rule.due_day_of_month) continue;
      const due = await sb(`student_fees?status=eq.due&late_fee_rule_id=is.null&select=id,amount,active_amount`);
      if (due?.error || !Array.isArray(due)) continue;
      await Promise.all(due.map(f => sb(`student_fees?id=eq.${f.id}`, 'PATCH', {
        late_fee_rule_id: rule.id,
        amount: Number(f.amount) + Number(rule.amount),
        active_amount: Number(f.active_amount) + Number(rule.amount),
      })));
    }
  }

  if (action === 'generate_classwise_fees') {
    const { fee_type_id, class: cls, section, academic_year, fee_month } = payload;
    if (!fee_type_id || !cls || !academic_year || !fee_month) return NextResponse.json({ result: 'error', message: 'Fee type, class, academic year, and month required.' });
    const structRows = await sb(`fee_structures?fee_type_id=eq.${encodeURIComponent(fee_type_id)}&class=eq.${encodeURIComponent(cls)}&academic_year=eq.${encodeURIComponent(academic_year)}${section ? `&section=eq.${encodeURIComponent(section)}` : ''}`);
    if (structRows?.error || !structRows.length) return NextResponse.json({ result: 'error', message: 'No fee structure found for this class/year.' });
    const amount = Number(structRows[0].amount) || 0;
    const studentRows = await sb(`students_data?class=eq.${encodeURIComponent(cls)}${section ? `&section=eq.${encodeURIComponent(section)}` : ''}&select=student_id`);
    if (studentRows?.error) return NextResponse.json({ result: 'error', message: studentRows.error });
    const rows = studentRows.map(s => ({ student_id: s.student_id, fee_type_id, academic_year, fee_month, amount, active_amount: amount, deferred_amount: 0 }));
    if (!rows.length) return NextResponse.json({ result: 'error', message: 'No students found for this class.' });
    // on_conflict skip: a student already billed for this fee/month is left untouched.
    const ins = await fetch(`${SB_URL}/rest/v1/student_fees?on_conflict=student_id,fee_type_id,academic_year,fee_month`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'student', Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify(rows),
    });
    const insText = await ins.text();
    if (!ins.ok) return NextResponse.json({ result: 'error', message: insText });
    const created = insText ? JSON.parse(insText) : [];
    return NextResponse.json({ result: 'success', generated: created.length, skipped: rows.length - created.length });
  }
  if (action === 'generate_individual_fee') {
    const { student_id, fee_type_id, academic_year, fee_month } = payload;
    if (!student_id || !fee_type_id || !academic_year || !fee_month) return NextResponse.json({ result: 'error', message: 'Student, fee type, academic year, and month required.' });
    const studentRows = await sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=class,section`);
    if (studentRows?.error || !studentRows.length) return NextResponse.json({ result: 'error', message: 'Student not found.' });
    const { class: cls, section } = studentRows[0];
    const structRows = await sb(`fee_structures?fee_type_id=eq.${encodeURIComponent(fee_type_id)}&class=eq.${encodeURIComponent(cls)}&academic_year=eq.${encodeURIComponent(academic_year)}`);
    if (structRows?.error || !structRows.length) return NextResponse.json({ result: 'error', message: 'No fee structure found for this student\'s class/year.' });
    const amount = Number(structRows[0].amount) || 0;
    const r = await sb('student_fees', 'POST', { student_id, fee_type_id, academic_year, fee_month, amount, active_amount: amount, deferred_amount: 0 });
    if (r?.error) return NextResponse.json({ result: 'error', message: 'Already generated for this month, or: ' + r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'remove_individual_fee') {
    const { student_fee_id } = payload;
    if (!student_fee_id) return NextResponse.json({ result: 'error', message: 'student_fee_id required.' });
    const r = await sb(`student_fees?id=eq.${encodeURIComponent(student_fee_id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'set_discount') {
    const { student_id, fee_type_id, discount_type, value, reason } = payload;
    if (!student_id || !value) return NextResponse.json({ result: 'error', message: 'Student and value required.' });
    const r = await sb('fee_discounts', 'POST', { student_id, fee_type_id: fee_type_id || null, discount_type: discount_type || 'fixed', value: Number(value), reason: reason || '' });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_discounts') {
    const { student_id } = payload;
    const rows = await sb(`fee_discounts?${student_id ? `student_id=eq.${encodeURIComponent(student_id)}&` : ''}select=*&order=created_at.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', discounts: rows });
  }

  // Splits amount between the active (billable now) and deferred portions of
  // one student_fees row, per the demo's "Partial Payments" behaviour.
  if (action === 'set_partial_split') {
    const { student_fee_id, active_amount } = payload;
    const feeRows = await sb(`student_fees?id=eq.${encodeURIComponent(student_fee_id)}&select=amount`);
    if (feeRows?.error || !feeRows.length) return NextResponse.json({ result: 'error', message: 'Fee not found.' });
    const total = Number(feeRows[0].amount);
    const active = Number(active_amount);
    if (!(active > 0) || active > total) return NextResponse.json({ result: 'error', message: 'Active amount must be between 0 and the total fee.' });
    const r = await sb(`student_fees?id=eq.${encodeURIComponent(student_fee_id)}`, 'PATCH', { active_amount: active, deferred_amount: total - active });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'record_payment') {
    const { student_fee_id, amount, method, receipt_no } = payload;
    if (!student_fee_id || !amount) return NextResponse.json({ result: 'error', message: 'student_fee_id and amount required.' });
    const feeRows = await sb(`student_fees?id=eq.${encodeURIComponent(student_fee_id)}&select=*`);
    if (feeRows?.error || !feeRows.length) return NextResponse.json({ result: 'error', message: 'Fee not found.' });
    const fee = feeRows[0];
    const pay = Number(amount);
    const ins = await sb('fee_payments', 'POST', { student_fee_id, amount: pay, method: method || 'Manual', receipt_no: receipt_no || '' });
    if (ins?.error) return NextResponse.json({ result: 'error', message: ins.error });
    // Paying off the active portion in full activates the deferred portion
    // (moves it into active_amount) and marks the row paid if nothing is left.
    const remainingActive = Number(fee.active_amount) - pay;
    const patch = remainingActive > 0
      ? { active_amount: remainingActive }
      : (Number(fee.deferred_amount) > 0
          ? { active_amount: Number(fee.deferred_amount) + (remainingActive < 0 ? remainingActive : 0), deferred_amount: 0 }
          : { active_amount: 0, status: 'paid' });
    const upd = await sb(`student_fees?id=eq.${encodeURIComponent(student_fee_id)}`, 'PATCH', patch);
    if (upd?.error) return NextResponse.json({ result: 'error', message: upd.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_student_fees') {
    const { student_id } = payload;
    if (!student_id) return NextResponse.json({ result: 'error', message: 'student_id required.' });
    await _applyLateFees().catch(() => {});
    const rows = await sb(`student_fees?student_id=eq.${encodeURIComponent(student_id)}&select=*,fee_types(name,code)&order=academic_year.desc,fee_month.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', fees: rows });
  }

  if (action === 'get_defaulters_list') {
    const { class: cls, academic_year } = payload || {};
    const rows = await sb(`student_fees?status=eq.due${cls ? '' : ''}&select=student_id,fee_type_id,academic_year,fee_month,active_amount,fee_types(name)&order=student_id.asc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    let filtered = rows.filter(r => Number(r.active_amount) > 0 && (!academic_year || r.academic_year === academic_year));
    if (cls) {
      const idsInClass = new Set((await sb(`students_data?class=eq.${encodeURIComponent(cls)}&select=student_id`)).map(s => s.student_id));
      filtered = filtered.filter(r => idsInClass.has(r.student_id));
    }
    return NextResponse.json({ result: 'success', defaulters: filtered });
  }
  if (action === 'get_fees_collection_report') {
    const { academic_year } = payload || {};
    const payRows = await sb(`fee_payments?select=amount,paid_at,student_fees(fee_type_id,academic_year,fee_types(name))&order=paid_at.desc`);
    if (payRows?.error) return NextResponse.json({ result: 'error', message: payRows.error });
    const filtered = academic_year ? payRows.filter(p => p.student_fees?.academic_year === academic_year) : payRows;
    const byType = {};
    filtered.forEach(p => {
      const name = p.student_fees?.fee_types?.name || 'Unknown';
      byType[name] = (byType[name] || 0) + Number(p.amount);
    });
    const total = filtered.reduce((s, p) => s + Number(p.amount), 0);
    return NextResponse.json({ result: 'success', total, by_fee_type: byType, transactions: filtered });
  }

  if (action === 'get_fee_accounts') {
    const rows = await sb('fee_accounts?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', accounts: rows });
  }
  if (action === 'save_fee_account') {
    const { id, name, type, opening_balance } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const rowData = { name, type: type || 'bank', opening_balance: Number(opening_balance) || 0 };
    const r = id
      ? await sb(`fee_accounts?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sb('fee_accounts', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'record_account_transaction') {
    const { account_id, direction, amount, counterparty_account_id, reference } = payload;
    if (!account_id || !direction || !amount) return NextResponse.json({ result: 'error', message: 'Account, direction, and amount required.' });
    const r = await sb('fee_account_transactions', 'POST', { account_id, direction, amount: Number(amount), counterparty_account_id: counterparty_account_id || null, reference: reference || '' });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_account_register') {
    const { account_id } = payload || {};
    const rows = await sb(`fee_account_transactions?${account_id ? `account_id=eq.${encodeURIComponent(account_id)}&` : ''}select=*&order=occurred_at.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', transactions: rows });
  }

  // ── Attendance ────────────────────────────────────────────────────────────
  // ESP32/NFC (student.attendance_records) stays the primary channel — a row
  // present for a student+date means present, no row means absent unless a
  // manual override says otherwise. Devices/punch-log below are for optional
  // additional hardware (e.g. ZKTeco), never a replacement for ESP32.
  if (action === 'get_attendance_report') {
    const { class: cls, section, date } = payload || {};
    if (!date) return NextResponse.json({ result: 'error', message: 'date required.' });
    const roster = await sb(`students_data?class=eq.${encodeURIComponent(cls || '')}${section ? `&section=eq.${encodeURIComponent(section)}` : ''}&select=student_id,student_name,roll&order=roll.asc`);
    if (roster?.error) return NextResponse.json({ result: 'error', message: roster.error });
    const [present, overrides] = await Promise.all([
      sb(`attendance_records?date=eq.${encodeURIComponent(date)}&select=student_id,entry_time`),
      sb(`manual_attendance_overrides?date=eq.${encodeURIComponent(date)}&select=student_id,status,reason`),
    ]);
    const presentSet = new Set((Array.isArray(present) ? present : []).map(p => p.student_id));
    const overrideMap = {};
    (Array.isArray(overrides) ? overrides : []).forEach(o => { overrideMap[o.student_id] = o; });
    const rows = roster.map(s => {
      const ov = overrideMap[s.student_id];
      const status = ov ? ov.status : (presentSet.has(s.student_id) ? 'present' : 'absent');
      return { student_id: s.student_id, student_name: s.student_name, roll: s.roll, status, source: ov ? 'manual' : (presentSet.has(s.student_id) ? 'device' : 'none') };
    });
    const presentCount = rows.filter(r => r.status === 'present').length;
    return NextResponse.json({ result: 'success', date, rows, present_count: presentCount, absent_count: rows.length - presentCount });
  }
  if (action === 'save_manual_attendance') {
    const { student_id, date, status, marked_by, reason } = payload;
    if (!student_id || !date || !status) return NextResponse.json({ result: 'error', message: 'student_id, date, and status required.' });
    const rowData = { student_id, date, status, marked_by: marked_by || null, reason: reason || '' };
    const existing = await sb(`manual_attendance_overrides?student_id=eq.${encodeURIComponent(student_id)}&date=eq.${encodeURIComponent(date)}`);
    const r = (!existing?.error && existing.length)
      ? await sb(`manual_attendance_overrides?student_id=eq.${encodeURIComponent(student_id)}&date=eq.${encodeURIComponent(date)}`, 'PATCH', rowData)
      : await sb('manual_attendance_overrides', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'save_bulk_manual_attendance') {
    const { date, marked_by, entries } = payload; // entries: [{student_id, status}]
    if (!date || !Array.isArray(entries) || !entries.length) return NextResponse.json({ result: 'error', message: 'date and entries required.' });
    await Promise.all(entries.map(async e => {
      const existing = await sb(`manual_attendance_overrides?student_id=eq.${encodeURIComponent(e.student_id)}&date=eq.${encodeURIComponent(date)}`);
      const rowData = { student_id: e.student_id, date, status: e.status, marked_by: marked_by || null };
      return (!existing?.error && existing.length)
        ? sb(`manual_attendance_overrides?student_id=eq.${encodeURIComponent(e.student_id)}&date=eq.${encodeURIComponent(date)}`, 'PATCH', rowData)
        : sb('manual_attendance_overrides', 'POST', rowData);
    }));
    return NextResponse.json({ result: 'success', count: entries.length });
  }

  if (action === 'get_staff_attendance_report') {
    const { date } = payload || {};
    if (!date) return NextResponse.json({ result: 'error', message: 'date required.' });
    const dayStart = `${date}T00:00:00`, dayEnd = `${date}T23:59:59`;
    const rows = await sb(`attendance_punch_log?person_type=eq.staff&punch_time=gte.${encodeURIComponent(dayStart)}&punch_time=lte.${encodeURIComponent(dayEnd)}&select=*&order=punch_time.asc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', punches: rows });
  }

  if (action === 'get_attendance_devices') {
    const rows = await sb('attendance_devices?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', devices: rows });
  }
  if (action === 'save_attendance_device') {
    const { id, name, device_type, ip, port, firmware_password, api_username, api_password, sync_interval, is_active, description } = payload;
    if (!name || !ip) return NextResponse.json({ result: 'error', message: 'Device name and IP required.' });
    const rowData = { name, device_type: device_type || 'esp32', ip, port: Number(port) || null, firmware_password: firmware_password || null, api_username: api_username || null, api_password: api_password || null, sync_interval: Number(sync_interval) || 30, is_active: is_active !== false, description: description || '' };
    const r = id
      ? await sb(`attendance_devices?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sb('attendance_devices', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_attendance_device') {
    const r = await sb(`attendance_devices?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_punch_log') {
    const { person_type, from_date, to_date } = payload || {};
    let q = 'attendance_punch_log?select=*&order=punch_time.desc&limit=500';
    if (person_type) q += `&person_type=eq.${encodeURIComponent(person_type)}`;
    if (from_date) q += `&punch_time=gte.${encodeURIComponent(from_date)}`;
    if (to_date) q += `&punch_time=lte.${encodeURIComponent(to_date)}`;
    const rows = await sb(q);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', punches: rows, unmatched_count: rows.filter(r => !r.matched).length });
  }

  // ── Exam & Assessment ─────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  // Exams — pattern-based curriculum setup + weighted multi-component
  // results. All tables live in the `exam` Postgres schema (sbExam), not
  // `student` — see the plan for the full rationale. Pipeline order:
  // Term Setup → Class Setup → Subject Setup → Class-Subject Marks Setup →
  // Exam Pattern Setup → Exam Setup → Marks Entry Setup → Marks Entry →
  // Result Process. Grade Setup / Board Exam Records are unrelated trailing
  // tabs, unchanged in behavior — only their table moved schema.
  // ══════════════════════════════════════════════════════════════════════

  function _gradeFor(scales, mark) {
    const m = Number(mark);
    const hit = scales.find(s => m >= Number(s.min_mark) && m <= Number(s.max_mark));
    return hit || null;
  }

  // A Class Pattern's real class+section combos (crosscheck data from Class
  // Setup), each carrying the `session` it was mapped under.
  async function _classPatternRowsForPattern(patternId) {
    const rows = await sbExam(`class_pattern_map?pattern_id=eq.${encodeURIComponent(patternId)}&select=class,section,session`);
    return Array.isArray(rows) ? rows : [];
  }

  // Real students belonging to a pattern — grouped by class+section (one
  // fetch per unique combo) then filtered to just the session(s) that combo
  // was actually mapped under, so two sections sharing a class+section but
  // mapped under different sessions never cross-contaminate each other.
  async function _studentsForPattern(patternId) {
    const triples = await _classPatternRowsForPattern(patternId);
    if (!triples.length) return [];
    const groups = new Map();
    triples.forEach(t => {
      const key = `${t.class}||${t.section}`;
      if (!groups.has(key)) groups.set(key, { class: t.class, section: t.section, sessions: new Set() });
      groups.get(key).sessions.add(String(t.session || '').trim());
    });
    const list = [...groups.values()];
    const pages = await Promise.all(list.map(g =>
      sbAllRows(`students_data?class=eq.${encodeURIComponent(g.class)}&section=eq.${encodeURIComponent(g.section)}&select=student_id,student_name,roll,class,section,session`)
    ));
    const out = [];
    list.forEach((g, i) => {
      const rows = Array.isArray(pages[i]) ? pages[i] : [];
      rows.forEach(s => { if (g.sessions.has(String(s.session || '').trim())) out.push(s); });
    });
    return out;
  }

  async function _subjectsForPattern(patternId) {
    const rows = await sbExam(`subject_pattern_map?pattern_id=eq.${encodeURIComponent(patternId)}&select=subjects(id,name)`);
    if (rows?.error || !Array.isArray(rows)) return [];
    return rows.map(r => r.subjects).filter(Boolean);
  }

  async function _componentsForSubject(patternId, subjectId) {
    const rows = await sbExam(`subject_components?pattern_id=eq.${encodeURIComponent(patternId)}&subject_id=eq.${encodeURIComponent(subjectId)}&select=*,exam_component_types(id,name)&order=sort_order.asc`);
    return Array.isArray(rows) ? rows : [];
  }

  // ── Term Setup ────────────────────────────────────────────────────────
  if (action === 'get_exam_terms') {
    const { include_archived } = payload || {};
    const rows = await sbExam(`exam_terms?${include_archived ? '' : 'is_archived=eq.false&'}select=*&order=id.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', terms: rows });
  }
  if (action === 'save_exam_term') {
    const { id, name, term_type, academic_year, medium } = payload;
    if (!name || !academic_year) return NextResponse.json({ result: 'error', message: 'Name and academic year required.' });
    const rowData = { name, term_type: term_type || 'Term', academic_year, medium: medium || null };
    const r = id
      ? await sbExam(`exam_terms?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbExam('exam_terms', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'archive_exam_term') {
    const { id, archived } = payload;
    const r = await sbExam(`exam_terms?id=eq.${encodeURIComponent(id)}`, 'PATCH', { is_archived: archived !== false });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Class Setup — crosscheck-only class+section+session list from the
  // real roster, each assignable to a Class Pattern via dropdown ─────────
  if (action === 'get_class_pattern_setup') {
    const [studentRows, mapRows, patterns] = await Promise.all([
      sbAllRows('students_data?select=class,section,session'),
      sbExam('class_pattern_map?select=*'),
      sbExam('class_patterns?select=*&order=name.asc'),
    ]);
    if (studentRows?.error) return NextResponse.json({ result: 'error', message: studentRows.error });
    const seen = new Map();
    studentRows.forEach(r => {
      const cls = String(r.class || '').trim(), sec = String(r.section || '').trim();
      if (!cls || !sec) return;
      const session = String(r.session || '').trim();
      const key = `${cls}||${sec}||${session}`;
      if (!seen.has(key)) seen.set(key, { class: cls, section: sec, session, count: 0 });
      seen.get(key).count++;
    });
    const mapByKey = new Map((Array.isArray(mapRows) ? mapRows : []).map(m => [`${m.class}||${m.section}||${m.session}`, m]));
    const rows = [...seen.values()]
      .map(r => ({ ...r, pattern_id: mapByKey.get(`${r.class}||${r.section}||${r.session}`)?.pattern_id || null }))
      .sort((a, b) => a.class.localeCompare(b.class, undefined, { numeric: true }) || a.section.localeCompare(b.section));
    return NextResponse.json({ result: 'success', rows, patterns: Array.isArray(patterns) ? patterns : [] });
  }
  if (action === 'get_class_patterns') {
    const rows = await sbExam('class_patterns?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', patterns: rows });
  }
  if (action === 'save_class_pattern') {
    const { id, name } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const r = id
      ? await sbExam(`class_patterns?id=eq.${encodeURIComponent(id)}`, 'PATCH', { name })
      : await sbExam('class_patterns', 'POST', { name });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', pattern: Array.isArray(r) ? r[0] : r });
  }
  if (action === 'save_class_pattern_map') {
    const { class: cls, section, session, pattern_id } = payload;
    if (!cls || !section) return NextResponse.json({ result: 'error', message: 'Class and section required.' });
    const sess = session || '';
    const existing = await sbExam(`class_pattern_map?class=eq.${encodeURIComponent(cls)}&section=eq.${encodeURIComponent(section)}&session=eq.${encodeURIComponent(sess)}`);
    const rowData = { class: cls, section, session: sess, pattern_id: pattern_id || null };
    const r = (!existing?.error && existing.length)
      ? await sbExam(`class_pattern_map?id=eq.${existing[0].id}`, 'PATCH', rowData)
      : await sbExam('class_pattern_map', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  // Counts what a delete would affect before the frontend commits to it —
  // class_pattern_map rows just get unassigned (pattern_id set null), but
  // subject_pattern_map/subject_components cascade-delete on the FK, and an
  // exam using this pattern would too, which is real result data. Deletion
  // is blocked outright when exams exist rather than silently cascading.
  if (action === 'get_class_pattern_usage') {
    const { id } = payload;
    const [mapRows, subjRows, examRows] = await Promise.all([
      sbExam(`class_pattern_map?pattern_id=eq.${encodeURIComponent(id)}&select=id`),
      sbExam(`subject_pattern_map?pattern_id=eq.${encodeURIComponent(id)}&select=id`),
      sbExam(`exams?pattern_id=eq.${encodeURIComponent(id)}&select=id`),
    ]);
    return NextResponse.json({
      result: 'success',
      class_sections: Array.isArray(mapRows) ? mapRows.length : 0,
      subjects: Array.isArray(subjRows) ? subjRows.length : 0,
      exams: Array.isArray(examRows) ? examRows.length : 0,
    });
  }
  if (action === 'delete_class_pattern') {
    const { id } = payload;
    const examRows = await sbExam(`exams?pattern_id=eq.${encodeURIComponent(id)}&select=id`);
    if (Array.isArray(examRows) && examRows.length) {
      return NextResponse.json({ result: 'error', message: `${examRows.length} exam(s) use this pattern — archive or reassign them first.` });
    }
    const r = await sbExam(`class_patterns?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Subject Setup — global subject catalog + per-pattern checklist ────
  if (action === 'get_subjects') {
    const rows = await sbExam('subjects?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', subjects: rows });
  }
  if (action === 'save_subject') {
    const { id, name } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const r = id
      ? await sbExam(`subjects?id=eq.${encodeURIComponent(id)}`, 'PATCH', { name })
      : await sbExam('subjects', 'POST', { name });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_subject') {
    const r = await sbExam(`subjects?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_subject_pattern_map') {
    const [patterns, mapRows] = await Promise.all([
      sbExam('class_patterns?select=*&order=name.asc'),
      sbExam('subject_pattern_map?select=subject_id,pattern_id'),
    ]);
    return NextResponse.json({ result: 'success', patterns: Array.isArray(patterns) ? patterns : [], map: Array.isArray(mapRows) ? mapRows : [] });
  }
  if (action === 'save_subject_pattern_map') {
    const { subject_id, pattern_id, checked } = payload;
    if (!subject_id || !pattern_id) return NextResponse.json({ result: 'error', message: 'Subject and pattern required.' });
    if (checked) {
      const existing = await sbExam(`subject_pattern_map?subject_id=eq.${encodeURIComponent(subject_id)}&pattern_id=eq.${encodeURIComponent(pattern_id)}`);
      if (!existing?.error && !existing.length) {
        const r = await sbExam('subject_pattern_map', 'POST', { subject_id, pattern_id });
        if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
      }
    } else {
      // Deliberately does NOT touch subject_components — unchecking hides
      // the subject from this pattern's Marks Setup list, it never deletes
      // the component/weight config already entered for the pair.
      const r = await sbExam(`subject_pattern_map?subject_id=eq.${encodeURIComponent(subject_id)}&pattern_id=eq.${encodeURIComponent(pattern_id)}`, 'DELETE');
      if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    }
    return NextResponse.json({ result: 'success' });
  }

  // ── Class-Subject Marks Setup — the standing per-(pattern,subject)
  // component/weight breakdown, reused across every term until changed ──
  if (action === 'get_exam_component_types') {
    const rows = await sbExam('exam_component_types?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', types: rows });
  }
  if (action === 'save_exam_component_type') {
    const { name } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const existing = await sbExam(`exam_component_types?name=eq.${encodeURIComponent(name)}`);
    if (!existing?.error && existing.length) return NextResponse.json({ result: 'success', type: existing[0] });
    const r = await sbExam('exam_component_types', 'POST', { name });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', type: Array.isArray(r) ? r[0] : r });
  }
  if (action === 'get_subject_components_setup') {
    const { pattern_id } = payload;
    if (!pattern_id) return NextResponse.json({ result: 'error', message: 'Pattern required.' });
    const subjects = await _subjectsForPattern(pattern_id);
    const comps = await Promise.all(subjects.map(s => _componentsForSubject(pattern_id, s.id)));
    const out = subjects.map((s, i) => ({ ...s, components: comps[i] }));
    return NextResponse.json({ result: 'success', subjects: out });
  }
  if (action === 'save_subject_component') {
    const { id, pattern_id, subject_id, component_type_id, full_marks, pass_marks, weight_percent, sort_order } = payload;
    if (!pattern_id || !subject_id || !component_type_id) return NextResponse.json({ result: 'error', message: 'Pattern, subject and component type required.' });
    const rowData = { pattern_id, subject_id, component_type_id, full_marks: Number(full_marks) || 0, pass_marks: Number(pass_marks) || 0, weight_percent: Number(weight_percent) || 0, sort_order: Number(sort_order) || 0 };
    const r = id
      ? await sbExam(`subject_components?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbExam('subject_components', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_subject_component') {
    const r = await sbExam(`subject_components?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Exam Pattern Setup — reusable subset-of-components-per-occasion ────
  if (action === 'get_exam_patterns') {
    const rows = await sbExam('exam_patterns?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', patterns: rows });
  }
  if (action === 'save_exam_pattern') {
    const { id, name, active_component_type_ids, enforce_component_pass_gate } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const rowData = { name, active_component_type_ids: Array.isArray(active_component_type_ids) ? active_component_type_ids : [], enforce_component_pass_gate: enforce_component_pass_gate !== false };
    const r = id
      ? await sbExam(`exam_patterns?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbExam('exam_patterns', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'duplicate_exam_pattern') {
    const { id } = payload;
    const rows = await sbExam(`exam_patterns?id=eq.${encodeURIComponent(id)}`);
    if (rows?.error || !rows.length) return NextResponse.json({ result: 'error', message: 'Exam pattern not found.' });
    const src = rows[0];
    const r = await sbExam('exam_patterns', 'POST', { name: `Copy of ${src.name}`, active_component_type_ids: src.active_component_type_ids, enforce_component_pass_gate: src.enforce_component_pass_gate });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', pattern: Array.isArray(r) ? r[0] : r });
  }
  if (action === 'delete_exam_pattern') {
    const r = await sbExam(`exam_patterns?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Exam Setup — one row per (Term × Class Pattern) sitting ───────────
  if (action === 'get_exams') {
    const { include_archived } = payload || {};
    const rows = await sbExam(`exams?${include_archived ? '' : 'is_archived=eq.false&'}select=*,exam_terms(name,term_type,academic_year,is_archived),class_patterns(name),exam_patterns(name)&order=id.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', exams: rows });
  }
  if (action === 'save_exam') {
    const { id, term_id, pattern_id, exam_pattern_id } = payload;
    if (!term_id || !pattern_id) return NextResponse.json({ result: 'error', message: 'Term and class pattern required.' });
    const rowData = { term_id, pattern_id, exam_pattern_id: exam_pattern_id || null };
    const r = id
      ? await sbExam(`exams?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbExam('exams', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'lock_exam') {
    const { id, locked } = payload;
    const r = await sbExam(`exams?id=eq.${encodeURIComponent(id)}`, 'PATCH', { is_locked: locked !== false });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'archive_exam') {
    const { id, archived } = payload;
    const r = await sbExam(`exams?id=eq.${encodeURIComponent(id)}`, 'PATCH', { is_archived: archived !== false });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  // Clones exam_pattern_id + every entry-sheet's subject+component+open+
  // assigned "intent" (deduped across sections, since bulk-open applies the
  // same intent to every section anyway) onto the TARGET pattern's own real
  // sections — not a literal row copy, so this still works correctly even
  // when duplicating into a different Class Pattern than the source exam.
  if (action === 'duplicate_exam') {
    const { id, term_id, pattern_id } = payload;
    if (!term_id || !pattern_id) return NextResponse.json({ result: 'error', message: 'Target term and pattern required.' });
    const rows = await sbExam(`exams?id=eq.${encodeURIComponent(id)}`);
    if (rows?.error || !rows.length) return NextResponse.json({ result: 'error', message: 'Source exam not found.' });
    const src = rows[0];
    const created = await sbExam('exams', 'POST', { term_id, pattern_id, exam_pattern_id: src.exam_pattern_id });
    if (created?.error) return NextResponse.json({ result: 'error', message: created.error });
    const newExam = Array.isArray(created) ? created[0] : created;

    const srcSheets = await sbExam(`exam_entry_sheets?exam_id=eq.${encodeURIComponent(id)}&select=subject_id,component_type_id,is_open,assigned_user_id`);
    const intents = new Map();
    (Array.isArray(srcSheets) ? srcSheets : []).forEach(s => intents.set(`${s.subject_id}||${s.component_type_id}`, s));
    const newSections = [...new Map((await _classPatternRowsForPattern(pattern_id)).map(s => [`${s.class}||${s.section}`, s])).values()];
    const newRows = [];
    intents.forEach(intent => newSections.forEach(sec => newRows.push({
      exam_id: newExam.id, subject_id: intent.subject_id, component_type_id: intent.component_type_id,
      class: sec.class, section: sec.section, is_open: intent.is_open, assigned_user_id: intent.assigned_user_id,
    })));
    if (newRows.length) await Promise.all(newRows.map(r => sbExam('exam_entry_sheets', 'POST', r)));
    return NextResponse.json({ result: 'success', exam: newExam });
  }

  // ── Marks Entry Setup — which subject+component+section sheets are open
  // for this exam, and who's assigned to each ────────────────────────────
  if (action === 'get_exam_entry_sheets') {
    const { exam_id } = payload;
    const examRows = await sbExam(`exams?id=eq.${encodeURIComponent(exam_id)}&select=*,exam_patterns(active_component_type_ids)`);
    if (examRows?.error || !examRows.length) return NextResponse.json({ result: 'error', message: 'Exam not found.' });
    const examRow = examRows[0];
    const activeTypeIds = new Set((examRow.exam_patterns?.active_component_type_ids || []).map(String));
    const [subjects, sectionRows, existing] = await Promise.all([
      _subjectsForPattern(examRow.pattern_id),
      _classPatternRowsForPattern(examRow.pattern_id),
      sbExam(`exam_entry_sheets?exam_id=eq.${encodeURIComponent(exam_id)}&select=*`),
    ]);
    const uniqueSections = [...new Map(sectionRows.map(s => [`${s.class}||${s.section}`, s])).values()];
    const existingMap = new Map((Array.isArray(existing) ? existing : []).map(e => [`${e.subject_id}||${e.component_type_id}||${e.class}||${e.section}`, e]));
    const rows = [];
    for (const sub of subjects) {
      const comps = (await _componentsForSubject(examRow.pattern_id, sub.id)).filter(c => activeTypeIds.has(String(c.component_type_id)));
      for (const c of comps) {
        for (const sec of uniqueSections) {
          const ex = existingMap.get(`${sub.id}||${c.component_type_id}||${sec.class}||${sec.section}`);
          rows.push({ subject_id: sub.id, subject_name: sub.name, component_type_id: c.component_type_id, component_name: c.exam_component_types?.name || '', class: sec.class, section: sec.section, is_open: ex ? ex.is_open : false, assigned_user_id: ex ? ex.assigned_user_id : null });
        }
      }
    }
    return NextResponse.json({ result: 'success', rows });
  }
  if (action === 'save_exam_entry_sheets_bulk') {
    const { exam_id, subject_id, component_type_id, sections, is_open, assigned_user_id } = payload; // sections: [{class,section}]
    if (!exam_id || !subject_id || !component_type_id || !Array.isArray(sections)) return NextResponse.json({ result: 'error', message: 'exam_id, subject_id, component_type_id, sections required.' });
    const results = await Promise.all(sections.map(async sec => {
      const existing = await sbExam(`exam_entry_sheets?exam_id=eq.${encodeURIComponent(exam_id)}&subject_id=eq.${encodeURIComponent(subject_id)}&component_type_id=eq.${encodeURIComponent(component_type_id)}&class=eq.${encodeURIComponent(sec.class)}&section=eq.${encodeURIComponent(sec.section)}`);
      const rowData = { exam_id, subject_id, component_type_id, class: sec.class, section: sec.section, is_open: !!is_open, assigned_user_id: assigned_user_id || null };
      return (!existing?.error && existing.length)
        ? sbExam(`exam_entry_sheets?id=eq.${existing[0].id}`, 'PATCH', rowData)
        : sbExam('exam_entry_sheets', 'POST', rowData);
    }));
    const errors = results.filter(r => r?.error);
    return NextResponse.json({ result: errors.length ? 'partial' : 'success' });
  }

  // ── Marks Entry — component-scoped, atomic upsert, trigger-maintained
  // history (see exam._exam_marks_history in the schema) ────────────────
  if (action === 'get_exam_marks_for_entry') {
    const { exam_id, subject_id, component_type_id, class: cls, section } = payload;
    const roster = await sb(`students_data?class=eq.${encodeURIComponent(cls)}${section ? `&section=eq.${encodeURIComponent(section)}` : ''}&select=student_id,student_name,roll&order=roll.asc`);
    if (roster?.error) return NextResponse.json({ result: 'error', message: roster.error });
    const marksRows = await sbExam(`exam_marks?exam_id=eq.${encodeURIComponent(exam_id)}&subject_id=eq.${encodeURIComponent(subject_id)}&component_type_id=eq.${encodeURIComponent(component_type_id)}&select=student_id,marks_obtained,update_history`);
    const marksMap = {};
    (Array.isArray(marksRows) ? marksRows : []).forEach(m => { marksMap[m.student_id] = m; });
    return NextResponse.json({ result: 'success', roster: roster.map(s => ({ ...s, marks_obtained: marksMap[s.student_id]?.marks_obtained ?? '', update_history: marksMap[s.student_id]?.update_history || [] })) });
  }
  if (action === 'save_exam_marks_bulk') {
    const { exam_id, subject_id, component_type_id, marks } = payload; // marks: [{student_id, marks_obtained}]
    if (!exam_id || !subject_id || !component_type_id || !Array.isArray(marks)) return NextResponse.json({ result: 'error', message: 'exam_id, subject_id, component_type_id and marks required.' });
    const rows = marks.map(m => ({
      exam_id, subject_id, component_type_id, student_id: m.student_id,
      marks_obtained: m.marks_obtained === '' || m.marks_obtained === undefined ? null : Number(m.marks_obtained),
      updated_by: user_id,
    }));
    const r = await sbExam(
      'exam_marks?on_conflict=exam_id,subject_id,component_type_id,student_id',
      'POST', rows,
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', saved: marks.length });
  }

  // ── Result Process — weighted component blend per subject, then the
  // same total/percentage/grade/pass-fail/position aggregation as before ─
  if (action === 'process_exam_result') {
    const { exam_id } = payload;
    const examRows = await sbExam(`exams?id=eq.${encodeURIComponent(exam_id)}&select=*,exam_patterns(id,name,active_component_type_ids,enforce_component_pass_gate)`);
    if (examRows?.error || !examRows.length) return NextResponse.json({ result: 'error', message: 'Exam not found.' });
    const examRow = examRows[0];
    if (examRow.is_locked) return NextResponse.json({ result: 'error', message: 'Exam is locked — unlock it first.' });
    const ep = examRow.exam_patterns;
    if (!ep) return NextResponse.json({ result: 'error', message: 'This exam has no Exam Pattern attached — set one in Exam Setup first.' });
    const activeTypeIds = new Set((ep.active_component_type_ids || []).map(String));
    if (!activeTypeIds.size) return NextResponse.json({ result: 'error', message: 'The attached Exam Pattern has no active component types selected.' });

    const [subjects, students, marksRows, scales] = await Promise.all([
      _subjectsForPattern(examRow.pattern_id),
      _studentsForPattern(examRow.pattern_id),
      sbExam(`exam_marks?exam_id=eq.${encodeURIComponent(exam_id)}&select=subject_id,component_type_id,student_id,marks_obtained`),
      sbExam('grade_scales?category=eq.default&select=*'),
    ]);
    if (!subjects.length) return NextResponse.json({ result: 'error', message: 'No subjects are set up for this pattern yet.' });
    if (!students.length) return NextResponse.json({ result: 'error', message: "No students found for this pattern's classes." });
    if (marksRows?.error) return NextResponse.json({ result: 'error', message: marksRows.error });

    const componentsBySubject = {};
    await Promise.all(subjects.map(async sub => {
      const all = await _componentsForSubject(examRow.pattern_id, sub.id);
      componentsBySubject[sub.id] = all.filter(c => activeTypeIds.has(String(c.component_type_id)));
    }));

    const marksMap = {};
    (Array.isArray(marksRows) ? marksRows : []).forEach(m => {
      marksMap[m.subject_id] = marksMap[m.subject_id] || {};
      marksMap[m.subject_id][m.component_type_id] = marksMap[m.subject_id][m.component_type_id] || {};
      marksMap[m.subject_id][m.component_type_id][m.student_id] = m.marks_obtained;
    });
    const scaleRows = Array.isArray(scales) ? scales : [];

    const results = students.map(stu => {
      let total = 0, fullTotal = 0, anyFail = false;
      const breakdown = [];
      subjects.forEach(sub => {
        const comps = componentsBySubject[sub.id] || [];
        if (!comps.length) return; // no active components for this subject this occasion — excluded
        let weightedSum = 0, weightSum = 0, gateFail = false, aggregatePassWeighted = 0;
        const compBreakdown = comps.map(c => {
          const marks = Number((marksMap[sub.id]?.[c.component_type_id]?.[stu.student_id]) ?? 0);
          const full = Number(c.full_marks) || 0, weight = Number(c.weight_percent) || 0, pass = Number(c.pass_marks) || 0;
          weightedSum += full ? (marks / full * weight) : 0;
          weightSum += weight;
          aggregatePassWeighted += full ? (pass / full * weight) : 0;
          if (marks < pass) gateFail = true;
          return { name: c.exam_component_types?.name || '', marks, full, weight, pass };
        });
        const weightedPct = weightSum ? (weightedSum / weightSum * 100) : 0;
        const subjectFullMarks = comps.reduce((s, c) => s + (Number(c.full_marks) || 0), 0);
        const subjectFinal = weightedPct / 100 * subjectFullMarks;
        const subjectPass = ep.enforce_component_pass_gate
          ? !gateFail
          : weightedPct >= (weightSum ? (aggregatePassWeighted / weightSum * 100) : 0);
        if (!subjectPass) anyFail = true;
        total += subjectFinal;
        fullTotal += subjectFullMarks;
        breakdown.push({ subject: sub.name, components: compBreakdown, weighted_pct: Math.round(weightedPct * 100) / 100, subject_final: Math.round(subjectFinal * 100) / 100, subject_full_marks: subjectFullMarks, pass: subjectPass });
      });
      const pct = fullTotal ? (total / fullTotal) * 100 : 0;
      const grade = _gradeFor(scaleRows, pct);
      return {
        student_id: stu.student_id, student_name: stu.student_name, roll: stu.roll,
        total: Math.round(total * 100) / 100, percentage: Math.round(pct * 100) / 100,
        gpa: grade ? grade.gp : 0, letter_grade: anyFail ? 'F' : (grade ? grade.letter_grade : ''),
        pass: !anyFail, breakdown,
      };
    }).sort((a, b) => b.total - a.total).map((r, i) => ({ ...r, position: i + 1 }));

    return NextResponse.json({ result: 'success', results });
  }

  // ── Grade Setup (unchanged behavior, table moved to `exam` schema) ─────
  if (action === 'get_grade_scales') {
    const { category } = payload || {};
    const rows = await sbExam(`grade_scales?${category ? `category=eq.${encodeURIComponent(category)}&` : ''}select=*&order=min_mark.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', scales: rows });
  }
  if (action === 'save_grade_scale') {
    const { id, category, gp, min_mark, max_mark, letter_grade, label } = payload;
    if (gp === undefined || min_mark === undefined || max_mark === undefined || !letter_grade) return NextResponse.json({ result: 'error', message: 'GP, mark range, and letter grade required.' });
    const rowData = { category: category || 'default', gp: Number(gp), min_mark: Number(min_mark), max_mark: Number(max_mark), letter_grade, label: label || '' };
    const r = id
      ? await sbExam(`grade_scales?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbExam('grade_scales', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'delete_grade_scale') {
    const r = await sbExam(`grade_scales?id=eq.${encodeURIComponent(payload.id)}`, 'DELETE');
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Board Exam Records (unchanged behavior, table moved to `exam` schema;
  // roster lookup stays against `student` — students_data didn't move) ────
  if (action === 'save_board_exam_record') {
    const { id, student_id, board_exam_type, registration_number, roll_number, academic_year } = payload;
    if (!student_id || !board_exam_type) return NextResponse.json({ result: 'error', message: 'Student and board exam type required.' });
    const rowData = { student_id, board_exam_type, registration_number: registration_number || null, roll_number: roll_number || null, academic_year: academic_year || null };
    const r = id
      ? await sbExam(`board_exam_records?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbExam('board_exam_records', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_board_exam_records') {
    const { class: cls, section } = payload || {};
    let studentIds = null;
    if (cls) {
      const roster = await sb(`students_data?class=eq.${encodeURIComponent(cls)}${section ? `&section=eq.${encodeURIComponent(section)}` : ''}&select=student_id,student_name,roll`);
      if (!roster?.error) studentIds = roster;
    }
    const rows = await sbExam('board_exam_records?select=*');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    if (studentIds) {
      const idSet = new Set(studentIds.map(s => s.student_id));
      return NextResponse.json({ result: 'success', roster: studentIds, records: rows.filter(r => idSet.has(r.student_id)) });
    }
    return NextResponse.json({ result: 'success', roster: [], records: rows });
  }

  // ── HRM & Payroll ─────────────────────────────────────────────────────────
  // People-data (users_profile, family_details, faculty_attributes,
  // bank_accounts) already exists — this is payroll specifically, kept
  // separate from teacher.bonus_penalty (performance eval, not salary).
  if (action === 'get_salary_structures') {
    const rows = await sbTeacher('salary_structures?select=*&order=designation.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', structures: rows });
  }
  if (action === 'save_salary_structure') {
    const { id, designation, basic, allowances, deductions } = payload;
    if (!designation || basic === undefined) return NextResponse.json({ result: 'error', message: 'Designation and basic salary required.' });
    const rowData = { designation, basic: Number(basic), allowances: allowances || {}, deductions: deductions || {} };
    const existing = await sbTeacher(`salary_structures?designation=eq.${encodeURIComponent(designation)}`);
    const r = (!existing?.error && existing.length)
      ? await sbTeacher(`salary_structures?designation=eq.${encodeURIComponent(designation)}`, 'PATCH', rowData)
      : await sbTeacher('salary_structures', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_payroll_runs') {
    const rows = await sbTeacher('payroll_runs?select=*&order=year.desc,month.desc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', runs: rows });
  }
  // Generates one payslip per active staff member with a salary structure
  // matching their designation, for the given month/year. Re-running an
  // existing (unpaid) run recomputes each payslip rather than duplicating.
  if (action === 'run_payroll') {
    const { month, year } = payload;
    if (!month || !year) return NextResponse.json({ result: 'error', message: 'Month and year required.' });
    const existingRun = await sbTeacher(`payroll_runs?month=eq.${encodeURIComponent(month)}&year=eq.${encodeURIComponent(year)}`);
    let run = (!existingRun?.error && existingRun.length) ? existingRun[0] : null;
    if (run && run.status === 'paid') return NextResponse.json({ result: 'error', message: 'This payroll run is already paid — cannot re-run.' });
    if (!run) {
      const created = await sbTeacher('payroll_runs', 'POST', { month, year, status: 'draft' });
      if (created?.error) return NextResponse.json({ result: 'error', message: created.error });
      run = created[0];
    }
    const [staff, structures] = await Promise.all([
      sbTeacher('app_users?select=user_id,role'),
      sbTeacher('salary_structures?select=*'),
    ]);
    if (staff?.error || structures?.error) return NextResponse.json({ result: 'error', message: 'Could not load staff/salary data.' });
    const structByDesignation = {};
    structures.forEach(s => { structByDesignation[s.designation] = s; });
    let generated = 0;
    for (const u of staff) {
      const roles = String(u.role || '').split(',').map(r => r.trim());
      const struct = roles.map(r => structByDesignation[r]).find(Boolean);
      if (!struct) continue;
      const allowanceTotal = Object.values(struct.allowances || {}).reduce((s, v) => s + Number(v || 0), 0);
      const deductionTotal = Object.values(struct.deductions || {}).reduce((s, v) => s + Number(v || 0), 0);
      const gross = Number(struct.basic) + allowanceTotal;
      const net = gross - deductionTotal;
      const rowData = { payroll_run_id: run.id, teacher_id: u.user_id, gross, total_deductions: deductionTotal, net };
      const existingSlip = await sbTeacher(`payslips?payroll_run_id=eq.${run.id}&teacher_id=eq.${encodeURIComponent(u.user_id)}`);
      if (!existingSlip?.error && existingSlip.length) await sbTeacher(`payslips?payroll_run_id=eq.${run.id}&teacher_id=eq.${encodeURIComponent(u.user_id)}`, 'PATCH', rowData);
      else await sbTeacher('payslips', 'POST', rowData);
      generated++;
    }
    return NextResponse.json({ result: 'success', run_id: run.id, generated });
  }
  if (action === 'get_payslips') {
    const { payroll_run_id } = payload;
    const rows = await sbTeacher(`payslips?payroll_run_id=eq.${encodeURIComponent(payroll_run_id)}&select=*&order=teacher_id.asc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', payslips: rows });
  }
  if (action === 'mark_payroll_paid') {
    const { payroll_run_id } = payload;
    const r1 = await sbTeacher(`payroll_runs?id=eq.${encodeURIComponent(payroll_run_id)}`, 'PATCH', { status: 'paid' });
    const r2 = await sbTeacher(`payslips?payroll_run_id=eq.${encodeURIComponent(payroll_run_id)}`, 'PATCH', { paid_at: new Date().toISOString() });
    if (r1?.error || r2?.error) return NextResponse.json({ result: 'error', message: r1?.error || r2?.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_leave_types') {
    const rows = await sbTeacher('leave_types?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', types: rows });
  }
  if (action === 'save_leave_type') {
    const { name, days_allowed } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const r = await sbTeacher('leave_types', 'POST', { name, days_allowed: Number(days_allowed) || 0 });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_leave_requests') {
    const { status } = payload || {};
    const rows = await sbTeacher(`leave_requests?${status ? `status=eq.${encodeURIComponent(status)}&` : ''}select=*,leave_types(name)&order=created_at.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', requests: rows });
  }
  if (action === 'approve_leave_request') {
    const { id, status } = payload; // status: 'approved' | 'rejected'
    const r = await sbTeacher(`leave_requests?id=eq.${encodeURIComponent(id)}`, 'PATCH', { status });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  // ── Transport Mgmt (admin side only — live GPS stays in the standalone bus-
  // tracking app; this is routes/vehicles/pickup-points/fees administration) ──
  if (action === 'get_transport_routes') {
    const rows = await sb('transport_routes?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', routes: rows });
  }
  if (action === 'save_transport_route') {
    const { id, name, description, is_active } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const rowData = { name, description: description || '', is_active: is_active !== false };
    const r = id ? await sb(`transport_routes?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData) : await sb('transport_routes', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_transport_vehicles') {
    const rows = await sb('transport_vehicles?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', vehicles: rows });
  }
  if (action === 'save_transport_vehicle') {
    const { id, name, registration_no, capacity, driver_name, driver_phone, is_active } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const rowData = { name, registration_no: registration_no || '', capacity: Number(capacity) || null, driver_name: driver_name || '', driver_phone: driver_phone || '', is_active: is_active !== false };
    const r = id ? await sb(`transport_vehicles?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData) : await sb('transport_vehicles', 'POST', rowData);
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_pickup_points') {
    const rows = await sb('pickup_points?select=*&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', points: rows });
  }
  if (action === 'save_pickup_point') {
    const { name, landmark } = payload;
    if (!name) return NextResponse.json({ result: 'error', message: 'Name required.' });
    const r = await sb('pickup_points', 'POST', { name, landmark: landmark || '' });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'assign_route_pickup_point') {
    const { route_id, pickup_point_id, sequence_order } = payload;
    if (!route_id || !pickup_point_id) return NextResponse.json({ result: 'error', message: 'Route and pickup point required.' });
    const r = await sb('route_pickup_points', 'POST', { route_id, pickup_point_id, sequence_order: Number(sequence_order) || 0 });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_route_pickup_points') {
    const { route_id } = payload;
    const rows = await sb(`route_pickup_points?route_id=eq.${encodeURIComponent(route_id)}&select=*,pickup_points(name,landmark)&order=sequence_order.asc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', stops: rows });
  }

  if (action === 'assign_vehicle_to_route') {
    const { route_id, vehicle_id } = payload;
    if (!route_id || !vehicle_id) return NextResponse.json({ result: 'error', message: 'Route and vehicle required.' });
    const r = await sb('vehicle_assignments', 'POST', { route_id, vehicle_id });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_vehicle_assignments') {
    const rows = await sb('vehicle_assignments?select=*,transport_routes(name),transport_vehicles(name,registration_no)');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', assignments: rows });
  }

  if (action === 'get_transport_fee_master') {
    const rows = await sb('transport_fee_master?select=*,transport_routes(name)&order=name.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', fees: rows });
  }
  if (action === 'save_transport_fee_master') {
    const { route_id, name, amount, collection_mode } = payload;
    if (!name || !amount) return NextResponse.json({ result: 'error', message: 'Name and amount required.' });
    const r = await sb('transport_fee_master', 'POST', { route_id: route_id || null, name, amount: Number(amount), collection_mode: collection_mode || 'Monthly' });
    if (r?.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }
  // Mirrors generate_individual_fee from Fees & Dues (Phase 1) exactly, just
  // against transport_fee_master/student_transport_fees instead.
  if (action === 'generate_student_transport_fee') {
    const { student_id, transport_fee_master_id, academic_year, fee_month } = payload;
    if (!student_id || !transport_fee_master_id || !academic_year || !fee_month) return NextResponse.json({ result: 'error', message: 'All fields required.' });
    const feeRows = await sb(`transport_fee_master?id=eq.${encodeURIComponent(transport_fee_master_id)}&select=amount`);
    if (feeRows?.error || !feeRows.length) return NextResponse.json({ result: 'error', message: 'Transport fee not found.' });
    const amount = Number(feeRows[0].amount);
    const r = await sb('student_transport_fees', 'POST', { student_id, transport_fee_master_id, academic_year, fee_month, amount });
    if (r?.error) return NextResponse.json({ result: 'error', message: 'Already generated for this month, or: ' + r.error });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_student_transport_fees') {
    const { student_id } = payload;
    if (!student_id) return NextResponse.json({ result: 'error', message: 'student_id required.' });
    const rows = await sb(`student_transport_fees?student_id=eq.${encodeURIComponent(student_id)}&select=*,transport_fee_master(name)&order=academic_year.desc,fee_month.desc`);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', fees: rows });
  }

  if (action === 'get_tab_data') {
    const { tab_name } = payload;
    // Not at risk today (comfortably under the 3000-row PostgREST cap for
    // every tab so far), but paginated anyway so a popular tab crossing that
    // line later doesn't silently start dropping submissions the same way
    // the students_data roster fetches above did.
    const rows = await sbAllRows(`portal_submissions?tab_name=eq.${encodeURIComponent(tab_name)}&order=submitted_at.asc`);
    if (rows?.error || !rows.length) return NextResponse.json({ headers: ['student_id'], rows: [] });

    // Column order follows the tab's configuration (profile include-fields first,
    // then the form fields as arranged in the builder). Extra keys found only in
    // older submissions are appended at the end so no data is ever hidden.
    const tabRow = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}`);
    const cfg = (!tabRow?.error && tabRow[0]) ? tabRow[0] : null;
    const ordered = ['student_id'];
    if (cfg) {
      try {
        JSON.parse(cfg.include_fields_json || '[]').forEach(k => { if (k && !ordered.includes(k)) ordered.push(k); });
      } catch {}
      try {
        JSON.parse(cfg.fields_json || '[]').forEach(f => {
          const k = f?.data_key || f?.id;
          if (k && f.type !== 'group_label' && !ordered.includes(k)) ordered.push(k);
        });
      } catch {}
    }
    const extras = new Set();
    rows.forEach(r => Object.keys(r.data || {}).forEach(k => { if (!ordered.includes(k)) extras.add(k); }));
    const headers = [...ordered, ...extras];
    const dataRows = rows.map(r => headers.map(h => h === 'student_id' ? r.student_id : (r.data?.[h] ?? '')));
    return NextResponse.json({ headers, rows: dataRows });
  }
  // Admin's own version of the "who filled it in / who hasn't" view a class
  // teacher gets automatically for their own class (see getMyClassTabTable
  // in exec/route.js, whose field-pruning/labeling logic this mirrors) --
  // scoped to the WHOLE roster instead of one class-teacher's class, since
  // an admin needs to check across the school. Class/section/group/shift
  // narrowing happens client-side against this one fetch (same pattern as
  // every other filter/sort control already built for this feature family)
  // rather than a param here, so toggling checkboxes needs no round-trip.
  if (action === 'get_tab_submission_status') {
    const { tab_name } = payload;
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'Tab required.' });
    // Filterable columns are discovered the same way Assign Class Teacher's
    // dynamic combo picker does (get_class_sections above, CT_EXCLUDED_COLS)
    // — every real students_data column except identity/system/free-text
    // ones and per-student personal traits, so a school adding e.g. a new
    // "session" or "department" column shows up here automatically, with no
    // hardcoded list of "the columns that matter" to keep in sync.
    const headerRows = await sb('students_data?limit=1');
    if (headerRows?.error || !headerRows.length) return NextResponse.json({ result: 'error', message: 'No students found.' });
    const filterCols = Object.keys(headerRows[0]).filter(c => !CT_EXCLUDED_COLS.has(c));
    const [roster, subRows, tabRow] = await Promise.all([
      sbAllRows(`students_data?select=student_id,student_name,class,section,roll,gender,${filterCols.map(encodeURIComponent).join(',')}`),
      sbAllRows(`portal_submissions?tab_name=eq.${encodeURIComponent(tab_name)}&select=student_id,data`),
      sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}&select=fields_json`),
    ]);
    if (roster?.error) return NextResponse.json({ result: 'error', message: roster.error });
    const rosterArr = Array.isArray(roster) ? roster : [];
    const cfg = (!tabRow?.error && Array.isArray(tabRow) && tabRow[0]) ? tabRow[0] : null;
    let fields = [];
    try { fields = JSON.parse(cfg?.fields_json || '[]'); } catch {}
    let currentGroup = '';
    const dataFields = [];
    fields.forEach(f => {
      if (f.type === 'group_label') { currentGroup = f.label || ''; return; }
      if (f.data_key) dataFields.push({ ...f, _group: currentGroup });
    });
    const bareLabel = f => f.name || f.label || f.data_key;
    const subByStudent = {};
    (Array.isArray(subRows) ? subRows : []).forEach(s => { subByStudent[s.student_id] = s.data || {}; });
    const usedFields = dataFields.filter(f => rosterArr.some(s => {
      const v = (subByStudent[s.student_id] || {})[f.data_key];
      return v !== undefined && v !== null && v !== '';
    }));
    const labelCounts = {};
    usedFields.forEach(f => { const l = bareLabel(f); labelCounts[l] = (labelCounts[l] || 0) + 1; });
    const labelFor = f => (labelCounts[bareLabel(f)] > 1 && f._group) ? `${f._group}: ${bareLabel(f)}` : bareLabel(f);
    const headers = ['Roll', 'Name', 'Class', 'Section', ...usedFields.map(labelFor)];
    const dataRows2 = rosterArr.map(s => {
      const data = subByStudent[s.student_id] || {};
      return [s.roll || '', s.student_name || '', s.class || '', s.section || '', ...usedFields.map(f => data[f.data_key] ?? '')];
    });
    const sortMeta = rosterArr.map(s => {
      const meta = { roll: s.roll, student_name: s.student_name, class: s.class || '', section: s.section || '', gender: s.gender };
      filterCols.forEach(c => { meta[c] = s[c] || 'None'; });
      return meta;
    });
    const filled = rosterArr.map(s => subByStudent.hasOwnProperty(s.student_id));
    return NextResponse.json({ result: 'success', headers, rows: dataRows2, sort_meta: sortMeta, filled, filter_cols: filterCols });
  }
  if (action === 'get_student_data_headers') {
    const rows = await sb('students_data?limit=1');
    if (!rows?.error && rows.length) return NextResponse.json(Object.keys(rows[0]));
    return NextResponse.json(['student_id', 'student_name', 'class', 'section', 'roll']);
  }

  // ── Search / bulk-update / category download — editor (full-admin) path.
  // The viewer-only equivalents of search_students and
  // download_students_by_category live earlier, right after the access
  // gate, and return before execution ever reaches here. ──────────────────
  if (action === 'search_students') {
    const { student_id, class: cls, section, roll, group } = payload || {};
    const rows = await _searchStudents({ student_id, class: cls, section, roll, group }, null);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', rows });
  }
  if (action === 'bulk_update_students') {
    const { student_ids, updates } = payload;
    const ids = Array.isArray(student_ids) ? [...new Set(student_ids.map(s => String(s || '').trim()).filter(Boolean))] : [];
    if (!ids.length) return NextResponse.json({ result: 'error', message: 'Select at least one student.' });

    const rawUpdates = (updates && typeof updates === 'object') ? updates : {};
    const newStudentId = String(rawUpdates.student_id || '').trim();
    const cleanUpdates = Object.fromEntries(
      Object.entries(rawUpdates).filter(([k, v]) => k !== 'student_id' && k !== 'id' && v !== '' && v !== null && v !== undefined)
    );

    // Renaming the Student ID itself is a separate, atomic operation (cascades
    // across every table that references it — see student.rename_student_id)
    // and only makes sense for exactly one student at a time.
    let targetIds = ids;
    if (newStudentId && newStudentId !== ids[0]) {
      if (ids.length !== 1) return NextResponse.json({ result: 'error', message: 'Select exactly one student to change their Student ID.' });
      const renameRes = await sb('rpc/rename_student_id', 'POST', { p_old_id: ids[0], p_new_id: newStudentId });
      if (renameRes?.error) {
        let msg = 'Could not change Student ID.';
        try { const e = JSON.parse(renameRes.error); msg = e.code === '23505' ? `Student ID "${newStudentId}" is already in use by another student.` : (e.message || msg); } catch {}
        return NextResponse.json({ result: 'error', message: msg });
      }
      targetIds = [newStudentId];
    }

    if (!Object.keys(cleanUpdates).length) {
      return NextResponse.json({ result: 'success', updated: newStudentId ? 1 : 0, errors: [] });
    }
    // students_data's UPDATE trigger writes to student.edit_history automatically — no extra audit code needed here.
    const { updated, errors } = await _bulkPatchStudents(targetIds, cleanUpdates);
    return NextResponse.json({ result: errors.length ? 'partial' : 'success', updated, errors });
  }
  if (action === 'preview_rename_student_id_impact') {
    const { student_id } = payload || {};
    if (!student_id) return NextResponse.json({ result: 'error', message: 'Student ID required.' });
    const impact = await sb('rpc/preview_rename_student_id_impact', 'POST', { p_old_id: student_id });
    if (impact?.error) return NextResponse.json({ result: 'error', message: 'Could not check impact.' });
    return NextResponse.json({ result: 'success', impact: impact || {} });
  }
  if (action === 'create_student') {
    const { student_id, ...fields } = payload || {};
    const cleanId = String(student_id || '').trim();
    if (!cleanId) return NextResponse.json({ result: 'error', message: 'Student ID is required.' });
    const cleanFields = Object.fromEntries(Object.entries(fields).filter(([k, v]) => k !== 'id' && v !== '' && v !== null && v !== undefined));
    const r = await sb('students_data', 'POST', { student_id: cleanId, ...cleanFields });
    if (r?.error) {
      let msg = 'Could not create student.';
      try { const e = JSON.parse(r.error); msg = e.code === '23505' ? `Student ID "${cleanId}" already exists.` : (e.message || msg); } catch {}
      return NextResponse.json({ result: 'error', message: msg });
    }
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'download_students_by_category') {
    const { category_name, student_id, class: cls, section, roll, group, extra_columns, extra_filter } = payload || {};
    if (!category_name) return NextResponse.json({ result: 'error', message: 'Category required.' });
    let cleanExtraFilter = null;
    if (extra_filter && typeof extra_filter === 'object') {
      const entries = Object.entries(extra_filter).filter(([, v]) => Array.isArray(v) && v.length);
      if (entries.length) cleanExtraFilter = Object.fromEntries(entries);
    }
    const out = await _downloadByCategory(category_name, { student_id, class: cls, section, roll, group }, cleanExtraFilter, extra_columns);
    return NextResponse.json(out);
  }

  // ── Profile: editable fields + promote/unpromote tabs ──────────────────
  if (action === 'get_editable_fields') {
    const setRows = await sb('portal_settings?key=eq.editable_profile_fields');
    let fields = [];
    try { fields = JSON.parse((setRows && !setRows.error && setRows[0]?.value) || '[]'); } catch (_) {}
    return NextResponse.json({ fields: Array.isArray(fields) ? fields : [] });
  }
  if (action === 'save_editable_fields') {
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    const r = await psSave('editable_profile_fields', JSON.stringify(fields));
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'get_profile_sections') {
    const rows = await sb('portal_settings?key=eq.profile_sections');
    let sections = [];
    try { sections = JSON.parse((rows && !rows.error && rows[0]?.value) || '[]'); } catch (_) {}
    return NextResponse.json({ sections: Array.isArray(sections) ? sections : [] });
  }
  if (action === 'promote_tab_to_profile') {
    const { tab_name } = payload;
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'tab_name required.' });
    const tabRows = await sb(`portal_tabs?tab_name=eq.${encodeURIComponent(tab_name)}`);
    if (tabRows?.error || !tabRows.length) return NextResponse.json({ result: 'error', message: 'Tab not found.' });
    let fields = [];
    try { fields = JSON.parse(tabRows[0].fields_json || '[]'); } catch (_) {}
    const valid = /^[a-z][a-z0-9_]{0,62}$/;
    const inputFields = fields.filter(f => f.type !== 'group_label' && f.data_key && valid.test(f.data_key));
    const cols = inputFields.map(f => f.data_key);
    if (cols.length === 0) return NextResponse.json({ result: 'error', message: 'No valid fields to add.' });

    const addRes = await sb('rpc/add_profile_columns', 'POST', { cols });
    if (addRes?.error) return NextResponse.json({ result: 'error', message: 'Could not add columns: ' + (addRes.error.message || addRes.error) });
    const syncRes = await sb('rpc/sync_tab_to_columns', 'POST', { p_tab: tab_name, keys: cols });
    if (syncRes?.error) return NextResponse.json({ result: 'error', message: 'Columns added but backfill failed: ' + (syncRes.error.message || syncRes.error) });

    const secRows = await sb('portal_settings?key=eq.profile_sections');
    let sections = [];
    try { sections = JSON.parse((secRows && !secRows.error && secRows[0]?.value) || '[]'); } catch (_) {}
    const fieldMeta = inputFields.map(f => ({ data_key: f.data_key, label: f.name || f.data_key, type: f.type || 'text', options: f.options || [], show_if: f.show_if || null }));
    const title = tab_name.charAt(0).toUpperCase() + tab_name.slice(1).replace(/_/g, ' ');
    sections = (Array.isArray(sections) ? sections : []).filter(s => s.tab_name !== tab_name);
    sections.push({ tab_name, title, fields: fieldMeta });
    const secSave = await psSave('profile_sections', JSON.stringify(sections));
    if (!secSave.ok) return NextResponse.json({ result: 'error', message: 'Columns added but profile section save failed: ' + secSave.message });

    return NextResponse.json({ result: 'success', added: cols.length, columns: cols });
  }
  if (action === 'unpromote_tab_from_profile') {
    const { tab_name } = payload;
    if (!tab_name) return NextResponse.json({ result: 'error', message: 'tab_name required.' });
    const secRows = await sb('portal_settings?key=eq.profile_sections');
    let sections = [];
    try { sections = JSON.parse((secRows && !secRows.error && secRows[0]?.value) || '[]'); } catch (_) {}
    sections = (Array.isArray(sections) ? sections : []).filter(s => s.tab_name !== tab_name);
    const r = await psSave('profile_sections', JSON.stringify(sections));
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success' });
  }

  // ── Bulk import students ─────────────────────────────────────────────────
  if (action === 'preview_bulk_import') {
    const ids = Array.isArray(payload.student_ids) ? [...new Set(payload.student_ids.map(String).filter(Boolean))] : [];
    if (ids.length === 0) return NextResponse.json({ result: 'error', message: 'No Student IDs found in the mapped file.' });
    const existing = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const rows = await sb(`students_data?student_id=in.(${chunk.map(encodeURIComponent).join(',')})&select=student_id`);
      if (!rows?.error) rows.forEach(r => existing.add(String(r.student_id)));
    }
    return NextResponse.json({
      result: 'success',
      totalCount: ids.length,
      existingCount: existing.size,
      newCount: ids.length - existing.size,
    });
  }
  if (action === 'bulk_import_new_students') {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const updateExisting = !!payload.update_existing;
    if (rows.length === 0) return NextResponse.json({ result: 'error', message: 'No rows to import.' });

    const schemaRows = await sb('students_data?limit=1');
    if (schemaRows?.error || !schemaRows.length) return NextResponse.json({ result: 'error', message: 'Could not read student schema.' });
    const allowedCols = new Set(Object.keys(schemaRows[0]).filter(c => c !== 'id'));

    let skippedMissingId = 0;
    const seenInFile = new Set();
    let skippedDuplicateInFile = 0;
    const clean = [];
    for (const row of rows) {
      const sid = String(row.student_id || '').trim();
      if (!sid) { skippedMissingId++; continue; }
      if (seenInFile.has(sid)) { skippedDuplicateInFile++; continue; }
      seenInFile.add(sid);
      const cleanRow = {};
      for (const [k, v] of Object.entries(row)) {
        if (allowedCols.has(k) && v !== '' && v !== null && v !== undefined) cleanRow[k] = v;
      }
      cleanRow.student_id = sid;
      clean.push(cleanRow);
    }

    const ids = clean.map(r => r.student_id);
    const existing = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const existRows = await sb(`students_data?student_id=in.(${chunk.map(encodeURIComponent).join(',')})&select=student_id`);
      if (!existRows?.error) existRows.forEach(r => existing.add(String(r.student_id)));
    }
    const toInsert = clean.filter(r => !existing.has(r.student_id));
    const toUpdate = updateExisting ? clean.filter(r => existing.has(r.student_id)) : [];

    let inserted = 0;
    const insertErrors = [];
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      const res = await sb('students_data', 'POST', chunk);
      if (res?.error) insertErrors.push(res.error);
      else inserted += chunk.length;
    }

    let updated = 0;
    const updateErrors = [];
    for (let i = 0; i < toUpdate.length; i += 20) {
      const chunk = toUpdate.slice(i, i + 20);
      const results = await Promise.all(chunk.map(row => {
        const { student_id, ...fields } = row;
        if (Object.keys(fields).length === 0) return Promise.resolve({ skipped: true });
        return sb(`students_data?student_id=eq.${encodeURIComponent(student_id)}`, 'PATCH', fields);
      }));
      results.forEach(r => { if (r?.error) updateErrors.push(r.error); else if (!r?.skipped) updated++; });
    }

    return NextResponse.json({
      result: (insertErrors.length || updateErrors.length) ? 'partial' : 'success',
      inserted, updated,
      skipped_existing: updateExisting ? 0 : existing.size,
      skipped_missing_id: skippedMissingId,
      skipped_duplicate_in_file: skippedDuplicateInFile,
      errors: [...insertErrors, ...updateErrors],
    });
  }

  // ── Tracking config: GP credentials + bus/place registry ────────────────
  if (action === 'get_tracking_config') {
    const rows = await sb('portal_settings?key=in.(bus_registry,place_registry,gp_credentials)');
    if (rows?.error) return NextResponse.json({});
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    const creds = map.gp_credentials || {};
    return NextResponse.json({
      busRegistry:   (map.bus_registry   || []).map(r => [r.name, r.imei]),
      placeRegistry: (map.place_registry || []).map(r => [r.name, r.coords, r.radius]),
      credentials:   { username: creds.username || '', password: creds.password ? '********' : '', environment: creds.environment || 'production', apiKey: creds.api_key || '' },
    });
  }
  if (action === 'save_bus_registry') {
    const value = (payload.rows || []).map(r => ({ name: r[0], imei: r[1] }));
    const r = await psSave('bus_registry', value);
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'save_place_registry') {
    const value = (payload.rows || []).map(r => ({ name: r[0], coords: r[1], radius: r[2] }));
    const r = await psSave('place_registry', value);
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success' });
  }
  if (action === 'set_gp_credentials') {
    const { username, password, channel, environment, apiKey } = payload;
    const existing = await sb('portal_settings?key=eq.gp_credentials');
    const prevPass = (!existing?.error && existing[0]) ? existing[0].value?.password || '' : '';
    const pass = (password === '********' || !password) ? prevPass : password;
    const api_key = apiKey || (username && pass ? btoa(`${username}:${pass}`) : '');
    const value = { username, password: pass, channel: channel || 'ALOEXT', environment: environment || 'production', api_key };
    const r = await psSave('gp_credentials', value);
    if (!r.ok) return NextResponse.json({ result: 'error', message: r.message });
    return NextResponse.json({ result: 'success', message: `Credentials updated. Environment: ${(environment || 'production').toUpperCase()}` });
  }
  if (action === 'test_gp_connection') {
    try {
      const rows = await sb('portal_settings?key=eq.gp_credentials');
      const settings = (!rows?.error && rows[0]) ? rows[0].value : {};
      await getGPToken(settings);
      return NextResponse.json({ result: 'success', message: 'Connection verified. Token received.' });
    } catch (e) {
      return NextResponse.json({ result: 'error', message: e.message });
    }
  }
  // get_bus_data: not admin-exclusive (the student-facing bus tracker uses it
  // too), but showAdminPanel()'s own "Bus Tracker" nav pane calls
  // BusTracking.initBusMap() -> this same action, so the ported console needs
  // it too or that pane silently shows nothing.
  if (action === 'get_bus_data') {
    try {
      const rows = await sb('portal_settings?key=in.(gp_credentials,bus_registry)');
      if (rows?.error) return NextResponse.json({ result: 'error', message: 'Settings not found.' });
      const sm = {};
      rows.forEach(r => { sm[r.key] = r.value; });
      const creds = sm.gp_credentials || {};
      const busRegistry = sm.bus_registry || [];
      if (!busRegistry.length) return NextResponse.json({ result: 'success', data: [], trackers: 0, dataAge: 0 });

      const items = await queryGPLocations(creds, busRegistry.map(b => String(b.imei)));
      const dataMap = {};
      items.forEach(d => { dataMap[d.imei] = d; });

      const buses = busRegistry.map(b => {
        const d = dataMap[b.imei] || {};
        const spd = parseFloat(d.speed || 0);
        return {
          name: b.name, imei: b.imei,
          lat: parseFloat(d.latitude || 0),
          lng: parseFloat(d.longitude || 0),
          speed: String(spd), isMoving: spd > 2,
          engine: !!d.engineStatus,
          address: d.address || 'Unknown location',
          time: d.locationTime || '',
          heading: d.heading || 0,
        };
      });

      return NextResponse.json({ result: 'success', data: buses, trackers: 0, dataAge: 0 });
    } catch (e) {
      return NextResponse.json({ result: 'error', message: e.message });
    }
  }

  if (action === 'check_bus') {
    try {
      const rows = await sb('portal_settings?key=eq.gp_credentials');
      const settings = (!rows?.error && rows[0]) ? rows[0].value : {};
      const items = await queryGPLocations(settings, [String(payload.imei)]);
      const d = items[0];
      if (d && (d.latitude || d.longitude)) {
        return NextResponse.json({ result: 'success', data: { address: d.address || 'Unknown', speed: d.speed || 0, engine: d.engineStatus ? 'ON' : 'OFF', time: d.locationTime || '' } });
      }
      return NextResponse.json({ result: 'error', message: d ? 'Device found but has no location fix yet.' : 'No data returned for this IMEI.' });
    } catch (e) {
      return NextResponse.json({ result: 'error', message: e.message });
    }
  }

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}
