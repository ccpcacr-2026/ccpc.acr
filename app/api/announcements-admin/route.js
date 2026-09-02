import { NextResponse } from 'next/server';

// ── Announcements Admin ─────────────────────────────────────────────────────
// Lets Admin record/upload an MP3 and target it at ESP32 speaker units by
// device_hash (or 'All'). Table lives in the DEFAULT `public` schema (unlike
// every other admin console here, which uses its own named schema) — that
// keeps the ESP32 firmware's own fetchAnnouncements() query simple (no
// Accept-Profile header needed, public schema is PostgREST's default).
// The MP3 itself goes into a public Supabase Storage bucket ("announcements")
// so the firmware's plain-GET downloadFile() works with no auth.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbPublic(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

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

async function _isAnnouncementsAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.some(r => ['Admin', 'VP', 'Cord', 'Class Teacher'].includes(r));
}

// Devices to target come from student.p10_display_devices — the P10 firmware
// is what actually polls get_pending_announcements() and plays them
// (device_health is the separate NFC-terminal fleet, which doesn't consume
// announcements at all). Collapsed to one row per device_hash (latest
// ping), same de-dupe logic as get_device_health_list in app/api/
// student-admin/route.js. The option VALUE must be paired_device_name, not
// device_hash — that's the exact string the firmware sends as p_device_id
// (see currentPairedId() in p10_display/src/main.cpp) and what
// get_pending_announcements matches target_devices entries against.
async function _getDevicesForTargeting() {
  const res = await fetch(`${SB_URL}/rest/v1/p10_display_devices?select=device_hash,device_name,paired_device_name,created_at&order=created_at.desc`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'student' },
  });
  if (!res.ok) return NextResponse.json({ result: 'error', message: await res.text() }, { status: 500 });
  const rows = await res.json();
  const seen = new Set();
  const devices = [];
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r.device_hash || seen.has(r.device_hash)) return;
    seen.add(r.device_hash);
    const pairedId = r.paired_device_name || r.device_name || r.device_hash;
    const label = r.device_name && r.device_name !== pairedId ? `${pairedId} — ${r.device_name}` : pairedId;
    devices.push({ value: pairedId, label });
  });
  return NextResponse.json({ result: 'success', devices });
}

// Uploads a base64-encoded MP3 straight to Supabase Storage via its REST
// API (not the JS SDK — this route already talks to Postgres the same raw-
// fetch way, no reason to add a second client library for one call).
async function _uploadAnnouncementAudio(payload) {
  const { filename, base64 } = payload || {};
  if (!filename || !base64) return NextResponse.json({ result: 'error', message: 'filename and base64 audio are required.' }, { status: 400 });
  const commaIdx = base64.indexOf(',');
  const raw = commaIdx >= 0 ? base64.slice(commaIdx + 1) : base64;
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length > 15 * 1024 * 1024) return NextResponse.json({ result: 'error', message: 'Audio file is too large (max 15MB).' }, { status: 400 });
  const key = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const res = await fetch(`${SB_URL}/storage/v1/object/announcements/${key}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!res.ok) return NextResponse.json({ result: 'error', message: await res.text() }, { status: 500 });
  const file_url = `${SB_URL}/storage/v1/object/public/announcements/${key}`;
  return NextResponse.json({ result: 'success', file_url, storage_key: key });
}

// Fire-and-forget audit trail — same pattern as _invAudit/_prAudit in the
// Inventory/Payroll admin routes, its own table since this module lives in
// the default `public` schema rather than a named one.
function _annAudit(actorUserId, action, announcementId, details) {
  sbPublic('announcement_log', 'POST', {
    actor_user_id: actorUserId || null,
    action,
    announcement_id: announcementId != null ? Number(announcementId) : null,
    details: details || null,
  }).catch(() => {});
}

function _annDiffFields(oldObj, newObj, fields) {
  const changes = [];
  fields.forEach(({ key, label }) => {
    if (newObj[key] === undefined) return;
    const from = oldObj ? oldObj[key] : undefined;
    const to = newObj[key];
    const fromNorm = JSON.stringify(from ?? null);
    const toNorm = JSON.stringify(to ?? null);
    if (fromNorm !== toNorm) changes.push({ label, from: from == null ? '—' : String(Array.isArray(from) ? from.join(', ') : from), to: to == null ? '—' : String(Array.isArray(to) ? to.join(', ') : to) });
  });
  return changes;
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ result: 'error', message: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;

  if (!(await _isAnnouncementsAdmin(user_id))) {
    return NextResponse.json({ result: 'error', message: 'Admin access required.' }, { status: 403 });
  }

  if (action === 'get_announcements') {
    const rows = await sbPublic('announcements?select=*&order=id.desc&limit=200');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', announcements: rows });
  }

  if (action === 'get_devices_for_targeting') return _getDevicesForTargeting();
  if (action === 'upload_audio') return _uploadAnnouncementAudio(payload);

  if (action === 'save_announcement') {
    const { id, title, file_url, target_devices, active } = payload;
    // file_url is optional — a blank one is a deliberate "text-only"
    // announcement (the P10 firmware already fully supports this: it just
    // scrolls the title with nothing to download or play, see
    // fetchAnnouncements()/startPlayback() in p10_display/src/main.cpp).
    if (!title) return NextResponse.json({ result: 'error', message: 'Title is required.' }, { status: 400 });
    const rowData = {
      title,
      file_url: file_url || '',
      target_devices: Array.isArray(target_devices) && target_devices.length ? target_devices : ['All'],
      active: active !== false,
      created_by: user_id,
    };
    let oldRow = null;
    if (id) {
      const oldRows = await sbPublic(`announcements?id=eq.${encodeURIComponent(id)}&select=*`);
      oldRow = (!oldRows?.error && oldRows[0]) || null;
    }
    const saved = id
      ? await sbPublic(`announcements?id=eq.${encodeURIComponent(id)}`, 'PATCH', rowData)
      : await sbPublic('announcements', 'POST', rowData);
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    const savedRow = Array.isArray(saved) ? saved[0] : saved;
    if (id) {
      const changes = _annDiffFields(oldRow, rowData, [
        { key: 'title', label: 'Title' }, { key: 'file_url', label: 'Audio File' },
        { key: 'target_devices', label: 'Target Devices' }, { key: 'active', label: 'Active' },
      ]);
      _annAudit(user_id, 'edit_announcement', id, { changes });
    } else {
      _annAudit(user_id, 'create_announcement', savedRow?.id, { title, target_devices: rowData.target_devices });
    }
    return NextResponse.json({ result: 'success', announcement: savedRow });
  }

  if (action === 'toggle_announcement_active') {
    const { id, active } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const saved = await sbPublic(`announcements?id=eq.${encodeURIComponent(id)}`, 'PATCH', { active: !!active });
    if (saved?.error) return NextResponse.json({ result: 'error', message: saved.error }, { status: 500 });
    _annAudit(user_id, active ? 'activate_announcement' : 'deactivate_announcement', id, null);
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'delete_announcement') {
    const { id } = payload;
    if (!id) return NextResponse.json({ result: 'error', message: 'id required' }, { status: 400 });
    const rows = await sbPublic(`announcements?id=eq.${encodeURIComponent(id)}&select=*`);
    const existing = (!rows?.error && rows[0]) || null;
    const del = await sbPublic(`announcements?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    if (del?.error) return NextResponse.json({ result: 'error', message: del.error }, { status: 500 });
    _annAudit(user_id, 'delete_announcement', id, { snapshot: existing });
    // Best-effort — a stale orphaned file in Storage isn't worth failing
    // the whole delete over if this second call has a hiccup.
    const storageKey = existing && existing.file_url && existing.file_url.split('/announcements/')[1];
    if (storageKey) {
      fetch(`${SB_URL}/storage/v1/object/announcements/${storageKey}`, {
        method: 'DELETE',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      }).catch(() => {});
    }
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'get_announcement_log') {
    const rows = await sbPublic('announcement_log?select=*&order=created_at.desc&limit=200');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', log: rows });
  }

  return NextResponse.json({ result: 'error', message: 'Unknown action' }, { status: 400 });
}
