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

const MODELED_FIELDS = ['token', 'candidate_name', 'class', 'category'];
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
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: 'No rows to import.' });
    if (rows.length > 5000) return NextResponse.json({ error: 'Import 5000 rows or fewer at a time.' });

    const clean = [];
    let error_count = 0;
    for (const r of rows) {
      const external_key = String(r.external_key || '').trim();
      if (!external_key) { error_count++; continue; }
      const row = { external_key, updated_at: new Date().toISOString() };
      MODELED_FIELDS.forEach(f => { if (r[f] !== undefined && r[f] !== '') row[f] = r[f]; });
      row.extra_fields = (r.extra_fields && typeof r.extra_fields === 'object') ? r.extra_fields : {};
      clean.push(row);
    }
    if (!clean.length) return NextResponse.json({ error: 'No valid rows (primary key column was empty for every row).' });

    // Existing-key lookup, chunked to keep each GET's URL short.
    const existingKeys = new Set();
    for (const part of chunk(clean.map(r => r.external_key), 150)) {
      const q = `exam_candidates?external_key=in.(${part.map(k => encodeURIComponent(k)).join(',')})&select=external_key`;
      const res = await sbAdmission(q);
      if (Array.isArray(res)) res.forEach(x => existingKeys.add(x.external_key));
    }
    const new_count = clean.filter(r => !existingKeys.has(r.external_key)).length;
    const updated_count = clean.length - new_count;

    let wrote = 0;
    for (const part of chunk(clean, 500)) {
      const res = await sbAdmission('exam_candidates?on_conflict=external_key', 'POST', part, { Prefer: 'resolution=merge-duplicates,return=minimal' });
      if (!(res && res.error)) wrote += part.length;
    }

    const batch = await sbAdmission('candidate_import_batches', 'POST', {
      template_id: payload.template_id || null,
      file_name: payload.file_name || null,
      mapping_used: payload.mapping_used || {},
      primary_key_field: payload.primary_key_field || null,
      row_count: rows.length, new_count, updated_count, error_count,
      uploaded_by: user_id || null,
    });

    return NextResponse.json({ success: true, new_count, updated_count, error_count, total: rows.length, batch_id: batch?.[0]?.id || null });
  }

  // ── Candidate list ───────────────────────────────────────────────────────
  if (action === 'listCandidates') {
    let q = 'exam_candidates?select=*&order=created_at.desc&limit=5000';
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
    const rows = await sbAdmission('exam_rooms?select=*&order=room_name.asc');
    return NextResponse.json({ rooms: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'saveRoom') {
    const { id, room_name, capacity, notes } = payload;
    if (!room_name || !capacity) return NextResponse.json({ error: 'Room name and capacity are required.' });
    const data = { room_name, capacity: parseInt(capacity, 10) || 0, notes: notes || null, updated_at: new Date().toISOString() };
    if (id) {
      const res = await sbAdmission(`exam_rooms?id=eq.${parseInt(id, 10)}`, 'PATCH', data);
      if (res?.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ id });
    }
    const res = await sbAdmission('exam_rooms', 'POST', data);
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ id: res?.[0]?.id });
  }
  if (action === 'deleteRoom') {
    await sbAdmission(`exam_rooms?id=eq.${parseInt(payload.id, 10) || 0}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  if (action === 'uploadRoomData') {
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) return NextResponse.json({ error: 'No rows to import.' });
    const clean = rows.map(r => ({
      room_name: String(r.room_name || '').trim(),
      capacity: parseInt(r.capacity, 10) || 0,
      updated_at: new Date().toISOString(),
    })).filter(r => r.room_name && r.capacity > 0);
    if (!clean.length) return NextResponse.json({ error: 'No valid rows (need a room name and a positive capacity).' });
    const res = await sbAdmission('exam_rooms?on_conflict=room_name', 'POST', clean, { Prefer: 'resolution=merge-duplicates,return=minimal' });
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
    const criteria = payload.criteria || {};
    const roomIds = Array.isArray(criteria.room_ids) ? criteria.room_ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!roomIds.length) return NextResponse.json({ error: 'Pick at least one room.' });

    const roomsRes = await sbAdmission(`exam_rooms?id=in.(${roomIds.join(',')})&select=id,room_name,capacity`);
    if (!Array.isArray(roomsRes) || !roomsRes.length) return NextResponse.json({ error: 'Rooms not found.' });
    const roomsById = {}; roomsRes.forEach(r => { roomsById[r.id] = r; });
    const orderedRooms = roomIds.map(id => roomsById[id]).filter(Boolean);

    let q = 'exam_candidates?select=id,token,candidate_name,class,category,external_key&limit=10000';
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
      criteria_json: criteria, room_ids: roomIds, candidate_count: ordered.length,
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
    const q = runId ? `exam_candidates?allocation_run_id=eq.${runId}` : `exam_candidates?allocation_run_id=not.is.null`;
    await sbAdmission(q, 'PATCH', { room_id: null, seat_no: null, allocation_run_id: null, updated_at: new Date().toISOString() });
    if (runId) await sbAdmission(`seat_allocation_runs?id=eq.${runId}`, 'PATCH', { cleared_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }

  // ── Photo bulk upload by admin-selected match field ──────────────────────
  if (action === 'bulkPhotoUploadByMatchKey') {
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
      const res = await sbAdmission(`exam_candidates?${matchField}=eq.${encodeURIComponent(value)}`, 'PATCH',
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
    let q = 'exam_candidates?select=token,candidate_name,class,category,room_id,seat_no&order=token.asc&limit=5000';
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
  async function findCandidateByCode(code) {
    const c = encodeURIComponent(String(code || '').trim());
    if (!c) return null;
    let rows = await sbAdmission(`exam_candidates?token=eq.${c}&select=*`);
    if (!Array.isArray(rows) || !rows.length) rows = await sbAdmission(`exam_candidates?external_key=eq.${c}&select=*`);
    return (Array.isArray(rows) && rows[0]) ? rows[0] : null;
  }
  if (action === 'lookupCandidateByToken') {
    const candidate = await findCandidateByCode(payload.code);
    if (!candidate) return NextResponse.json({ error: `No candidate matches "${payload.code}".` });
    if (!scopeMatches(candidate, payload.scope)) return NextResponse.json({ error: 'This candidate is outside the selected scope.', out_of_scope: true, candidate });
    return NextResponse.json({ candidate });
  }
  if (action === 'scanSubmission' || action === 'scanAttendance') {
    const candidate = await findCandidateByCode(payload.code);
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
