import { NextResponse } from 'next/server';

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

const MODELED_FIELDS = ['token', 'candidate_name', 'class', 'category', 'version'];
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;

  if (!(await _isAdmissionAdmin(user_id))) {
    return NextResponse.json({ error: 'Admission Admin access required.' }, { status: 403 });
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
  if (action === 'listCirculars') {
    const sessionId = parseInt(payload.session_id, 10);
    if (!sessionId) return NextResponse.json({ circulars: [] });
    const rows = await sbAdmission(`exam_circulars?select=*&session_id=eq.${sessionId}&order=created_at.desc`);
    return NextResponse.json({ circulars: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'createCircular') {
    const sessionId = parseInt(payload.session_id, 10);
    if (!sessionId) return NextResponse.json({ error: 'Pick a session first.' });
    const name = String(payload.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required.' });
    const bounds = (payload.bounds && typeof payload.bounds === 'object') ? payload.bounds : {};
    const res = await sbAdmission('exam_circulars', 'POST', { session_id: sessionId, name, bounds });
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A circular with this name already exists in this session.' : res.error });
    return NextResponse.json({ id: res?.[0]?.id, name, bounds });
  }
  if (action === 'updateCircular') {
    const id = parseInt(payload.id, 10);
    if (!id) return NextResponse.json({ error: 'Missing circular.' });
    const name = String(payload.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required.' });
    const bounds = (payload.bounds && typeof payload.bounds === 'object') ? payload.bounds : {};
    const res = await sbAdmission(`exam_circulars?id=eq.${id}`, 'PATCH', { name, bounds });
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A circular with this name already exists in this session.' : res.error });
    return NextResponse.json({ success: true, id, name, bounds });
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
    const { name, header_signature, mapping, primary_key_field } = payload;
    if (!name || !primary_key_field) return NextResponse.json({ error: 'Name and primary key are required.' });
    const existing = await sbAdmission(`candidate_import_templates?name=eq.${encodeURIComponent(name)}`);
    const data = { name, header_signature: header_signature || '', mapping: mapping || {}, primary_key_field, updated_at: new Date().toISOString() };
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
  if (action === 'uploadMappedCandidates') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: 'No rows to import.' });
    if (rows.length > 5000) return NextResponse.json({ error: 'Import 5000 rows or fewer at a time.' });

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
      return NextResponse.json(mismatches.length
        ? { error: `No rows matched this circular's bounds (${mismatches.length} rejected).`, mismatches }
        : { error: 'No valid rows (primary key column was empty for every row).' });
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

    let wrote = 0;
    for (const part of chunk(clean, 500)) {
      const res = await sbAdmission('exam_candidates?on_conflict=circular_id,external_key', 'POST', part, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      if (!(res && res.error)) wrote += part.length;
    }

    const batch = await sbAdmission('candidate_import_batches', 'POST', {
      circular_id: circularId,
      template_id: payload.template_id || null,
      file_name: payload.file_name || null,
      mapping_used: payload.mapping_used || {},
      primary_key_field: payload.primary_key_field || null,
      row_count: rows.length, new_count, updated_count, error_count,
      uploaded_by: user_id || null,
    });

    return NextResponse.json({
      success: true, new_count, updated_count, error_count,
      mismatch_count: mismatches.length, mismatches,
      total: rows.length, batch_id: batch?.[0]?.id || null,
    });
  }

  // ── Candidate list ───────────────────────────────────────────────────────
  if (action === 'listCandidates') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ candidates: [] });
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
    await sbAdmission(`exam_candidates?id=eq.${parseInt(payload.id, 10) || 0}`, 'DELETE');
    return NextResponse.json({ success: true });
  }

  // ── Rooms ────────────────────────────────────────────────────────────────
  if (action === 'listRooms') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ rooms: [] });
    const rows = await sbAdmission(`exam_rooms?select=*&circular_id=eq.${circularId}&order=room_name.asc`);
    return NextResponse.json({ rooms: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'saveRoom') {
    const { id, room_name, capacity, notes } = payload;
    const circularId = parseInt(payload.circular_id, 10);
    if (!id && !circularId) return NextResponse.json({ error: 'Pick a circular first.' });
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
    await sbAdmission(`exam_rooms?id=eq.${parseInt(payload.id, 10) || 0}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  if (action === 'uploadRoomData') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
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
    const circularId = parseInt(payload.circular_id, 10);
    if (!runId && !circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    const q = runId ? `exam_candidates?allocation_run_id=eq.${runId}` : `exam_candidates?circular_id=eq.${circularId}&allocation_run_id=not.is.null`;
    await sbAdmission(q, 'PATCH', { room_id: null, seat_no: null, allocation_run_id: null, updated_at: new Date().toISOString() });
    if (runId) await sbAdmission(`seat_allocation_runs?id=eq.${runId}`, 'PATCH', { cleared_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }

  // ── Photo bulk upload by admin-selected match field ──────────────────────
  if (action === 'bulkPhotoUploadByMatchKey') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    const matchField = String(payload.match_field || 'token');
    if (!['token', 'external_key', 'candidate_name'].includes(matchField)) {
      return NextResponse.json({ error: 'Invalid match field.' });
    }
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    if (!jobs.length) return NextResponse.json({ error: 'No photos to upload.' });
    let succeeded = 0;
    const failed = [];
    for (const job of jobs) {
      const value = String(job.match_value || '').trim();
      if (!value || !job.photo_base64) { failed.push(job.match_value || '(blank)'); continue; }
      const res = await sbAdmission(`exam_candidates?circular_id=eq.${circularId}&${matchField}=eq.${encodeURIComponent(value)}`, 'PATCH',
        { photo_url: job.photo_base64, updated_at: new Date().toISOString() });
      if (res && res.error) failed.push(value); else succeeded++;
    }
    return NextResponse.json({ success: true, succeeded, failed, total: jobs.length });
  }

  // ── Printing ─────────────────────────────────────────────────────────────
  if (action === 'getSignatureSheetData') {
    const roomId = parseInt(payload.room_id, 10);
    if (!roomId) return NextResponse.json({ error: 'Missing room.' });
    const room = await sbAdmission(`exam_rooms?id=eq.${roomId}`);
    const cands = await sbAdmission(`exam_candidates?room_id=eq.${roomId}&select=token,candidate_name,seat_no,photo_url,class,category&order=seat_no.asc`);
    return NextResponse.json({ room: room?.[0] || null, candidates: Array.isArray(cands) ? cands : [] });
  }
  if (action === 'getTokenListData') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ candidates: [] });
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
    const candidate = await findCandidateByCode(circularId, payload.code);
    if (!candidate) return NextResponse.json({ error: `No candidate matches "${payload.code}".` });
    if (!scopeMatches(candidate, payload.scope)) return NextResponse.json({ error: 'This candidate is outside the selected scope.', out_of_scope: true, candidate });
    return NextResponse.json({ candidate });
  }
  if (action === 'scanSubmission' || action === 'scanAttendance') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
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

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
