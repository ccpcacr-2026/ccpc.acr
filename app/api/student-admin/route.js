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
// 'Admin' (controls everything) OR 'Student Portal Admin' (delegated, this module only).
async function _isAdmin(userId) {
  if (!userId) return false;
  const res = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' },
  });
  if (!res.ok) return false;
  const rows = await res.json();
  const role = Array.isArray(rows) && rows[0] ? rows[0].role : '';
  const roles = String(role || '').split(',').map(r => r.trim());
  return roles.includes('Admin') || roles.includes('Student Portal Admin');
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
async function _searchStudents(filters, projectFields) {
  const f = filters || {};
  const clauses = [];
  if (f.student_id) clauses.push(`student_id=eq.${encodeURIComponent(f.student_id)}`);
  if (f.class) clauses.push(`class=eq.${encodeURIComponent(f.class)}`);
  if (f.section) clauses.push(`section=eq.${encodeURIComponent(f.section)}`);
  if (f.roll) clauses.push(`roll=eq.${encodeURIComponent(f.roll)}`);
  if (f.group) clauses.push(`group=eq.${encodeURIComponent(f.group)}`);
  const select = (Array.isArray(projectFields) && projectFields.length)
    ? projectFields.map(encodeURIComponent).join(',')
    : '*';
  const query = `students_data?${clauses.length ? clauses.join('&') + '&' : ''}select=${select}&order=class.asc,section.asc,roll.asc&limit=500`;
  return sb(query);
}

// Looks up a category's field list, then runs _searchStudents projected to
// exactly those fields (+ student_id), returning CSV-ready {headers, rows}
// where rows are arrays in the same order as headers — this direct
// field-list-to-column mapping is what guarantees the downloaded file
// matches the selected category.
async function _downloadByCategory(categoryName, filters) {
  const catRows = await sb(`field_categories?name=eq.${encodeURIComponent(categoryName)}&select=fields`);
  if (catRows?.error) return { result: 'error', message: catRows.error };
  if (!catRows.length) return { result: 'error', message: 'Category not found.' };
  const catFields = Array.isArray(catRows[0].fields) ? catRows[0].fields : [];
  const headers = catFields.includes('student_id') ? catFields : ['student_id', ...catFields];
  const rows = await _searchStudents(filters, headers);
  if (rows?.error) return { result: 'error', message: rows.error };
  return { result: 'success', headers, rows: rows.map(r => headers.map(h => r[h] ?? '')) };
}

// Actions a restricted viewer (not a full Admin) may call. Everything else
// on this route still requires _isAdmin, exactly as before this feature.
const VIEWER_SAFE_ACTIONS = new Set(['get_my_access', 'search_students', 'download_students_by_category', 'viewer_bulk_update_students']);

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ result: 'error', message: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;

  const isAdmin = await _isAdmin(user_id);
  let viewerCategories = [];
  if (!isAdmin) {
    if (!VIEWER_SAFE_ACTIONS.has(action)) {
      return NextResponse.json({ result: 'error', message: 'Admin access required.' }, { status: 403 });
    }
    viewerCategories = await _getViewerCategories(user_id);
    if (!viewerCategories.length) {
      return NextResponse.json({ result: 'error', message: 'No data access has been granted to this account.' }, { status: 403 });
    }
  }

  // ── Viewer-only actions (isAdmin === false, viewerCategories is non-empty) ──
  if (!isAdmin && action === 'get_my_access') {
    const fields = await _getViewerFields(user_id);
    const editableFields = await _getEditorFields(user_id);
    return NextResponse.json({ result: 'success', categories: viewerCategories, fields, editable_fields: editableFields });
  }
  if (!isAdmin && action === 'search_students') {
    const fields = await _getViewerFields(user_id);
    const rows = await _searchStudents(payload, fields);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    return NextResponse.json({ result: 'success', headers: fields, rows });
  }
  if (!isAdmin && action === 'download_students_by_category') {
    const { category_name } = payload;
    if (!viewerCategories.includes(category_name)) {
      return NextResponse.json({ result: 'error', message: 'That category has not been granted to this account.' }, { status: 403 });
    }
    return NextResponse.json(await _downloadByCategory(category_name, payload));
  }
  if (!isAdmin && action === 'viewer_bulk_update_students') {
    const editableFields = await _getEditorFields(user_id);
    if (!editableFields.length) {
      return NextResponse.json({ result: 'error', message: 'You do not have edit access to any category.' }, { status: 403 });
    }
    const { student_ids, updates } = payload;
    const ids = Array.isArray(student_ids) ? [...new Set(student_ids.map(s => String(s || '').trim()).filter(Boolean))] : [];
    // Silently drop any key outside the grantee's editable fields — this is
    // the server-side enforcement of "editor can edit only their granted
    // category's fields", never trusting what the client claims it's editing.
    const cleanUpdates = (updates && typeof updates === 'object') ? Object.fromEntries(
      Object.entries(updates).filter(([k, v]) => editableFields.includes(k) && k !== 'student_id' && v !== '' && v !== null && v !== undefined)
    ) : {};
    if (!ids.length) return NextResponse.json({ result: 'error', message: 'Select at least one student.' });
    if (!Object.keys(cleanUpdates).length) return NextResponse.json({ result: 'error', message: 'Set at least one field you have edit access to.' });
    const { updated, errors } = await _bulkPatchStudents(ids, cleanUpdates);
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
  // handleStudentPhotoSelect in student-admin.html, copied from the
  // equivalent teacher-photo flow (ccpc-teachers/_src/app.js handlePhotoSelect
  // / uploadPhotoToDrive in exec/route.js), just targeting a different bucket.
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
    // app_users, shortname resolved live from the routine sheet (best-effort).
    const hdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher' };
    const [profRes, userRes, shortnames] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/users_profile?select=teacher_id,full_name,phone,whatsapp&order=full_name.asc&limit=1000`, { headers: hdrs }),
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
        shortname: shortnames[_normalizeName(p.full_name)] || '',
        phone: p.phone || p.whatsapp || u.phone || '',
        email: u.email || '',
        role: u.role || '',
      };
    }).sort((a, b) => (a.full_name || a.user_id).localeCompare(b.full_name || b.user_id));
    return NextResponse.json(out);
  }
  if (action === 'get_class_sections') {
    // PostgREST has no distinct param on plain selects — fetch all triples and
    // dedupe here (a few thousand tiny rows, fine).
    const rows = await sb('students_data?select=class,section,group&limit=10000');
    if (rows?.error) return NextResponse.json([]);
    const seen = new Set();
    const out = [];
    rows.forEach(r => {
      const cls = String(r.class || '').trim(), sec = String(r.section || '').trim();
      const grp = String(r.group || '').trim() || 'None';
      if (!cls || !sec) return;
      const key = `${cls}|${sec}|${grp}`;
      if (!seen.has(key)) { seen.add(key); out.push({ class: cls, section: sec, group: grp }); }
    });
    out.sort((a, b) => a.class.localeCompare(b.class) || a.section.localeCompare(b.section) || a.group.localeCompare(b.group));
    return NextResponse.json(out);
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
    const rows = await sb('field_access_grants?select=user_id,category_name,can_edit&order=user_id.asc');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error });
    const byUser = {};
    rows.forEach(r => { (byUser[r.user_id] = byUser[r.user_id] || []).push({ name: r.category_name, can_edit: !!r.can_edit }); });
    return NextResponse.json({ result: 'success', grants: Object.entries(byUser).map(([grant_user_id, categories]) => ({ user_id: grant_user_id, categories })) });
  }
  if (action === 'set_field_access_grants') {
    const { user_id: granteeId, categories } = payload;
    if (!granteeId) return NextResponse.json({ result: 'error', message: 'User required.' });
    const seen = new Set();
    const clean = (Array.isArray(categories) ? categories : [])
      .map(c => ({ name: String(c?.name || '').trim(), can_edit: !!c?.can_edit }))
      .filter(c => c.name && !seen.has(c.name) && seen.add(c.name));
    const del = await sb(`field_access_grants?user_id=eq.${encodeURIComponent(granteeId)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error });
    if (clean.length) {
      const ins = await sb('field_access_grants', 'POST', clean.map(c => ({ user_id: granteeId, category_name: c.name, can_edit: c.can_edit })));
      if (ins?.error) return NextResponse.json({ result: 'error', message: 'One or more category names do not exist: ' + ins.error });
    }
    return NextResponse.json({ result: 'success', count: clean.length });
  }

  if (action === 'get_tab_data') {
    const { tab_name } = payload;
    const rows = await sb(`portal_submissions?tab_name=eq.${encodeURIComponent(tab_name)}&order=submitted_at.asc`);
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
    const cleanUpdates = (updates && typeof updates === 'object') ? Object.fromEntries(
      Object.entries(updates).filter(([k, v]) => k !== 'student_id' && k !== 'id' && v !== '' && v !== null && v !== undefined)
    ) : {};
    if (!ids.length) return NextResponse.json({ result: 'error', message: 'Select at least one student.' });
    if (!Object.keys(cleanUpdates).length) return NextResponse.json({ result: 'error', message: 'Set at least one field.' });
    // students_data's UPDATE trigger writes to student.edit_history automatically — no extra audit code needed here.
    const { updated, errors } = await _bulkPatchStudents(ids, cleanUpdates);
    return NextResponse.json({ result: errors.length ? 'partial' : 'success', updated, errors });
  }
  if (action === 'download_students_by_category') {
    const { category_name, student_id, class: cls, section, roll, group } = payload || {};
    if (!category_name) return NextResponse.json({ result: 'error', message: 'Category required.' });
    const out = await _downloadByCategory(category_name, { student_id, class: cls, section, roll, group });
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
