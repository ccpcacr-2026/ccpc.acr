import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// ── VortiBD scheduled sync (Vercel Cron -> this route, every 30 min) ─────
// Self-contained per this codebase's no-shared-lib convention -- duplicates
// the same VortiBD pull/mapping/upsert logic as the admin-triggered actions
// in app/api/admission-candidates/route.js (getVortibdCredentials,
// vortibdPullFile, syncVortibdNow, _runVortibdSync) rather than importing
// across route files. Keep both in sync if the VortiBD API or the mapping
// shape ever changes.
//
// Vercel Cron's own schedule (vercel.json) is a fixed 30-minute wake-up --
// the actual sync behavior (enabled, schedule, date range, which mapping
// template to apply) is ONE system-wide config (admission_settings key
// 'vortibd_sync_config'), not per circular -- VortiBD's export column
// layout is the same regardless of which circular the data is headed into.
// The only thing that varies per circular is exam_circulars.vortibd_
// circular_id (which VortiBD circular feeds it) and its own vortibd_last_
// sync_at, checked against the shared schedule on every wake-up.

export const dynamic = 'force-dynamic';
// VortiBD can reportedly take several minutes to respond on a slow request
// (not a bot-detection issue -- their own infrastructure is just sometimes
// slow); this route may also loop over several due circulars in one run, so
// its budget needs to be generous.
export const maxDuration = 280;

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const VORTIBD_API = 'https://vortibdliveapi.cloudcampus24.com';
const MODELED_FIELDS = ['token', 'candidate_name', 'class', 'category', 'version', 'mobile'];

async function sbAdmission(path, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      'Accept-Profile': 'admission', 'Content-Profile': 'admission', ...extraHeaders,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function _vortibdCredentials() {
  const rows = await sbAdmission('admission_settings?key=eq.vortibd_credentials');
  return (Array.isArray(rows) && rows[0] && rows[0].value) || null;
}
function _vortibdClientIdFromToken(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')).ClientId || null; }
  catch (e) { return null; }
}
// Same structural JWT search as admission-candidates/route.js's copy -- the
// login response's exact field name for the token was never confirmed, so a
// guessed field name made a genuinely successful login look like a failure.
function _findJwtString(value, depth) {
  if ((depth || 0) > 4 || value == null) return null;
  if (typeof value === 'string') return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : null;
  if (Array.isArray(value)) { for (const v of value) { const f = _findJwtString(v, (depth || 0) + 1); if (f) return f; } return null; }
  if (typeof value === 'object') { for (const k of Object.keys(value)) { const f = _findJwtString(value[k], (depth || 0) + 1); if (f) return f; } return null; }
  return null;
}
async function _vortibdLogin() {
  const creds = await _vortibdCredentials();
  if (!creds || !creds.username || !creds.password) throw new Error('VortiBD credentials are not configured.');
  const res = await fetch(`${VORTIBD_API}/api/UserAuth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: creds.username, password: creds.password, rememberMe: false }),
    signal: AbortSignal.timeout(120000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.isError) {
    const detail = body ? JSON.stringify({ isError: body.isError, responseCode: body.responseCode, responseGroup: body.responseGroup, exceptionMessage: body.exceptionMessage, errors: body.errors }) : '(no JSON body)';
    throw new Error(`VortiBD login failed (HTTP ${res.status}): ${(body && body.message) || 'no message'} — ${detail}`);
  }
  const token = _findJwtString(body.data) || _findJwtString(body);
  if (!token) throw new Error('Logged in to VortiBD, but could not find the session token in the response: ' + JSON.stringify(body.data).slice(0, 300));
  const clientId = _vortibdClientIdFromToken(token);
  if (!clientId) throw new Error('Could not determine the VortiBD client ID from the session.');
  return { token, clientId };
}
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
    if (!fileUrl) throw new Error('VortiBD returned an unexpected response for the export.');
    const fileRes = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
    if (!fileRes.ok) throw new Error('Could not download the exported file from VortiBD.');
    return Buffer.from(await fileRes.arrayBuffer());
  }
  return Buffer.from(await res.arrayBuffer());
}
function _applyTemplateMapping(headers, rows, template) {
  const mapping = template.mapping || {};
  return rows.map(r => {
    const obj = { extra_fields: {} };
    for (const [rowId, headerText] of Object.entries(mapping)) {
      const colIdx = headers.indexOf(headerText);
      if (colIdx < 0) continue;
      const val = String(r[colIdx] ?? '').trim();
      if (MODELED_FIELDS.includes(rowId)) obj[rowId] = val; else obj.extra_fields[rowId] = val;
    }
    const pkHeader = mapping[template.primary_key_field];
    const pkIdx = pkHeader ? headers.indexOf(pkHeader) : -1;
    obj.external_key = pkIdx >= 0 ? String(r[pkIdx] ?? '').trim() : '';
    return obj;
  });
}
async function _upsertMappedRows(circularId, rows, meta) {
  if (!rows.length) return { error: 'No rows to import.' };
  const circRows = await sbAdmission(`exam_circulars?id=eq.${circularId}&select=bounds`);
  const bounds = (Array.isArray(circRows) && circRows[0] && circRows[0].bounds) || {};
  const BOUND_CHECKS = [['class', 'class'], ['category', 'student_category'], ['version', 'version']];
  const clean = [];
  let error_count = 0, mismatchCount = 0;
  for (const r of rows) {
    const external_key = String(r.external_key || '').trim();
    if (!external_key) { error_count++; continue; }
    let mismatch = false;
    for (const [rowField, boundField] of BOUND_CHECKS) {
      const allowed = bounds[boundField];
      if (Array.isArray(allowed) && allowed.length && r[rowField] && !allowed.includes(r[rowField])) { mismatch = true; break; }
    }
    if (mismatch) { mismatchCount++; continue; }
    const row = { circular_id: circularId, external_key, updated_at: new Date().toISOString() };
    MODELED_FIELDS.forEach(f => { if (r[f] !== undefined && r[f] !== '') row[f] = r[f]; });
    row.extra_fields = (r.extra_fields && typeof r.extra_fields === 'object') ? r.extra_fields : {};
    clean.push(row);
  }
  if (!clean.length) return { error: `No valid rows (${mismatchCount} mismatched, ${error_count} missing key).` };
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
    circular_id: circularId, template_id: (meta && meta.template_id) || null,
    file_name: (meta && meta.file_name) || null, mapping_used: (meta && meta.mapping_used) || {},
    primary_key_field: (meta && meta.primary_key_field) || null,
    row_count: rows.length, new_count, updated_count, error_count,
  });
  return { success: true, new_count, updated_count, error_count, mismatch_count: mismatchCount, batch_id: batch?.[0]?.id || null };
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
  } catch (e) { /* best-effort */ }
}
async function _vortibdSyncConfig() {
  const rows = await sbAdmission('admission_settings?key=eq.vortibd_sync_config');
  const stored = (Array.isArray(rows) && rows[0] && rows[0].value) || {};
  return { enabled: false, schedule: [{ start: '00:00', end: '24:00', interval_minutes: 360 }], start_date: null, end_date: null, mapping_template_id: null, ...stored };
}
async function _runVortibdSync(circ, config) {
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
    if (!template) throw new Error('The saved mapping template no longer exists.');
    const mapped = _applyTemplateMapping(headers, dataRows, template);
    const result = await _upsertMappedRows(circ.id, mapped, { template_id: template.id, file_name: 'vortibd-auto-sync.xlsx', mapping_used: template.mapping, primary_key_field: template.primary_key_field });
    if (result.error) throw new Error(result.error);
    await sbAdmission(`exam_circulars?id=eq.${circ.id}`, 'PATCH', {
      vortibd_last_sync_at: now, vortibd_last_sync_status: 'success',
      vortibd_last_sync_message: `${result.new_count} new, ${result.updated_count} updated`,
    });
    return { circular_id: circ.id, success: true };
  } catch (e) {
    const message = e.message || 'Unknown error.';
    await sbAdmission(`exam_circulars?id=eq.${circ.id}`, 'PATCH', { vortibd_last_sync_at: now, vortibd_last_sync_status: 'error', vortibd_last_sync_message: message });
    await _notifyAdminsOfSyncFailure(circ.name, message);
    return { circular_id: circ.id, error: message };
  }
}

// VortiBD itself works in Bangladesh local time (its own circular settings
// show "GMT+6"), and that's what an admin typing "07:00" means -- the server
// runs in UTC, so every date/time comparison below is done in BD time
// (UTC+6, no DST) rather than the server's own clock.
const BD_OFFSET_MIN = 6 * 60;
function _bdNow() { return new Date(Date.now() + BD_OFFSET_MIN * 60000); }
function _bdDateStr(d) { return d.toISOString().slice(0, 10); }
function _bdMinutesOfDay(d) { return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function _hhmmToMin(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); }
// schedule: [{start:"HH:MM", end:"HH:MM", interval_minutes}, ...] -- a window
// may wrap past midnight (start > end). Falls back to 360 if nothing matches
// (a gap in the admin's own schedule, not an error condition).
function _activeIntervalMinutes(schedule, nowMin) {
  for (const w of (Array.isArray(schedule) ? schedule : [])) {
    const s = _hhmmToMin(w.start);
    const e = w.end === '24:00' ? 24 * 60 : _hhmmToMin(w.end);
    const inWindow = s <= e ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e);
    if (inWindow) return w.interval_minutes || 360;
  }
  return 360;
}

export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const config = await _vortibdSyncConfig();
  if (!config.enabled || !config.mapping_template_id) {
    return NextResponse.json({ checked: 0, due: 0, synced: 0, failed: 0, note: 'VortiBD sync is disabled or has no saved mapping yet.' });
  }
  const rows = await sbAdmission('exam_circulars?vortibd_circular_id=not.is.null&select=id,name,vortibd_circular_id,vortibd_last_sync_at');
  const circulars = Array.isArray(rows) ? rows : [];
  const bdNow = _bdNow();
  const todayStr = _bdDateStr(bdNow);
  const inDateRange = (!config.start_date || todayStr >= config.start_date) && (!config.end_date || todayStr <= config.end_date);
  const intervalMin = _activeIntervalMinutes(config.schedule, _bdMinutesOfDay(bdNow));
  const due = inDateRange ? circulars.filter(c => {
    if (!c.vortibd_last_sync_at) return true;
    const elapsedMin = (Date.now() - new Date(c.vortibd_last_sync_at).getTime()) / 60000;
    return elapsedMin >= intervalMin;
  }) : [];
  const results = [];
  for (const c of due) results.push(await _runVortibdSync(c, config));
  return NextResponse.json({ checked: circulars.length, due: due.length, synced: results.filter(r => r.success).length, failed: results.filter(r => r.error).length, results });
}
