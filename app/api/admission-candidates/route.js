import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// VortiBD can reportedly take several minutes to respond on a slow request
// (not a bot-detection issue -- their own infrastructure is just sometimes
// slow) -- the function's own time budget needs raising to match, or Vercel
// kills it long before any of the longer per-request timeouts below matter.
export const maxDuration = 280;

// ── External-Candidate Exam Management ──────────────────────────────────
// Separate entity/domain from app/api/admission-admin/route.js's
// admission_applications: these candidates are never created in this
// system -- they arrive only as periodic Excel uploads from an external
// admission system, get room/seat-allocated here, and get printed/scanned
// here. Self-contained route (no shared lib/), same inline
// Accept-Profile/Content-Profile: admission REST pattern as
// admission-admin, duplicated rather than imported per this codebase's
// convention.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbAdmission(path, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      'Accept-Profile': 'admission',
      'Content-Profile': 'admission',
      ...extraHeaders,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Fresh per-request check against teacher_staff.app_users -- never trust a cached role.
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
async function _isAdmissionAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Admission Admin');
}

// ── Part 5: per-circular Admission Committee permissions ───────────────────
// Full Admins/Admission Admins bypass all of this (tabOk/scanOk below always
// pass them). A committee member has none of those roles -- their only
// access is whatever circular_committee_members.permissions grants them for
// THIS specific circular_id, re-checked fresh every request (never trusted
// from the client), same as every other role check in this codebase.
async function _getCommitteePerms(userId, circularId) {
  if (!circularId || !userId) return null;
  const rows = await sbAdmission(`circular_committee_members?circular_id=eq.${circularId}&user_id=eq.${encodeURIComponent(userId)}&select=permissions`);
  return (Array.isArray(rows) && rows[0] && rows[0].permissions) || null;
}
function _tabOk(isFullAdmin, perms, tab, level) {
  if (isFullAdmin) return true;
  const have = (perms && perms.tabs && perms.tabs[tab]) || 'none';
  return level === 'edit' ? have === 'edit' : (have === 'view' || have === 'edit');
}
function _scanOk(isFullAdmin, perms, optionKey) {
  if (isFullAdmin) return true;
  return !!(perms && Array.isArray(perms.scan_options) && perms.scan_options.includes(optionKey));
}
function _forbidden() { return NextResponse.json({ error: 'Not permitted for your committee role.' }, { status: 403 }); }

// Part 3 (VortiBD-parity "Configure Downloads") fields shared by createCircular/updateCircular.
function _admCandDownloadsConfig(payload) {
  return {
    admit_instant: payload.admit_instant === undefined ? true : !!payload.admit_instant,
    admit_release_at: payload.admit_release_at ? String(payload.admit_release_at) : null,
    admit_instructions: payload.admit_instructions ? String(payload.admit_instructions) : null,
    apply_declaration: String(payload.apply_declaration || 'I hereby declare that the above-made information is true and correct to the best of my knowledge.'),
    sms_on_submit: !!payload.sms_on_submit,
    sms_template: String(payload.sms_template || 'Your application has been received. Your token is {token}.'),
  };
}

const MODELED_FIELDS = ['token', 'candidate_name', 'class', 'category', 'version', 'mobile'];
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;
  const isFullAdmin = await _isAdmissionAdmin(user_id);

  // getMyCommitteeAccess is the one deliberately ungated action -- its whole
  // purpose is letting a non-admin committee member discover their own
  // access (sidebar visibility, which circulars/tabs/scan-options they have).
  if (action === 'getMyCommitteeAccess') {
    const rows = user_id ? await sbAdmission(`circular_committee_members?user_id=eq.${encodeURIComponent(user_id)}&select=circular_id,permissions`) : [];
    const memberRows = Array.isArray(rows) ? rows : [];
    const circulars = {};
    if (memberRows.length) {
      const ids = memberRows.map(r => r.circular_id).join(',');
      const circRows = await sbAdmission(`exam_circulars?id=in.(${ids})&select=id,name,session_id`);
      const circList = Array.isArray(circRows) ? circRows : [];
      const sessIds = [...new Set(circList.map(c => c.session_id).filter(Boolean))];
      const sessRows = sessIds.length ? await sbAdmission(`exam_sessions?id=in.(${sessIds.join(',')})&select=id,name`) : [];
      const sessById = {}; (Array.isArray(sessRows) ? sessRows : []).forEach(s => { sessById[s.id] = s.name; });
      const circById = {}; circList.forEach(c => { circById[c.id] = c; });
      memberRows.forEach(r => {
        const c = circById[r.circular_id];
        circulars[r.circular_id] = { permissions: r.permissions || {}, name: c ? c.name : '', session_name: c ? (sessById[c.session_id] || '') : '' };
      });
    }
    return NextResponse.json({ is_full_admin: isFullAdmin, circulars });
  }

  // Session/circular management + committee management itself + tag-
  // *definition* authoring stay full-admin-only -- a committee member must
  // never configure the circular, manage the committee, or create new scan
  // sections, only use what's already been granted to them.
  const ADMIN_ONLY_ACTIONS = new Set([
    'listSessions', 'createSession', 'updateSession', 'deleteSession', 'createCircular', 'updateCircular', 'getStudentFieldValues',
    'saveTagDefinition', 'deleteTagDefinition',
    'listStaffForCommittee', 'listCommitteeMembers', 'saveCommitteeMember', 'removeCommitteeMember',
    'getVortibdCredentials', 'saveVortibdCredentials', 'listVortibdCirculars', 'getVortibdSyncConfig', 'saveVortibdSyncConfig', 'saveVortibdCircularLink', 'vortibdPullFile', 'syncVortibdNow',
  ]);
  if (ADMIN_ONLY_ACTIONS.has(action) && !isFullAdmin) {
    return NextResponse.json({ error: 'Admission Admin access required.' }, { status: 403 });
  }
  // Reusable Excel-mapping templates aren't circular-scoped and aren't
  // sensitive candidate data -- any committee member (of any circular) may
  // read/save them, but a stranger with no committee role anywhere may not.
  if ((action === 'listCandidateImportTemplates' || action === 'saveCandidateImportTemplate') && !isFullAdmin) {
    const anyRow = user_id ? await sbAdmission(`circular_committee_members?user_id=eq.${encodeURIComponent(user_id)}&select=id&limit=1`) : [];
    if (!Array.isArray(anyRow) || !anyRow.length) return _forbidden();
  }

  // ── Sessions + Circulars — a session (e.g. an admission year, typed
  // freely, like "2026") holds its own circulars; every action below that
  // takes circular_id is further scoped to that one circular, so the same
  // token/room name can recur across different circulars (and the same
  // circular name across different sessions) without colliding. A circular
  // can span several uploads over time (old+new data mixed across them). ──
  if (action === 'listSessions') {
    const rows = await sbAdmission('exam_sessions?select=*&order=created_at.desc');
    return NextResponse.json({ sessions: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'createSession') {
    const name = String(payload.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required.' });
    const res = await sbAdmission('exam_sessions', 'POST', { name });
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A session with this name already exists.' : res.error });
    return NextResponse.json({ id: res?.[0]?.id, name });
  }
  if (action === 'updateSession') {
    const id = parseInt(payload.id, 10);
    const name = String(payload.name || '').trim();
    if (!id) return NextResponse.json({ error: 'Missing session.' });
    if (!name) return NextResponse.json({ error: 'Name is required.' });
    const res = await sbAdmission(`exam_sessions?id=eq.${id}`, 'PATCH', { name });
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A session with this name already exists.' : res.error });
    return NextResponse.json({ success: true, id, name });
  }
  if (action === 'deleteSession') {
    const id = parseInt(payload.id, 10);
    if (!id) return NextResponse.json({ error: 'Missing session.' });
    const circRows = await sbAdmission(`exam_circulars?session_id=eq.${id}&select=id`);
    const circIds = (Array.isArray(circRows) ? circRows : []).map(c => c.id);
    if (circIds.length) {
      const candRows = await sbAdmission(`exam_candidates?circular_id=in.(${circIds.join(',')})&select=id&limit=1`);
      if (Array.isArray(candRows) && candRows.length) {
        return NextResponse.json({ error: 'This session has candidates under it — remove them first before deleting the session.' });
      }
    }
    await sbAdmission(`exam_sessions?id=eq.${id}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  if (action === 'listCirculars') {
    const sessionId = parseInt(payload.session_id, 10);
    if (!sessionId) return NextResponse.json({ circulars: [] });
    const rows = await sbAdmission(`exam_circulars?select=*&session_id=eq.${sessionId}&order=created_at.desc`);
    let circulars = Array.isArray(rows) ? rows : [];
    if (!isFullAdmin) {
      const myRows = user_id ? await sbAdmission(`circular_committee_members?user_id=eq.${encodeURIComponent(user_id)}&select=circular_id`) : [];
      const myIds = new Set((Array.isArray(myRows) ? myRows : []).map(r => r.circular_id));
      circulars = circulars.filter(c => myIds.has(c.id));
    }
    return NextResponse.json({ circulars });
  }
  if (action === 'createCircular') {
    const sessionId = parseInt(payload.session_id, 10);
    if (!sessionId) return NextResponse.json({ error: 'Pick a session first.' });
    const name = String(payload.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required.' });
    const bounds = (payload.bounds && typeof payload.bounds === 'object') ? payload.bounds : {};
    const mode = payload.mode === 'online' ? 'online' : 'offline';
    const is_active = !!payload.is_active;
    const unique_fields = Array.isArray(payload.unique_fields) ? payload.unique_fields.map(String) : [];
    const downloads = _admCandDownloadsConfig(payload);
    const res = await sbAdmission('exam_circulars', 'POST', { session_id: sessionId, name, bounds, mode, is_active, unique_fields, ...downloads });
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A circular with this name already exists in this session.' : res.error });
    return NextResponse.json({ id: res?.[0]?.id, name, bounds, mode, is_active, unique_fields, ...downloads });
  }
  if (action === 'updateCircular') {
    const id = parseInt(payload.id, 10);
    if (!id) return NextResponse.json({ error: 'Missing circular.' });
    const name = String(payload.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required.' });
    const bounds = (payload.bounds && typeof payload.bounds === 'object') ? payload.bounds : {};
    const mode = payload.mode === 'online' ? 'online' : 'offline';
    const is_active = !!payload.is_active;
    const unique_fields = Array.isArray(payload.unique_fields) ? payload.unique_fields.map(String) : [];
    const downloads = _admCandDownloadsConfig(payload);
    const res = await sbAdmission(`exam_circulars?id=eq.${id}`, 'PATCH', { name, bounds, mode, is_active, unique_fields, ...downloads });
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A circular with this name already exists in this session.' : res.error });
    return NextResponse.json({ success: true, id, name, bounds, mode, is_active, unique_fields, ...downloads });
  }

  if (action === 'saveCircularTemplateMap') {
    const id = parseInt(payload.id, 10);
    if (!id) return NextResponse.json({ error: 'Missing circular.' });
    if (!isFullAdmin && !_tabOk(isFullAdmin, await _getCommitteePerms(user_id, id), 'templates', 'edit')) return _forbidden();
    const template_map = (payload.template_map && typeof payload.template_map === 'object') ? payload.template_map : {};
    const res = await sbAdmission(`exam_circulars?id=eq.${id}`, 'PATCH', { template_map });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true, id, template_map });
  }

  // ── Distinct values from the school's own student roster (student schema,
  // students_data table) -- used to build a circular's Class/Version/
  // Category bounds from the REAL taxonomy already in use, not free text.
  // field is whitelisted, mirroring app/api/student-admin/route.js's own
  // get_field_values action (not called directly -- that route's _isAdmin
  // gate gates on 'Admin'/'Student Portal Admin' only, not 'Admission
  // Admin', so this is a small self-contained copy instead). ─────────────
  if (action === 'getStudentFieldValues') {
    const ALLOWED_FIELDS = ['class', 'version', 'student_category', 'section', 'shift', 'session'];
    const field = String(payload.field || '').trim();
    if (!ALLOWED_FIELDS.includes(field)) return NextResponse.json({ error: 'Invalid field.' });
    const res = await fetch(`${SB_URL}/rest/v1/students_data?select=${field}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'student' },
    });
    const rows = res.ok ? await res.json() : [];
    const values = [...new Set((Array.isArray(rows) ? rows : []).map(r => r[field]).filter(v => v !== null && v !== undefined && String(v).trim() !== ''))]
      .map(String).sort();
    return NextResponse.json({ values });
  }

  // ── Saved import-mapping templates ───────────────────────────────────────
  if (action === 'listCandidateImportTemplates') {
    const rows = await sbAdmission('candidate_import_templates?order=updated_at.desc&limit=200');
    return NextResponse.json({ templates: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'saveCandidateImportTemplate') {
    const { name, header_signature, mapping, primary_key_field, field_labels } = payload;
    if (!name || !primary_key_field) return NextResponse.json({ error: 'Name and primary key are required.' });
    const existing = await sbAdmission(`candidate_import_templates?name=eq.${encodeURIComponent(name)}`);
    const data = { name, header_signature: header_signature || '', mapping: mapping || {}, primary_key_field, field_labels: field_labels || {}, updated_at: new Date().toISOString() };
    if (Array.isArray(existing) && existing.length) {
      const res = await sbAdmission(`candidate_import_templates?id=eq.${existing[0].id}`, 'PATCH', data);
      if (res?.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ id: existing[0].id });
    }
    const res = await sbAdmission('candidate_import_templates', 'POST', data);
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ id: res?.[0]?.id });
  }

  // ── Excel upload -> upsert-by-external_key ───────────────────────────────
  // Native PostgREST upsert (on_conflict + Prefer: resolution=merge-duplicates)
  // only overwrites the columns actually present in the posted JSON -- since
  // photo_url/room_id/seat_no/scan fields are never included here, an
  // existing candidate's allocation/photo/scan state survives re-imports
  // untouched, while modeled fields + extra_fields get refreshed.
  // Shared upsert core -- used by the manual uploadMappedCandidates action
  // below AND by the VortiBD automated sync path (_runVortibdSync), so both
  // ever only have ONE upsert implementation to keep correct.
  async function _upsertMappedRows(circularId, rows, meta) {
    if (!rows.length) return { error: 'No rows to import.' };
    if (rows.length > 5000) return { error: 'Import 5000 rows or fewer at a time.' };

    const circRows = await sbAdmission(`exam_circulars?id=eq.${circularId}&select=bounds`);
    const bounds = (Array.isArray(circRows) && circRows[0] && circRows[0].bounds) || {};
    // Maps an exam_candidates modeled field to the bounds key it's checked
    // against -- "category" here is whatever the admin mapped the Excel's
    // Category column to, checked against the circular's bound
    // student_category values (the school's own roster taxonomy).
    const BOUND_CHECKS = [['class', 'class'], ['category', 'student_category'], ['version', 'version']];

    const clean = [];
    const mismatches = [];
    let error_count = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const external_key = String(r.external_key || '').trim();
      if (!external_key) { error_count++; continue; }
      let mismatchReason = null;
      for (const [rowField, boundField] of BOUND_CHECKS) {
        const allowed = bounds[boundField];
        if (Array.isArray(allowed) && allowed.length && r[rowField] && !allowed.includes(r[rowField])) {
          mismatchReason = `${rowField} "${r[rowField]}" is not in this circular's allowed ${boundField.replace('student_', '')} list (${allowed.join(', ')})`;
          break;
        }
      }
      if (mismatchReason) {
        if (mismatches.length < 50) mismatches.push({ row: i + 1, external_key, reason: mismatchReason });
        continue;
      }
      const row = { circular_id: circularId, external_key, updated_at: new Date().toISOString() };
      MODELED_FIELDS.forEach(f => { if (r[f] !== undefined && r[f] !== '') row[f] = r[f]; });
      row.extra_fields = (r.extra_fields && typeof r.extra_fields === 'object') ? r.extra_fields : {};
      clean.push(row);
    }
    if (!clean.length) {
      return mismatches.length
        ? { error: `No rows matched this circular's bounds (${mismatches.length} rejected).`, mismatches }
        : { error: 'No valid rows (primary key column was empty for every row).' };
    }

    // Existing-key lookup WITHIN this circular, chunked to keep each GET's URL short.
    const existingKeys = new Set();
    for (const part of chunk(clean.map(r => r.external_key), 150)) {
      const q = `exam_candidates?circular_id=eq.${circularId}&external_key=in.(${part.map(k => encodeURIComponent(k)).join(',')})&select=external_key`;
      const res = await sbAdmission(q);
      if (Array.isArray(res)) res.forEach(x => existingKeys.add(x.external_key));
    }
    const new_count = clean.filter(r => !existingKeys.has(r.external_key)).length;
    const updated_count = clean.length - new_count;

    for (const part of chunk(clean, 500)) {
      await sbAdmission('exam_candidates?on_conflict=circular_id,external_key', 'POST', part, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    }

    const batch = await sbAdmission('candidate_import_batches', 'POST', {
      circular_id: circularId,
      template_id: (meta && meta.template_id) || null,
      file_name: (meta && meta.file_name) || null,
      mapping_used: (meta && meta.mapping_used) || {},
      primary_key_field: (meta && meta.primary_key_field) || null,
      row_count: rows.length, new_count, updated_count, error_count,
      uploaded_by: (meta && meta.uploaded_by) || null,
    });

    return {
      success: true, new_count, updated_count, error_count,
      mismatch_count: mismatches.length, mismatches,
      total: rows.length, batch_id: batch?.[0]?.id || null,
    };
  }
  if (action === 'uploadMappedCandidates') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'import', 'edit')) return _forbidden();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const result = await _upsertMappedRows(circularId, rows, {
      template_id: payload.template_id, file_name: payload.file_name,
      mapping_used: payload.mapping_used, primary_key_field: payload.primary_key_field,
      uploaded_by: user_id,
    });
    return NextResponse.json(result);
  }

  // ── Candidate list ───────────────────────────────────────────────────────
  if (action === 'listCandidates') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ candidates: [] });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'candidates', 'view')) return _forbidden();
    let q = `exam_candidates?select=*&circular_id=eq.${circularId}&order=created_at.desc&limit=5000`;
    if (payload.class)    q += `&class=eq.${encodeURIComponent(payload.class)}`;
    if (payload.category) q += `&category=eq.${encodeURIComponent(payload.category)}`;
    if (payload.room_id)  q += `&room_id=eq.${parseInt(payload.room_id, 10) || 0}`;
    if (payload.unallocated_only) q += `&room_id=is.null`;
    if (payload.search) {
      const s = encodeURIComponent(payload.search.trim());
      q += `&or=(token.ilike.*${s}*,candidate_name.ilike.*${s}*,external_key.ilike.*${s}*)`;
    }
    const rows = await sbAdmission(q);
    if (rows?.error) return NextResponse.json({ error: rows.error });
    return NextResponse.json({ candidates: rows || [] });
  }
  if (action === 'deleteCandidate') {
    const candId = parseInt(payload.id, 10) || 0;
    if (!isFullAdmin) {
      const rows = await sbAdmission(`exam_candidates?id=eq.${candId}&select=circular_id`);
      const circularId = (Array.isArray(rows) && rows[0]) ? rows[0].circular_id : null;
      if (!_tabOk(false, await _getCommitteePerms(user_id, circularId), 'candidates', 'edit')) return _forbidden();
    }
    await sbAdmission(`exam_candidates?id=eq.${candId}`, 'DELETE');
    return NextResponse.json({ success: true });
  }

  // ── Rooms ────────────────────────────────────────────────────────────────
  if (action === 'listRooms') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ rooms: [] });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'rooms', 'view')) return _forbidden();
    const rows = await sbAdmission(`exam_rooms?select=*&circular_id=eq.${circularId}&order=room_name.asc`);
    return NextResponse.json({ rooms: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'saveRoom') {
    const { id, room_name, capacity, notes } = payload;
    let circularId = parseInt(payload.circular_id, 10);
    if (!id && !circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin) {
      if (!circularId && id) {
        const existing = await sbAdmission(`exam_rooms?id=eq.${parseInt(id, 10)}&select=circular_id`);
        circularId = (Array.isArray(existing) && existing[0]) ? existing[0].circular_id : null;
      }
      if (!_tabOk(false, await _getCommitteePerms(user_id, circularId), 'rooms', 'edit')) return _forbidden();
    }
    if (!room_name || !capacity) return NextResponse.json({ error: 'Room name and capacity are required.' });
    const data = { room_name, capacity: parseInt(capacity, 10) || 0, notes: notes || null, updated_at: new Date().toISOString() };
    if (id) {
      const res = await sbAdmission(`exam_rooms?id=eq.${parseInt(id, 10)}`, 'PATCH', data);
      if (res?.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ id });
    }
    data.circular_id = circularId;
    const res = await sbAdmission('exam_rooms', 'POST', data);
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ id: res?.[0]?.id });
  }
  if (action === 'deleteRoom') {
    const roomId = parseInt(payload.id, 10) || 0;
    if (!isFullAdmin) {
      const rows = await sbAdmission(`exam_rooms?id=eq.${roomId}&select=circular_id`);
      const circularId = (Array.isArray(rows) && rows[0]) ? rows[0].circular_id : null;
      if (!_tabOk(false, await _getCommitteePerms(user_id, circularId), 'rooms', 'edit')) return _forbidden();
    }
    await sbAdmission(`exam_rooms?id=eq.${roomId}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  if (action === 'uploadRoomData') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'rooms', 'edit')) return _forbidden();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: 'No rows to import.' });
    const clean = rows.map(r => ({
      circular_id: circularId,
      room_name: String(r.room_name || '').trim(),
      capacity: parseInt(r.capacity, 10) || 0,
      updated_at: new Date().toISOString(),
    })).filter(r => r.room_name && r.capacity > 0);
    if (!clean.length) return NextResponse.json({ error: 'No valid rows (need a room name and a positive capacity).' });
    const res = await sbAdmission('exam_rooms?on_conflict=circular_id,room_name', 'POST', clean, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true, count: clean.length });
  }

  // ── Seat allocation engine ───────────────────────────────────────────────
  // criteria: { sort_by: 'token'|'candidate_name'|field, sort_dir: 'asc'|'desc',
  //             group_by: ''|'class'|'category', filters: {class?, category?},
  //             room_ids: [in fill order] }
  // Fills each room to capacity in room_ids order; when group_by is set,
  // candidates are grouped first (each group kept together, sorted groups by
  // group key) so a room is never split across two classes/categories unless
  // a single group overflows past one room's capacity, in which case the
  // overflow continues filling the next room.
  if (action === 'runSeatAllocation') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'alloc', 'edit')) return _forbidden();
    const criteria = payload.criteria || {};
    const roomIds = Array.isArray(criteria.room_ids) ? criteria.room_ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!roomIds.length) return NextResponse.json({ error: 'Pick at least one room.' });

    const roomsRes = await sbAdmission(`exam_rooms?id=in.(${roomIds.join(',')})&circular_id=eq.${circularId}&select=id,room_name,capacity`);
    if (!Array.isArray(roomsRes) || !roomsRes.length) return NextResponse.json({ error: 'Rooms not found.' });
    const roomsById = {}; roomsRes.forEach(r => { roomsById[r.id] = r; });
    const orderedRooms = roomIds.map(id => roomsById[id]).filter(Boolean);

    let q = `exam_candidates?select=id,token,candidate_name,class,category,external_key&circular_id=eq.${circularId}&limit=10000`;
    if (criteria.filters?.class)    q += `&class=eq.${encodeURIComponent(criteria.filters.class)}`;
    if (criteria.filters?.category) q += `&category=eq.${encodeURIComponent(criteria.filters.category)}`;
    const candidates = await sbAdmission(q);
    if (!Array.isArray(candidates) || !candidates.length) return NextResponse.json({ error: 'No matching candidates to allocate.' });

    const sortBy = criteria.sort_by || 'token';
    const dir = criteria.sort_dir === 'desc' ? -1 : 1;
    const cmp = (a, b) => String(a[sortBy] ?? '').localeCompare(String(b[sortBy] ?? ''), undefined, { numeric: true }) * dir;

    let ordered;
    if (criteria.group_by) {
      const groups = {};
      candidates.forEach(c => { const k = c[criteria.group_by] || ''; (groups[k] = groups[k] || []).push(c); });
      ordered = Object.keys(groups).sort().flatMap(k => groups[k].sort(cmp));
    } else {
      ordered = candidates.slice().sort(cmp);
    }

    const run = await sbAdmission('seat_allocation_runs', 'POST', {
      circular_id: circularId, criteria_json: criteria, room_ids: roomIds, candidate_count: ordered.length,
    });
    if (run?.error) return NextResponse.json({ error: run.error });
    const runId = run?.[0]?.id;

    let cursor = 0, roomIdx = 0, seatInRoom = 0, overflow = 0;
    const updates = []; // {ids, room_id, seat_start}
    while (cursor < ordered.length && roomIdx < orderedRooms.length) {
      const room = orderedRooms[roomIdx];
      const slice = ordered.slice(cursor, cursor + (room.capacity - seatInRoom));
      slice.forEach((c, i) => updates.push({ id: c.id, room_id: room.id, seat_no: String(seatInRoom + i + 1) }));
      cursor += slice.length;
      seatInRoom += slice.length;
      if (seatInRoom >= room.capacity) { roomIdx++; seatInRoom = 0; }
    }
    if (cursor < ordered.length) overflow = ordered.length - cursor;

    const now = new Date().toISOString();
    for (const u of updates) {
      await sbAdmission(`exam_candidates?id=eq.${u.id}`, 'PATCH', {
        room_id: u.room_id, seat_no: u.seat_no, allocation_run_id: runId, updated_at: now,
      });
    }

    return NextResponse.json({ success: true, allocation_run_id: runId, allocated: updates.length, overflow });
  }
  if (action === 'clearAllocation') {
    const runId = parseInt(payload.allocation_run_id, 10);
    let circularId = parseInt(payload.circular_id, 10);
    if (!runId && !circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin) {
      if (!circularId && runId) {
        const runRows = await sbAdmission(`seat_allocation_runs?id=eq.${runId}&select=circular_id`);
        circularId = (Array.isArray(runRows) && runRows[0]) ? runRows[0].circular_id : null;
      }
      if (!_tabOk(false, await _getCommitteePerms(user_id, circularId), 'alloc', 'edit')) return _forbidden();
    }
    const q = runId ? `exam_candidates?allocation_run_id=eq.${runId}` : `exam_candidates?circular_id=eq.${circularId}&allocation_run_id=not.is.null`;
    await sbAdmission(q, 'PATCH', { room_id: null, seat_no: null, allocation_run_id: null, updated_at: new Date().toISOString() });
    if (runId) await sbAdmission(`seat_allocation_runs?id=eq.${runId}`, 'PATCH', { cleared_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }

  // ── Photo bulk upload by admin-selected match field ──────────────────────
  // VortiBD's own "download all candidate photos" export comes as four
  // separate folders (applicant/father/mother/local guardian), so the admin
  // uploads each folder's files as its own batch, picking which of the four
  // photo columns that batch fills. Matching is no longer limited to the 3
  // fixed columns either -- any custom field from a saved mapping template
  // (e.g. "Applicant ID", if that's what the photos are actually named
  // after) works too, sent as match_field "extra:<field label>" and read
  // out of the candidate's extra_fields jsonb via PostgREST's ->> operator.
  const PHOTO_FIELDS = ['photo_url', 'father_photo_url', 'mother_photo_url', 'guardian_photo_url'];
  const PHOTO_MATCH_COLUMNS = ['token', 'external_key', 'candidate_name', 'class', 'category', 'version', 'mobile'];
  if (action === 'bulkPhotoUploadByMatchKey') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'photos', 'edit')) return _forbidden();
    const photoField = PHOTO_FIELDS.includes(payload.photo_field) ? payload.photo_field : 'photo_url';
    const rawMatchField = String(payload.match_field || 'token');
    let filterKey;
    if (rawMatchField.startsWith('extra:')) {
      const label = rawMatchField.slice(6);
      if (!label) return NextResponse.json({ error: 'Invalid match field.' });
      filterKey = `extra_fields->>${encodeURIComponent(label)}`;
    } else if (PHOTO_MATCH_COLUMNS.includes(rawMatchField)) {
      filterKey = rawMatchField;
    } else {
      return NextResponse.json({ error: 'Invalid match field.' });
    }
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    if (!jobs.length) return NextResponse.json({ error: 'No photos to upload.' });
    let succeeded = 0;
    const failed = [];
    for (const job of jobs) {
      const value = String(job.match_value || '').trim();
      if (!value || !job.photo_base64) { failed.push(job.match_value || '(blank)'); continue; }
      const res = await sbAdmission(`exam_candidates?circular_id=eq.${circularId}&${filterKey}=eq.${encodeURIComponent(value)}`, 'PATCH',
        { [photoField]: job.photo_base64, updated_at: new Date().toISOString() });
      if (res && res.error) failed.push(value); else succeeded++;
    }
    return NextResponse.json({ success: true, succeeded, failed, total: jobs.length });
  }

  // ── Printing ─────────────────────────────────────────────────────────────
  if (action === 'getSignatureSheetData') {
    const roomId = parseInt(payload.room_id, 10);
    if (!roomId) return NextResponse.json({ error: 'Missing room.' });
    if (!isFullAdmin) {
      const roomRows = await sbAdmission(`exam_rooms?id=eq.${roomId}&select=circular_id`);
      const circularId = (Array.isArray(roomRows) && roomRows[0]) ? roomRows[0].circular_id : null;
      if (!_tabOk(false, await _getCommitteePerms(user_id, circularId), 'print', 'view')) return _forbidden();
    }
    const room = await sbAdmission(`exam_rooms?id=eq.${roomId}`);
    const cands = await sbAdmission(`exam_candidates?room_id=eq.${roomId}&select=token,candidate_name,seat_no,photo_url,class,category&order=seat_no.asc`);
    return NextResponse.json({ room: room?.[0] || null, candidates: Array.isArray(cands) ? cands : [] });
  }
  if (action === 'getTokenListData') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ candidates: [] });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'print', 'view')) return _forbidden();
    let q = `exam_candidates?select=token,candidate_name,class,category,room_id,seat_no&circular_id=eq.${circularId}&order=token.asc&limit=5000`;
    if (payload.class)    q += `&class=eq.${encodeURIComponent(payload.class)}`;
    if (payload.category) q += `&category=eq.${encodeURIComponent(payload.category)}`;
    if (payload.room_id)  q += `&room_id=eq.${parseInt(payload.room_id, 10) || 0}`;
    if (Array.isArray(payload.ids) && payload.ids.length) q += `&id=in.(${payload.ids.map(n => parseInt(n, 10)).filter(Boolean).join(',')})`;
    const rows = await sbAdmission(q);
    return NextResponse.json({ candidates: Array.isArray(rows) ? rows : [] });
  }

  // ── Dual QR scan ─────────────────────────────────────────────────────────
  // scope: {class?, category?, room_id?} -- re-validated server-side so a
  // scan whose candidate falls outside the admin's chosen scope is rejected,
  // not just hidden in the UI.
  function scopeMatches(c, scope) {
    if (!scope) return true;
    if (scope.class && c.class !== scope.class) return false;
    if (scope.category && c.category !== scope.category) return false;
    if (scope.room_id && String(c.room_id) !== String(scope.room_id)) return false;
    return true;
  }
  async function findCandidateByCode(circularId, code) {
    const c = encodeURIComponent(String(code || '').trim());
    if (!c || !circularId) return null;
    let rows = await sbAdmission(`exam_candidates?circular_id=eq.${circularId}&token=eq.${c}&select=*`);
    if (!Array.isArray(rows) || !rows.length) rows = await sbAdmission(`exam_candidates?circular_id=eq.${circularId}&external_key=eq.${c}&select=*`);
    return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
  }
  if (action === 'lookupCandidateByToken') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin && !_tabOk(false, await _getCommitteePerms(user_id, circularId), 'scan', 'view')) return _forbidden();
    const candidate = await findCandidateByCode(circularId, payload.code);
    if (!candidate) return NextResponse.json({ error: `No candidate matches "${payload.code}".` });
    if (!scopeMatches(candidate, payload.scope)) return NextResponse.json({ error: 'This candidate is outside the selected scope.', out_of_scope: true, candidate });
    return NextResponse.json({ candidate });
  }
  if (action === 'scanSubmission' || action === 'scanAttendance') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    if (!isFullAdmin) {
      const perms = await _getCommitteePerms(user_id, circularId);
      const optKey = action === 'scanSubmission' ? 'submission' : 'attendance';
      if (!_tabOk(false, perms, 'scan', 'edit') || !_scanOk(false, perms, optKey)) return _forbidden();
    }
    const candidate = await findCandidateByCode(circularId, payload.code);
    if (!candidate) return NextResponse.json({ error: `No candidate matches "${payload.code}".` });
    if (!scopeMatches(candidate, payload.scope)) return NextResponse.json({ error: 'This candidate is outside the selected scope.', out_of_scope: true, candidate });
    const now = new Date().toISOString();
    const data = action === 'scanSubmission'
      ? { submission_scan_status: 'collected', submission_scanned_at: now }
      : { attendance_scan_status: 'present', attendance_scanned_at: now };
    const res = await sbAdmission(`exam_candidates?id=eq.${candidate.id}`, 'PATCH', { ...data, updated_at: now });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true, candidate: { ...candidate, ...data } });
  }

  // ── Part 4: admin-defined candidate tagging via QR scan ("Custom Tags") ──
  // Separate from the fixed submission/attendance scan above -- sections are
  // whatever the admin defines (Toggle/Text/Dropdown), and every scan is
  // logged to candidate_tag_scans (append-only) so a later re-scan never
  // loses the previous value, just adds a new current one.
  function _slugifyTagKey(label) {
    return String(label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tag';
  }
  if (action === 'listTagDefinitions') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ definitions: [] });
    // Low-sensitivity metadata (just section names/types), not candidate data
    // -- readable by anyone with at least view on either tab that uses it.
    if (!isFullAdmin) {
      const perms = await _getCommitteePerms(user_id, circularId);
      if (!_tabOk(false, perms, 'scan', 'view') && !_tabOk(false, perms, 'candidates', 'view')) return NextResponse.json({ definitions: [] });
    }
    const rows = await sbAdmission(`candidate_tag_definitions?circular_id=eq.${circularId}&order=created_at.asc`);
    return NextResponse.json({ definitions: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'saveTagDefinition') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    const label = String(payload.label || '').trim();
    if (!label) return NextResponse.json({ error: 'Section name is required.' });
    const type = ['toggle', 'text', 'dropdown'].includes(payload.type) ? payload.type : 'toggle';
    const options = Array.isArray(payload.options) ? payload.options.map(String).filter(Boolean) : [];
    const id = parseInt(payload.id, 10);
    if (id) {
      // key is immutable once created -- candidate_tag_scans.tag_key already references it by value.
      const res = await sbAdmission(`candidate_tag_definitions?id=eq.${id}`, 'PATCH', { label, type, options });
      if (res?.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ success: true, id });
    }
    const key = _slugifyTagKey(label);
    const data = { circular_id: circularId, key, label, type, options };
    const res = await sbAdmission('candidate_tag_definitions', 'POST', data);
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A section with this name already exists.' : res.error });
    return NextResponse.json({ id: res?.[0]?.id, ...data });
  }
  if (action === 'deleteTagDefinition') {
    await sbAdmission(`candidate_tag_definitions?id=eq.${parseInt(payload.id, 10) || 0}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  async function applyCandidateTag(candidateId, tagKey, value) {
    await sbAdmission('candidate_tag_scans', 'POST', { candidate_id: candidateId, tag_key: tagKey, value });
    const rows = await sbAdmission(`exam_candidates?id=eq.${candidateId}&select=tags`);
    const currentTags = (Array.isArray(rows) && rows[0] && rows[0].tags) || {};
    const tags = { ...currentTags, [tagKey]: value };
    await sbAdmission(`exam_candidates?id=eq.${candidateId}`, 'PATCH', { tags, updated_at: new Date().toISOString() });
    return tags;
  }
  if (action === 'scanTagCandidate') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    const tagKey = String(payload.tag_key || '').trim();
    if (!tagKey) return NextResponse.json({ error: 'Pick a tag section first.' });
    if (!isFullAdmin) {
      const perms = await _getCommitteePerms(user_id, circularId);
      if (!_tabOk(false, perms, 'scan', 'edit') || !_scanOk(false, perms, 'tag:' + tagKey)) return _forbidden();
    }
    const candidate = await findCandidateByCode(circularId, payload.code);
    if (!candidate) return NextResponse.json({ error: `No candidate matches "${payload.code}".` });
    if (!scopeMatches(candidate, payload.scope)) return NextResponse.json({ error: 'This candidate is outside the selected scope.', out_of_scope: true, candidate });
    const tags = await applyCandidateTag(candidate.id, tagKey, payload.value === undefined ? true : payload.value);
    return NextResponse.json({ success: true, candidate: { ...candidate, tags } });
  }
  if (action === 'setCandidateTagValue') {
    const candidateId = parseInt(payload.candidate_id, 10);
    const tagKey = String(payload.tag_key || '').trim();
    if (!candidateId || !tagKey) return NextResponse.json({ error: 'Missing candidate or tag section.' });
    if (!isFullAdmin) {
      const candRows = await sbAdmission(`exam_candidates?id=eq.${candidateId}&select=circular_id`);
      const circularId = (Array.isArray(candRows) && candRows[0]) ? candRows[0].circular_id : null;
      if (!_tabOk(false, await _getCommitteePerms(user_id, circularId), 'candidates', 'edit')) return _forbidden();
    }
    const tags = await applyCandidateTag(candidateId, tagKey, payload.value === undefined ? true : payload.value);
    return NextResponse.json({ success: true, tags });
  }
  if (action === 'getCandidateTagHistory') {
    const candidateId = parseInt(payload.candidate_id, 10);
    const tagKey = String(payload.tag_key || '').trim();
    if (!candidateId || !tagKey) return NextResponse.json({ history: [] });
    if (!isFullAdmin) {
      const candRows = await sbAdmission(`exam_candidates?id=eq.${candidateId}&select=circular_id`);
      const circularId = (Array.isArray(candRows) && candRows[0]) ? candRows[0].circular_id : null;
      const perms = await _getCommitteePerms(user_id, circularId);
      if (!_tabOk(false, perms, 'candidates', 'view') && !_tabOk(false, perms, 'scan', 'view')) return _forbidden();
    }
    const rows = await sbAdmission(`candidate_tag_scans?candidate_id=eq.${candidateId}&tag_key=eq.${encodeURIComponent(tagKey)}&order=scanned_at.desc&limit=50`);
    return NextResponse.json({ history: Array.isArray(rows) ? rows : [] });
  }

  // ── Part 5: committee management (all admin-only -- enforced above via
  // ADMIN_ONLY_ACTIONS already) ────────────────────────────────────────────
  const BASELINE_STAFF_ROLES = ['Teacher', 'Staff', 'HR', 'Principal', 'VP', 'Cord', 'Class Teacher'];
  async function _staffDirectory() {
    const hdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher_staff' };
    const [profRes, userRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/users_profile?select=teacher_id,full_name`, { headers: hdrs }),
      fetch(`${SB_URL}/rest/v1/app_users?select=user_id,email,role&limit=1000`, { headers: hdrs }),
    ]);
    const profiles = profRes.ok ? await profRes.json() : [];
    const users = userRes.ok ? await userRes.json() : [];
    const nameById = {}; (Array.isArray(profiles) ? profiles : []).forEach(p => { nameById[p.teacher_id] = p.full_name; });
    return (Array.isArray(users) ? users : []).map(u => ({
      user_id: u.user_id, email: u.email, role: u.role,
      name: nameById[u.user_id] || u.email || u.user_id,
    }));
  }
  if (action === 'listStaffForCommittee') {
    const staff = await _staffDirectory();
    const eligible = staff.filter(u => String(u.role || '').split(',').map(r => r.trim()).some(r => BASELINE_STAFF_ROLES.includes(r)));
    return NextResponse.json({ staff: eligible });
  }
  if (action === 'listCommitteeMembers') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ members: [] });
    const rows = await sbAdmission(`circular_committee_members?circular_id=eq.${circularId}&order=created_at.asc`);
    const members = Array.isArray(rows) ? rows : [];
    if (!members.length) return NextResponse.json({ members: [] });
    const staff = await _staffDirectory();
    const byId = {}; staff.forEach(s => { byId[s.user_id] = s; });
    return NextResponse.json({ members: members.map(m => ({ ...m, staff: byId[m.user_id] || { user_id: m.user_id, name: m.user_id } })) });
  }
  if (action === 'saveCommitteeMember') {
    const circularId = parseInt(payload.circular_id, 10);
    const memberUserId = String(payload.user_id || '').trim();
    if (!circularId || !memberUserId) return NextResponse.json({ error: 'Pick a circular and a staff member.' });
    const permissions = (payload.permissions && typeof payload.permissions === 'object') ? payload.permissions : {};
    const res = await sbAdmission('circular_committee_members?on_conflict=circular_id,user_id', 'POST',
      { circular_id: circularId, user_id: memberUserId, permissions }, { Prefer: 'resolution=merge-duplicates,return=representation' });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ id: res?.[0]?.id, success: true });
  }
  if (action === 'removeCommitteeMember') {
    await sbAdmission(`circular_committee_members?id=eq.${parseInt(payload.id, 10) || 0}`, 'DELETE');
    return NextResponse.json({ success: true });
  }

  // ── Part 7: VortiBD integration — periodic Excel pull + import ──────────
  // VortiBD's own "Applied Candidates Excel" button turned out (confirmed by
  // live network inspection, not published docs) to be a plain REST API, not
  // page-scraping: POST .../api/UserAuth/login -> JWT bearer token (whose
  // own payload already carries our ClientId claim, so no extra lookup call
  // is needed), then POST .../api/v1/Profile/download-applied-candidates
  // with that token. Credentials are one global write-only secret
  // (admission_settings key 'vortibd_credentials' -- the stored password is
  // never read back to the browser, only {username, hasPassword}), while
  // which VortiBD circular feeds which of our circulars, the sync interval,
  // and the saved mapping template to auto-apply are per-circular columns
  // on exam_circulars.
  const VORTIBD_API = 'https://vortibdliveapi.cloudcampus24.com';
  async function _vortibdCredentials() {
    const rows = await sbAdmission('admission_settings?key=eq.vortibd_credentials');
    return (Array.isArray(rows) && rows[0] && rows[0].value) || null;
  }
  function _vortibdClientIdFromToken(token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
      return payload.ClientId || null;
    } catch (e) { return null; }
  }
  // The login response's exact field name for the JWT was never confirmed
  // (VortiBD's API docs aren't published) -- search for it structurally
  // instead of guessing a field name, since every field-name guess tried so
  // far turned out wrong and made a genuinely successful login look like a
  // failure (its generic success envelope's own "message" field then got
  // surfaced as if it were an error).
  function _findJwtString(value, depth) {
    if ((depth || 0) > 4 || value == null) return null;
    if (typeof value === 'string') return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : null;
    if (Array.isArray(value)) { for (const v of value) { const f = _findJwtString(v, (depth || 0) + 1); if (f) return f; } return null; }
    if (typeof value === 'object') { for (const k of Object.keys(value)) { const f = _findJwtString(value[k], (depth || 0) + 1); if (f) return f; } return null; }
    return null;
  }
  async function _vortibdLogin() {
    const creds = await _vortibdCredentials();
    if (!creds || !creds.username || !creds.password) throw new Error('VortiBD credentials are not configured yet.');
    const res = await fetch(`${VORTIBD_API}/api/UserAuth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password, rememberMe: false }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.isError) {
      // Diagnostic-rich on purpose -- VortiBD's own "message" field turned
      // out to be a generic boilerplate string reused across success AND
      // failure responses, so it alone isn't enough to tell what's wrong.
      const detail = body ? JSON.stringify({ isError: body.isError, responseCode: body.responseCode, responseGroup: body.responseGroup, exceptionMessage: body.exceptionMessage, errors: body.errors }) : '(no JSON body)';
      throw new Error(`VortiBD login failed (HTTP ${res.status}): ${(body && body.message) || 'no message'} — ${detail}`);
    }
    const token = _findJwtString(body.data) || _findJwtString(body);
    if (!token) throw new Error('Logged in to VortiBD, but could not find the session token in the response: ' + JSON.stringify(body.data).slice(0, 300));
    const clientId = _vortibdClientIdFromToken(token);
    if (!clientId) throw new Error('Logged in to VortiBD, but could not determine the school/client ID from the session.');
    return { token, clientId };
  }
  async function _vortibdFetchCirculars(token, clientId) {
    const res = await fetch(`${VORTIBD_API}/api/v1/CircularDashBoard/circulars-dashboard/${clientId}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000),
    });
    const body = await res.json().catch(() => null);
    const list = body && body.data && Array.isArray(body.data.Circulars) ? body.data.Circulars : [];
    return list.map(c => ({ id: c.CircularId, name: c.CircularTitle || `Circular ${c.CircularId}` }));
  }
  // The export response shape (direct binary vs. a JSON envelope carrying a
  // file URL) was never fully confirmed during testing (repeated automated
  // attempts stopped reliably firing the request, likely VortiBD-side
  // throttling of rapid test traffic) -- handled defensively for both.
  async function _vortibdFetchExportBytes(token, clientId, vortibdCircularId) {
    const res = await fetch(`${VORTIBD_API}/api/v1/Profile/download-applied-candidates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: Number(clientId) || 0, isOnlySuccess: true, circularId: Number(vortibdCircularId) || 0,
        circularDetailId: 0, tranStatus: 0, programID: 0, versionID: 0, shiftID: 0, studentCatID: 0,
        sessionID: 0, groupID: 0, gender: '', applyDateFrom: null, applyDateTo: null, applicantId: 0,
        contactNo: '', applicantName: '', bankTransactionId: '', orderBy: '',
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`VortiBD export request failed (status ${res.status}).`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const body = await res.json();
      const fileUrl = body && (body.data?.fileUrl || body.data?.url || body.data?.Url || (typeof body.data === 'string' && body.data.startsWith('http') ? body.data : null));
      if (!fileUrl) throw new Error('VortiBD returned an unexpected response for the export — no file URL found.');
      const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
      if (!fileRes.ok) throw new Error('Could not download the exported file from VortiBD.');
      return Buffer.from(await fileRes.arrayBuffer());
    }
    return Buffer.from(await res.arrayBuffer());
  }
  async function _notifyAdminsOfSyncFailure(circularName, message) {
    try {
      const hdrs = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher_staff', 'Content-Profile': 'teacher_staff', 'Content-Type': 'application/json', Prefer: 'return=minimal' };
      const usersRes = await fetch(`${SB_URL}/rest/v1/app_users?select=user_id,role`, { headers: hdrs });
      const users = usersRes.ok ? await usersRes.json() : [];
      const recipients = (Array.isArray(users) ? users : [])
        .filter(u => String(u.role || '').split(',').map(r => r.trim()).some(r => ['Admin', 'Admission Admin'].includes(r)))
        .map(u => u.user_id);
      if (!recipients.length) return;
      const rows = recipients.map(uid => ({
        user_id: uid, type: 'vortibd_sync_failed', title: 'VortiBD sync failed',
        message: `${circularName}: ${message}`, data: { circularName, message }, is_read: false, created_at: new Date().toISOString(),
      }));
      await fetch(`${SB_URL}/rest/v1/notifications`, { method: 'POST', headers: hdrs, body: JSON.stringify(rows) });
    } catch (e) { /* best-effort -- never let a notification failure mask the original sync error */ }
  }
  // Server-side mirror of the browser's _admCandBuildMappedRows -- the saved
  // template stores {rowId: headerText} (by header TEXT, not column index,
  // so it survives column reordering across uploads), applied here against
  // freshly-parsed VortiBD headers/rows exactly the same way a manual
  // re-upload already applies a saved template today.
  function _applyTemplateMapping(headers, rows, template) {
    const mapping = template.mapping || {};
    const fieldLabels = template.field_labels || {};
    return rows.map(r => {
      const obj = { extra_fields: {} };
      for (const [rowId, headerText] of Object.entries(mapping)) {
        const colIdx = headers.indexOf(headerText);
        if (colIdx < 0) continue;
        const val = String(r[colIdx] ?? '').trim();
        if (MODELED_FIELDS.includes(rowId)) obj[rowId] = val; else obj.extra_fields[fieldLabels[rowId] || rowId] = val;
      }
      const pkHeader = mapping[template.primary_key_field];
      const pkIdx = pkHeader ? headers.indexOf(pkHeader) : -1;
      obj.external_key = pkIdx >= 0 ? String(r[pkIdx] ?? '').trim() : '';
      return obj;
    });
  }
  // VortiBD's own export column layout is the same regardless of which of
  // our circulars the data is headed into, so the mapping (and the rest of
  // the integration's behavior -- enabled, schedule, date range) is ONE
  // system-wide config, not repeated per circular. The only thing that
  // genuinely varies per circular is which VortiBD circular feeds it.
  const VORTIBD_SYNC_CONFIG_DEFAULT = { enabled: false, schedule: [{ start: '00:00', end: '24:00', interval_minutes: 360 }], start_date: null, end_date: null, mapping_template_id: null };
  // One-time upgrade path: these settings used to live per-circular on
  // exam_circulars. The first time the new global row is read and doesn't
  // exist yet, seed it from whichever circular had actually been
  // configured (rather than silently resetting an admin's saved schedule
  // to the untouched default) and persist that as the new global config.
  async function _vortibdSyncConfigMigrateLegacy() {
    const legacyRows = await sbAdmission('exam_circulars?select=vortibd_sync_enabled,vortibd_sync_schedule,vortibd_sync_start_date,vortibd_sync_end_date,vortibd_mapping_template_id&order=id.asc');
    const seed = Array.isArray(legacyRows) && legacyRows.find(c => c.vortibd_sync_enabled || c.vortibd_mapping_template_id ||
      (Array.isArray(c.vortibd_sync_schedule) && c.vortibd_sync_schedule.length && !(c.vortibd_sync_schedule.length === 1 && c.vortibd_sync_schedule[0].start === '00:00' && c.vortibd_sync_schedule[0].end === '24:00' && c.vortibd_sync_schedule[0].interval_minutes === 360)));
    const config = seed ? {
      enabled: !!seed.vortibd_sync_enabled,
      schedule: (Array.isArray(seed.vortibd_sync_schedule) && seed.vortibd_sync_schedule.length) ? seed.vortibd_sync_schedule : VORTIBD_SYNC_CONFIG_DEFAULT.schedule,
      start_date: seed.vortibd_sync_start_date || null,
      end_date: seed.vortibd_sync_end_date || null,
      mapping_template_id: seed.vortibd_mapping_template_id || null,
    } : { ...VORTIBD_SYNC_CONFIG_DEFAULT };
    await sbAdmission('admission_settings', 'POST', { key: 'vortibd_sync_config', value: config, updated_at: new Date().toISOString() });
    return config;
  }
  async function _vortibdSyncConfig() {
    const rows = await sbAdmission('admission_settings?key=eq.vortibd_sync_config');
    if (Array.isArray(rows) && rows.length) return { ...VORTIBD_SYNC_CONFIG_DEFAULT, ...rows[0].value };
    return await _vortibdSyncConfigMigrateLegacy();
  }
  async function _runVortibdSync(circularId) {
    const circRows = await sbAdmission(`exam_circulars?id=eq.${circularId}&select=id,name,vortibd_circular_id`);
    const circ = Array.isArray(circRows) && circRows[0];
    if (!circ) return { error: 'Circular not found.' };
    if (!circ.vortibd_circular_id) return { error: 'No VortiBD circular is linked to this circular yet.' };
    const config = await _vortibdSyncConfig();
    if (!config.mapping_template_id) return { error: 'No saved mapping yet — use "Pull Now & Map" once first.' };
    const now = new Date().toISOString();
    try {
      const { token, clientId } = await _vortibdLogin();
      const bytes = await _vortibdFetchExportBytes(token, clientId, circ.vortibd_circular_id);
      const wb = XLSX.read(bytes, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!grid.length) throw new Error('The exported file came back empty.');
      const headers = grid[0].map(h => String(h || '').trim());
      const dataRows = grid.slice(1).filter(r => r.some(c => String(c || '').trim() !== ''));
      const tplRows = await sbAdmission(`candidate_import_templates?id=eq.${config.mapping_template_id}`);
      const template = Array.isArray(tplRows) && tplRows[0];
      if (!template) throw new Error('The saved mapping template no longer exists — re-map via "Pull Now & Map".');
      const mapped = _applyTemplateMapping(headers, dataRows, template);
      const result = await _upsertMappedRows(circularId, mapped, {
        template_id: template.id, file_name: 'vortibd-auto-sync.xlsx',
        mapping_used: template.mapping, primary_key_field: template.primary_key_field,
      });
      if (result.error) throw new Error(result.error);
      await sbAdmission(`exam_circulars?id=eq.${circularId}`, 'PATCH', {
        vortibd_last_sync_at: now, vortibd_last_sync_status: 'success',
        vortibd_last_sync_message: `${result.new_count} new, ${result.updated_count} updated`,
      });
      return result;
    } catch (e) {
      const message = e.message || 'Unknown error.';
      await sbAdmission(`exam_circulars?id=eq.${circularId}`, 'PATCH', {
        vortibd_last_sync_at: now, vortibd_last_sync_status: 'error', vortibd_last_sync_message: message,
      });
      await _notifyAdminsOfSyncFailure(circ.name, message);
      return { error: message };
    }
  }
  if (action === 'getVortibdCredentials') {
    const creds = await _vortibdCredentials();
    return NextResponse.json({ username: (creds && creds.username) || '', hasPassword: !!(creds && creds.password) });
  }
  if (action === 'saveVortibdCredentials') {
    const username = String(payload.username || '').trim();
    if (!username) return NextResponse.json({ error: 'Username is required.' });
    const existing = await _vortibdCredentials();
    const value = { username, password: payload.password ? String(payload.password) : ((existing && existing.password) || '') };
    if (!value.password) return NextResponse.json({ error: 'Password is required.' });
    const rows = await sbAdmission('admission_settings?key=eq.vortibd_credentials');
    if (Array.isArray(rows) && rows.length) await sbAdmission('admission_settings?key=eq.vortibd_credentials', 'PATCH', { value, updated_at: new Date().toISOString() });
    else await sbAdmission('admission_settings', 'POST', { key: 'vortibd_credentials', value, updated_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }
  if (action === 'listVortibdCirculars') {
    try {
      const { token, clientId } = await _vortibdLogin();
      const circulars = await _vortibdFetchCirculars(token, clientId);
      return NextResponse.json({ circulars });
    } catch (e) { return NextResponse.json({ error: e.message || 'Could not reach VortiBD.' }); }
  }
  if (action === 'getVortibdSyncConfig') {
    return NextResponse.json({ config: await _vortibdSyncConfig() });
  }
  if (action === 'saveVortibdSyncConfig') {
    const HHMM = /^([01]\d|2[0-4]):([0-5]\d)$/;
    const rawSchedule = Array.isArray(payload.schedule) ? payload.schedule : [];
    const schedule = rawSchedule
      .map(w => ({ start: String(w.start || ''), end: String(w.end || ''), interval_minutes: parseInt(w.interval_minutes, 10) || 0 }))
      .filter(w => HHMM.test(w.start) && HHMM.test(w.end) && w.interval_minutes > 0);
    if (!schedule.length) return NextResponse.json({ error: 'Add at least one valid time window (HH:MM) with an interval.' });
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const config = {
      enabled: !!payload.enabled,
      schedule,
      start_date: DATE_RE.test(payload.start_date || '') ? payload.start_date : null,
      end_date: DATE_RE.test(payload.end_date || '') ? payload.end_date : null,
      mapping_template_id: payload.mapping_template_id ? parseInt(payload.mapping_template_id, 10) : null,
    };
    const rows = await sbAdmission('admission_settings?key=eq.vortibd_sync_config');
    if (Array.isArray(rows) && rows.length) await sbAdmission('admission_settings?key=eq.vortibd_sync_config', 'PATCH', { value: config, updated_at: new Date().toISOString() });
    else await sbAdmission('admission_settings', 'POST', { key: 'vortibd_sync_config', value: config, updated_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }
  // The one genuinely per-circular piece -- which VortiBD circular feeds
  // this one. Everything else about the sync is the global config above.
  if (action === 'saveVortibdCircularLink') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Missing circular.' });
    const res = await sbAdmission(`exam_circulars?id=eq.${circularId}`, 'PATCH', {
      vortibd_circular_id: payload.vortibd_circular_id ? parseInt(payload.vortibd_circular_id, 10) : null,
    });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true });
  }
  if (action === 'vortibdPullFile') {
    const circularId = parseInt(payload.circular_id, 10);
    const circRows = circularId ? await sbAdmission(`exam_circulars?id=eq.${circularId}&select=vortibd_circular_id`) : null;
    const vortibdCircularId = Array.isArray(circRows) && circRows[0] && circRows[0].vortibd_circular_id;
    if (!vortibdCircularId) return NextResponse.json({ error: 'Pick which VortiBD circular feeds this one first.' });
    try {
      const { token, clientId } = await _vortibdLogin();
      const bytes = await _vortibdFetchExportBytes(token, clientId, vortibdCircularId);
      return NextResponse.json({ success: true, file_base64: bytes.toString('base64') });
    } catch (e) { return NextResponse.json({ error: e.message || 'Could not pull from VortiBD.' }); }
  }
  if (action === 'syncVortibdNow') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Missing circular.' });
    const result = await _runVortibdSync(circularId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
