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

async function _sbStudent(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'student' },
  });
  if (!res.ok) return { error: await res.text() };
  return res.json();
}

// Paginated GET against the student schema — students_data can run into the
// thousands, past PostgREST's default page size, unlike every other query
// in this file (all naturally small: one class_teacher_assignments row per
// teacher, one p10_display_devices row per physical unit).
async function _sbStudentAllRows(path) {
  const PAGE = 3000;
  let all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'student', Range: `${offset}-${offset + PAGE - 1}` },
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

// Targeting is by Class-Section (pulled fresh from students_data, the real
// roster — not just whichever P10 rows happen to exist), each resolved to
// whichever P10 display is assigned to it, if any. A Class-Section with no
// device yet still shows (so an Admin can see the gap) but isn't
// selectable. A Class Teacher (and nobody broader) only sees their own
// assigned Class-Section(s), never 'All'; Admin/VP/Cord see every one and
// may target 'All'. Deliberately keyed off the caller's OWN roles/
// assignments, never anything the client submits, same pattern as
// getMyClassAttendanceReport in app/api/exec/route.js.
async function _resolveTargetableDevices(userId) {
  const roles = await _getUserRoles(userId);
  const isBroad = roles.some(r => ['Admin', 'VP', 'Cord'].includes(r));

  const classRows = await _sbStudentAllRows('students_data?select=class,section');
  const classSections = classRows?.error ? [] : classRows;

  // student.p10_display_devices — the P10 firmware is what actually polls
  // get_pending_announcements() and plays them (device_health is the
  // separate NFC-terminal fleet, which doesn't consume announcements at
  // all). This only needs to know WHICH Class-Sections have a device
  // assigned — the target VALUE itself is always the derived "<class>-
  // <section>" string (below), never the row's own paired_device_name,
  // because save_device_config (student-admin/route.js) now forces
  // paired_device_name to exactly that same derived string whenever a
  // device is assigned a class/section, so the two can never disagree.
  // A fetch failure here (e.g. the Part 0 migration's grant not applied
  // yet) must NOT block Admin/VP/Cord from targeting 'All', or from ever
  // learning isBroad at all — degrades to "no Class-Section has a device
  // yet" rather than aborting the whole resolution. (Fixed after being
  // caught live: an earlier version returned {error} unconditionally here,
  // which made every caller — Admin included — look fully restricted.)
  const p10Res = await _sbStudent('p10_display_devices?select=device_hash,assigned_class,assigned_section&order=created_at.desc');
  const p10Rows = Array.isArray(p10Res) ? p10Res : [];
  const classSectionsWithDevice = new Set(p10Rows.map(r => `${r.assigned_class}||${r.assigned_section}`));

  let myClasses = null; // null = unrestricted (isBroad); else Set of "class||section"
  if (!isBroad) {
    const assignments = await _sbStudent(`class_teacher_assignments?user_id=eq.${encodeURIComponent(userId)}&select=class,section`);
    myClasses = new Set((Array.isArray(assignments) ? assignments : []).map(a => `${a.class}||${a.section}`));
  }

  const seen = new Set();
  const devices = [];
  classSections.forEach(s => {
    const cls = String(s.class || '').trim(), sec = String(s.section || '').trim();
    if (!cls || !sec) return;
    const key = `${cls}||${sec}`;
    if (seen.has(key)) return;
    if (myClasses && !myClasses.has(key)) return;
    seen.add(key);
    const hasDevice = classSectionsWithDevice.has(key);
    devices.push({ value: hasDevice ? `${cls}-${sec}` : null, label: `${cls} - ${sec}`, has_device: hasDevice });
  });
  devices.sort((a, b) => a.label.localeCompare(b.label));
  return { devices, canTargetAll: isBroad, p10Unavailable: !Array.isArray(p10Res) };
}

async function _getDevicesForTargeting(userId) {
  const { devices, canTargetAll, p10Unavailable } = await _resolveTargetableDevices(userId);
  return NextResponse.json({ result: 'success', devices, can_target_all: canTargetAll, p10_unavailable: p10Unavailable });
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

  if (action === 'get_devices_for_targeting') return _getDevicesForTargeting(user_id);
  if (action === 'upload_audio') return _uploadAnnouncementAudio(payload);

  if (action === 'save_announcement') {
    const { id, title, file_url, target_devices, active } = payload;
    // file_url is optional — a blank one is a deliberate "text-only"
    // announcement (the P10 firmware already fully supports this: it just
    // scrolls the title with nothing to download or play, see
    // fetchAnnouncements()/startPlayback() in p10_display/src/main.cpp).
    if (!title) return NextResponse.json({ result: 'error', message: 'Title is required.' }, { status: 400 });

    // Re-derive what THIS caller is actually allowed to target — a Class
    // Teacher submitting 'All' or another class's device by hand-crafting
    // the request must be rejected here, not just hidden from them in the
    // UI. Admin/VP/Cord are unrestricted (canTargetAll).
    const wantsAll = Array.isArray(target_devices) && target_devices.includes('All');
    const { devices: myDevices, canTargetAll } = await _resolveTargetableDevices(user_id);
    if (wantsAll && !canTargetAll) {
      return NextResponse.json({ result: 'error', message: 'You can only target your own class’s device(s), not All.' }, { status: 403 });
    }
    if (!canTargetAll) {
      const allowed = new Set(myDevices.map(d => d.value).filter(Boolean));
      const invalid = (Array.isArray(target_devices) ? target_devices : []).filter(t => t !== 'All' && !allowed.has(t));
      if (invalid.length) {
        return NextResponse.json({ result: 'error', message: `Not authorized to target: ${invalid.join(', ')}` }, { status: 403 });
      }
    }

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
