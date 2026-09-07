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
// roster — not just whichever device rows happen to exist), each resolved
// to an actual P10 display via TWO hops, not one:
//   Class-Section -> the NFC terminal assigned there (student.device_health
//     .assigned_class/section) -> that terminal's own identity string
//     (device_name_by_system, falling back to device_name/device_hash —
//     same precedence the Devices tab card uses to display an NFC
//     terminal's name) -> a P10 display whose paired_device_name matches
//     that identity (the admin picks "which NFC terminal is this P10
//     paired with" from a dropdown on the P10 card; save_device_config
//     stores the terminal's identity as-is, no class/section on the P10
//     row itself anymore).
// A Class-Section with no NFC terminal, or whose terminal has no P10
// paired to it, still shows (so the gap is visible) but isn't selectable.
// A Class Teacher (and nobody broader) only sees their own assigned
// Class-Section(s), never 'All'; Admin/VP/Cord see every one and may
// target 'All'. Deliberately keyed off the caller's OWN roles/
// assignments, never anything the client submits, same pattern as
// getMyClassAttendanceReport in app/api/exec/route.js.
async function _resolveTargetableDevices(userId) {
  const roles = await _getUserRoles(userId);
  const isBroad = roles.some(r => ['Admin', 'VP', 'Cord'].includes(r));

  const classRows = await _sbStudentAllRows('students_data?select=class,section');
  const classSections = classRows?.error ? [] : classRows;

  // Hop 1: which NFC terminal (by its own identity) serves each
  // Class-Section. A fetch failure here must not block Admin/VP/Cord from
  // targeting 'All' or from ever learning isBroad — degrades to "no
  // Class-Section has a terminal" rather than aborting the resolution.
  const nfcRes = await _sbStudent('device_health?select=device_hash,device_name,device_name_by_system,assigned_class,assigned_section&order=created_at.desc');
  const nfcRows = Array.isArray(nfcRes) ? nfcRes : [];
  const nfcIdentityByClassSection = new Map();
  nfcRows.forEach(r => {
    const key = `${r.assigned_class}||${r.assigned_section}`;
    if (nfcIdentityByClassSection.has(key)) return; // first (newest) row per class/section wins
    const identity = r.device_name_by_system || r.device_name || r.device_hash;
    if (identity) nfcIdentityByClassSection.set(key, identity);
  });

  // Hop 2: which of those NFC identities actually has a P10 paired to it.
  // (device_health is the separate NFC-terminal fleet — P10 is the fleet
  // that actually polls get_pending_announcements() and plays them; this
  // fetch failing — e.g. the Part 0 migration's grant not applied yet —
  // must equally not abort the resolution. Fixed after being caught live:
  // an earlier version returned {error} unconditionally on a P10-fetch
  // failure, which made every caller, Admin included, look fully
  // restricted before isBroad was ever computed.)
  const p10Res = await _sbStudent('p10_display_devices?select=paired_device_name&order=created_at.desc');
  const p10Rows = Array.isArray(p10Res) ? p10Res : [];
  const pairedIdentities = new Set(p10Rows.map(r => r.paired_device_name).filter(Boolean));

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
    const nfcIdentity = nfcIdentityByClassSection.get(key);
    const hasDevice = !!nfcIdentity && pairedIdentities.has(nfcIdentity);
    devices.push({ value: hasDevice ? nfcIdentity : null, label: `${cls} - ${sec}`, has_device: hasDevice });
  });
  devices.sort((a, b) => a.label.localeCompare(b.label));
  return { devices, canTargetAll: isBroad, p10Unavailable: !Array.isArray(p10Res) };
}

async function _getDevicesForTargeting(userId) {
  const { devices, canTargetAll, p10Unavailable } = await _resolveTargetableDevices(userId);
  return NextResponse.json({ result: 'success', devices, can_target_all: canTargetAll, p10_unavailable: p10Unavailable });
}

async function _isBroadRole(userId) {
  const roles = await _getUserRoles(userId);
  return roles.some(r => ['Admin', 'VP', 'Cord'].includes(r));
}

async function _myClassSections(userId) {
  const assignments = await _sbStudent(`class_teacher_assignments?user_id=eq.${encodeURIComponent(userId)}&select=class,section`);
  return new Set((Array.isArray(assignments) ? assignments : []).map(a => `${a.class}||${a.section}`));
}

async function _lookupStudent(studentId) {
  const rows = await _sbStudent(`students_data?student_id=eq.${encodeURIComponent(studentId)}&select=*`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Every student belonging to one of the caller's own assigned Class-Sections
// — used to scope a Class Teacher's view of student-targeted announcements
// (get_announcements) to just their own students, same restriction already
// applied when they create one.
async function _myClassStudentIds(userId) {
  const mine = await _myClassSections(userId);
  if (!mine.size) return new Set();
  const pages = await Promise.all([...mine].map(key => {
    const [cls, sec] = key.split('||');
    return _sbStudentAllRows(`students_data?class=eq.${encodeURIComponent(cls)}&section=eq.${encodeURIComponent(sec)}&select=student_id`);
  }));
  const ids = new Set();
  pages.forEach(p => { if (Array.isArray(p)) p.forEach(s => ids.add(s.student_id)); });
  return ids;
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
    if (await _isBroadRole(user_id)) return NextResponse.json({ result: 'success', announcements: rows });

    // Class Teacher: 'general' is for everyone so always visible; 'device'
    // only if it targets their own class's device (or 'All'); 'student'
    // only if the target is one of their own students. Same boundaries
    // enforced in save_announcement, applied here to the list too so a
    // Class Teacher can't see another class's device traffic or another
    // class's student-targeted messages.
    const [{ devices: myDevices }, myStudentIds] = await Promise.all([
      _resolveTargetableDevices(user_id),
      _myClassStudentIds(user_id),
    ]);
    const myDeviceValues = new Set(myDevices.map(d => d.value).filter(Boolean));
    const filtered = rows.filter(a => {
      const type = a.announcement_type || 'device';
      if (type === 'general') return true;
      if (type === 'student') return !!a.target_student_id && myStudentIds.has(a.target_student_id);
      const targets = Array.isArray(a.target_devices) ? a.target_devices : [];
      return targets.includes('All') || targets.some(t => myDeviceValues.has(t));
    });
    return NextResponse.json({ result: 'success', announcements: filtered });
  }

  if (action === 'get_devices_for_targeting') return _getDevicesForTargeting(user_id);
  if (action === 'upload_audio') return _uploadAnnouncementAudio(payload);

  if (action === 'lookup_student') {
    const { student_id } = payload;
    if (!student_id) return NextResponse.json({ result: 'error', message: 'student_id is required.' }, { status: 400 });
    const student = await _lookupStudent(student_id);
    if (!student) return NextResponse.json({ result: 'error', message: 'No student found with that ID.' }, { status: 404 });
    if (!(await _isBroadRole(user_id))) {
      const mine = await _myClassSections(user_id);
      if (!mine.has(`${student.class}||${student.section}`)) {
        return NextResponse.json({ result: 'error', message: 'That student is not in your class.' }, { status: 403 });
      }
    }
    return NextResponse.json({ result: 'success', student });
  }

  // Populates the Class > Section cascading picker for the "specific
  // student" target type — a Class Teacher only sees their own class(es),
  // same scoping as _resolveTargetableDevices.
  if (action === 'get_student_picker_options') {
    const rows = await _sbStudentAllRows('students_data?select=class,section');
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    let allowed = rows;
    if (!(await _isBroadRole(user_id))) {
      const mine = await _myClassSections(user_id);
      allowed = rows.filter(r => mine.has(`${r.class}||${r.section}`));
    }
    const classSet = new Set();
    const sectionsByClass = {};
    allowed.forEach(r => {
      const cls = String(r.class || '').trim(), sec = String(r.section || '').trim();
      if (!cls || !sec) return;
      classSet.add(cls);
      if (!sectionsByClass[cls]) sectionsByClass[cls] = new Set();
      sectionsByClass[cls].add(sec);
    });
    const sections_by_class = {};
    Object.entries(sectionsByClass).forEach(([c, set]) => { sections_by_class[c] = [...set].sort(); });
    return NextResponse.json({ result: 'success', classes: [...classSet].sort(), sections_by_class });
  }

  // Group/Session are optional narrowing filters on top of Class+Section —
  // the roll list is the final step of the cascading picker.
  if (action === 'search_roster_students') {
    const { class: cls, section, group, session } = payload;
    if (!cls || !section) return NextResponse.json({ result: 'error', message: 'Class and section are required.' }, { status: 400 });
    if (!(await _isBroadRole(user_id))) {
      const mine = await _myClassSections(user_id);
      if (!mine.has(`${cls}||${section}`)) return NextResponse.json({ result: 'error', message: 'Not your class.' }, { status: 403 });
    }
    let path = `students_data?class=eq.${encodeURIComponent(cls)}&section=eq.${encodeURIComponent(section)}`;
    if (group) path += `&group=eq.${encodeURIComponent(group)}`;
    if (session) path += `&session=eq.${encodeURIComponent(session)}`;
    path += '&select=*&order=roll.asc';
    const rows = await _sbStudentAllRows(path);
    if (rows?.error) return NextResponse.json({ result: 'error', message: rows.error }, { status: 500 });
    return NextResponse.json({ result: 'success', students: rows });
  }

  if (action === 'save_announcement') {
    const { id, title, file_url, target_devices, active, subtitle, body, target_student_id } = payload;
    const announcement_type = ['general', 'student'].includes(payload.announcement_type) ? payload.announcement_type : 'device';
    if (!title) return NextResponse.json({ result: 'error', message: 'Title is required.' }, { status: 400 });

    let rowData;
    if (announcement_type === 'general') {
      // School-wide banner shown in the student portal — HTML/text only by
      // design (no audio field for this type at all), never touches a
      // physical device. Restricted to Admin/VP/Cord: unlike 'device'
      // (scoped to one class) or 'student' (scoped to one student), this
      // reaches literally every guardian, which is broader than what a
      // Class Teacher should be able to trigger unsupervised.
      if (!(await _isBroadRole(user_id))) {
        return NextResponse.json({ result: 'error', message: 'Only Admin/VP/Cord can send a general (school-wide) announcement.' }, { status: 403 });
      }
      rowData = {
        title, announcement_type: 'general', subtitle: subtitle || null, body: body || null,
        file_url: '', target_devices: [], target_student_id: null,
        active: active !== false, created_by: user_id,
      };
    } else if (announcement_type === 'student') {
      if (!target_student_id) return NextResponse.json({ result: 'error', message: 'Pick a student to target.' }, { status: 400 });
      const student = await _lookupStudent(target_student_id);
      if (!student) return NextResponse.json({ result: 'error', message: 'No student found with that ID.' }, { status: 404 });
      if (!(await _isBroadRole(user_id))) {
        const mine = await _myClassSections(user_id);
        if (!mine.has(`${student.class}||${student.section}`)) {
          return NextResponse.json({ result: 'error', message: 'That student is not in your class.' }, { status: 403 });
        }
      }
      rowData = {
        title, announcement_type: 'student', target_student_id, subtitle: null, body: null,
        file_url: file_url || '', target_devices: [],
        active: active !== false, created_by: user_id,
      };
    } else {
      // file_url is optional — a blank one is a deliberate "text-only"
      // announcement (the P10 firmware already fully supports this: it just
      // scrolls the title with nothing to download or play, see
      // fetchAnnouncements()/startPlayback() in p10_display/src/main.cpp).
      //
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
      rowData = {
        title, announcement_type: 'device', target_student_id: null, subtitle: null, body: null,
        file_url: file_url || '',
        target_devices: Array.isArray(target_devices) && target_devices.length ? target_devices : ['All'],
        active: active !== false, created_by: user_id,
      };
    }

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
        { key: 'target_student_id', label: 'Target Student' }, { key: 'announcement_type', label: 'Type' },
      ]);
      _annAudit(user_id, 'edit_announcement', id, { changes });
    } else {
      _annAudit(user_id, 'create_announcement', savedRow?.id, { title, announcement_type, target_devices: rowData.target_devices, target_student_id: rowData.target_student_id });
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
