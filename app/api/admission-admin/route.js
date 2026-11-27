import { NextResponse } from 'next/server';

// ── Admission Admin (native port of the standalone ccpc-admission app) ─────
// ccpc-admission is a separate Next.js app, own repo/deployment/login,
// sharing this same Supabase project under its own `admission` Postgres
// schema (confirmed: unified-schema.sql does CREATE SCHEMA admission, and
// ccpc-admission's own app/api/exec/route.js already talks to it via
// Accept-Profile/Content-Profile: admission). Porting it natively into the
// Faculty Portal means "Admission Admin" needs no second login and no tab.
//
// Auth model: identical to app/api/inventory-admin/route.js — the caller
// sends their OWN ccpc-teachers user_id; every request is re-verified fresh
// against teacher_staff.app_users for the 'Admin' or 'Admission Admin' role.
//
// Phase 1 of the native port: application dashboard + full application
// editor (list/get/save/delete/status/bulk-status/code-lookup/stats), plus
// getFormFields (read-only here — just label lookups for the custom-fields
// block; the Form Fields *editor* itself is Phase 2). Settings/Circular/
// Payments/Counters/SMS/Scan/Form-Designer/Admit-Card-Designer are later
// phases, same as the reference app's own admin tab bar.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbAdmission(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      'Accept-Profile': 'admission',
      'Content-Profile': 'admission',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Full-roster read via Range-header pagination (same pattern as
// app/api/student-admin/route.js's own sbAllRows), not a single capped
// page -- listApplications used a flat `limit=1000`, which silently
// truncated the Dashboard's totals/breakdowns once a circular's roster
// (e.g. a VortiBD-synced one) grew past 1000 rows.
//
// The first page asks PostgREST for an exact count (Content-Range's
// ".../<total>" suffix) so every remaining page can be requested in
// PARALLEL instead of one-page-at-a-time -- a ~3800-row roster was taking
// 4 sequential round-trips (each paying full network latency) to load the
// Applications tab; this collapses it to effectively one round-trip's
// worth of wait. Falls back to the old sequential walk if the server ever
// doesn't return a usable count (e.g. an unexpected PostgREST config).
async function sbAdmissionAllRows(path) {
  const PAGE = 1000;
  const headers = (range, withCount) => ({
    apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'admission',
    Range: range, ...(withCount ? { Prefer: 'count=exact' } : {}),
  });
  const first = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(`0-${PAGE - 1}`, true) });
  if (!first.ok) return { error: await first.text() };
  const firstPage = await first.json();
  if (!Array.isArray(firstPage)) return { error: 'Unexpected response shape' };

  const contentRange = first.headers.get('content-range') || '';
  const m = contentRange.match(/\/(\d+)$/);
  const total = m ? parseInt(m[1], 10) : null;

  if (total === null || firstPage.length < PAGE || total <= firstPage.length) return firstPage;

  const offsets = [];
  for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset);
  try {
    const pages = await Promise.all(offsets.map(async offset => {
      const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(`${offset}-${offset + PAGE - 1}`, false) });
      if (!res.ok) throw new Error(await res.text());
      const page = await res.json();
      if (!Array.isArray(page)) throw new Error('Unexpected response shape');
      return page;
    }));
    let all = firstPage;
    pages.forEach(p => { all = all.concat(p); });
    return all;
  } catch (e) {
    // Fall back to the original sequential walk on any parallel-fetch error.
    let all = firstPage;
    let offset = firstPage.length < PAGE ? total : PAGE;
    while (offset < total) {
      const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(`${offset}-${offset + PAGE - 1}`, false) });
      if (!res.ok) return { error: await res.text() };
      const page = await res.json();
      if (!Array.isArray(page)) return { error: 'Unexpected response shape' };
      all = all.concat(page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }
}

async function sbAdmissionRpc(fn, params = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'admission',
      'Content-Profile': 'admission',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) return null;
  return text ? JSON.parse(text) : null;
}

// Cross-schema read into the Inventory module's rooms registry (Part 9:
// Admission's Rooms tab/Seat Allocation now share inventory.rooms rather
// than a circular-scoped table) -- needed here only to resolve a room_id
// into its human-readable name for the Dashboard/Applications list's room
// badge. Self-contained copy of app/api/admission-candidates/route.js's own
// sbInventory(), per this repo's no-shared-lib convention.
async function sbInventory(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'inventory' },
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

const ALLOC_FIELDS = ['class', 'category', 'version', 'session', 'status', 'source'];

// Part 14: live auto-seat-allocation -- self-contained copy of
// app/api/admission-candidates/route.js's own _tryAutoAllocate (no shared
// import, matching this repo's convention). Called after a brand-new
// native application is created here (saveApplication's !id branch), so it
// seats immediately exactly like a new import row or online submission
// would. See migration_admission_seat_auto_allocation.sql for the
// ordering/overflow guarantees.
async function _tryAutoAllocate(circularId, candidate) {
  const rules = await sbAdmission(`seat_auto_allocation_rules?circular_id=eq.${circularId}&active=eq.true`);
  if (!Array.isArray(rules) || !rules.length) return;
  const rule = rules.find(r => {
    const filters = r.filters || {};
    const hasFilter = ALLOC_FIELDS.some(f => filters[f]);
    return hasFilter && ALLOC_FIELDS.every(f => !filters[f] || filters[f] === candidate[f]);
  });
  if (!rule) return;
  const roomIds = Array.isArray(rule.room_ids) ? rule.room_ids : [];
  if (!roomIds.length) return;

  const roomsRes = await sbInventory(`rooms?id=in.(${roomIds.join(',')})&select=id,capacity`);
  const byId = {};
  (Array.isArray(roomsRes) ? roomsRes : []).forEach(r => { byId[r.id] = r.capacity; });
  const capacities = roomIds.map(id => byId[id] || 0);

  let roomIdx = rule.next_room_idx || 0, seatInRoom = rule.next_seat_in_room || 0;
  while (roomIdx < roomIds.length && seatInRoom >= capacities[roomIdx]) { roomIdx++; seatInRoom = 0; }
  const now = new Date().toISOString();
  if (roomIdx >= roomIds.length) {
    await sbAdmission(`seat_auto_allocation_rules?id=eq.${rule.id}`, 'PATCH', { overflow_count: (rule.overflow_count || 0) + 1, updated_at: now });
    return;
  }

  const roomId = roomIds[roomIdx];
  const seatNo = String(seatInRoom + 1);
  await sbAdmission(`admission_applications?id=eq.${candidate.id}`, 'PATCH', { room_id: roomId, seat_no: seatNo, updated_at: now });

  seatInRoom++;
  if (seatInRoom >= capacities[roomIdx]) { roomIdx++; seatInRoom = 0; }
  await sbAdmission(`seat_auto_allocation_rules?id=eq.${rule.id}`, 'PATCH', { next_room_idx: roomIdx, next_seat_in_room: seatInRoom, updated_at: now });
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
async function _isAdmissionAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Admission Admin');
}

// ── Part 6: committee permissions, widened to cover this route's own views
// ('applications' = Dashboard + New Application/Form, 'admin_settings' = the
// Settings view) alongside the 8 Candidates-tab keys already used by
// app/api/admission-candidates/route.js's circular_committee_members rows --
// same table, same permissions shape, duplicated helpers per this codebase's
// no-shared-lib convention (identical to that route's own _getCommitteePerms/
// _tabOk/_forbidden).
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
function _forbidden() { return NextResponse.json({ error: 'Not permitted for your committee role.' }, { status: 403 }); }

// Canonical built-in field list — kept identical to ccpc-admission's own
// app/api/apply/route.js + app/api/exec/route.js (duplicated rather than
// shared across repos/deployments, matching both apps' existing convention
// of self-contained route files).
const BUILTIN_FORM_FIELDS = [
  { key: 'name_english', label: "Student's name (English)", type: 'text', section: 'student', required: true, visible: true, built_in: true, wide: true, placeholder: 'As per birth certificate' },
  { key: 'name_bangla', label: "Student's name (Bangla)", type: 'text', section: 'student', required: false, visible: true, built_in: true, wide: true, placeholder: 'নাম' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date', section: 'student', required: false, visible: true, built_in: true },
  { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'], section: 'student', required: false, visible: true, built_in: true },
  { key: 'blood_group', label: 'Blood group', type: 'text', section: 'student', required: false, visible: true, built_in: true, placeholder: 'e.g. B+' },
  { key: 'religion', label: 'Religion', type: 'text', section: 'student', required: false, visible: true, built_in: true },
  { key: 'birth_reg_no', label: 'Birth registration no.', type: 'text', section: 'student', required: false, visible: true, built_in: true },
  { key: 'nationality', label: 'Nationality', type: 'text', default: 'Bangladeshi', section: 'student', required: false, visible: true, built_in: true },
  { key: 'emergency_contact', label: 'Emergency contact no.', type: 'phone', section: 'student', required: false, visible: true, built_in: true, placeholder: '+8801…' },
  { key: 'height', label: 'Height (inch)', type: 'text', section: 'student', required: false, visible: true, built_in: true },
  { key: 'last_class', label: 'Last class', type: 'text', section: 'student', required: false, visible: true, built_in: true },
  { key: 'last_version', label: 'Last version', type: 'text', section: 'student', required: false, visible: true, built_in: true },
  { key: 'last_institute', label: 'Last institute', type: 'text', section: 'student', required: false, visible: true, built_in: true, wide: true },
  { key: 'present_address', label: 'Present address', type: 'textarea', section: 'student', required: false, visible: true, built_in: true, wide: true },
  { key: 'permanent_address', label: 'Permanent address', type: 'textarea', section: 'student', required: false, visible: true, built_in: true, wide: true },
  { key: 'co_curricular', label: 'Co-curricular activities', type: 'text', section: 'student', required: false, visible: true, built_in: true, wide: true, placeholder: 'e.g. Football, Drawing, Singing' },
  { key: 'student_photo', label: "Student's photo", type: 'photo', section: 'student', required: true, visible: true, built_in: true, wide: true },

  { key: 'father_name', label: "Father's name", type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_profession', label: 'Profession / occupation', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_designation', label: 'Designation / rank', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_education', label: 'Education', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_contact', label: 'Contact no.', type: 'phone', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_nid', label: 'NID', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_office_address', label: 'Office address / unit', type: 'text', section: 'father', required: false, visible: true, built_in: true, wide: true },
  { key: 'father_yearly_income', label: 'Yearly income', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_photo', label: "Father's photo", type: 'photo', section: 'father', required: false, visible: true, built_in: true, wide: true },

  { key: 'mother_name', label: "Mother's name", type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_profession', label: 'Profession / occupation', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_designation', label: 'Designation / rank', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_education', label: 'Education', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_contact', label: 'Contact no.', type: 'phone', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_nid', label: 'NID', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_office_address', label: 'Office address / unit', type: 'text', section: 'mother', required: false, visible: true, built_in: true, wide: true },
  { key: 'mother_yearly_income', label: 'Yearly income', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_photo', label: "Mother's photo", type: 'photo', section: 'mother', required: false, visible: true, built_in: true, wide: true },

  { key: 'guardian_name', label: "Guardian's name", type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_relation', label: 'Relation', type: 'text', section: 'guardian', required: false, visible: true, built_in: true, placeholder: 'e.g. Father' },
  { key: 'guardian_profession', label: 'Profession / occupation', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_designation', label: 'Designation / rank', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_education', label: 'Education', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_contact', label: 'Contact no.', type: 'phone', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_office_address', label: 'Office address / unit', type: 'text', section: 'guardian', required: false, visible: true, built_in: true, wide: true },
  { key: 'guardian_nid', label: 'Guardian NID', type: 'text', section: 'guardian', required: false, visible: false, built_in: true },
  { key: 'guardian_photo', label: "Guardian's photo", type: 'photo', section: 'guardian', required: false, visible: true, built_in: true, wide: true },
];
function reconcileFormFields(stored) {
  const list = Array.isArray(stored) ? stored.slice() : [];
  const byKey = {};
  BUILTIN_FORM_FIELDS.forEach(def => { byKey[def.key] = def; });
  // A built-in field's type/options/placeholder/wide/default are fixed by
  // this file and never admin-editable (the Form Fields UI shows a
  // built-in's type as a static label, not a <select>) -- so an
  // already-saved entry for one of these keys always gets those canonical
  // values re-applied here. This is what lets a change like marking
  // mother_contact/father_contact/guardian_contact/emergency_contact as
  // type:'phone' reach circulars that already saved their Form Fields list
  // under the old type:'text' default, without touching the admin's own
  // edits to that field's label/required/visible.
  list.forEach(f => {
    const def = f && byKey[f.key];
    if (def) { f.type = def.type; f.options = def.options; f.placeholder = def.placeholder; f.wide = def.wide; f.default = def.default; }
  });
  const seen = new Set(list.map(f => f && f.key));
  BUILTIN_FORM_FIELDS.forEach(def => { if (!seen.has(def.key)) list.push({ ...def }); });
  return list;
}

// ── Index-ID generation (ported verbatim from ccpc-admission's exec/route.js
// so a native-admin-created application gets an identical ID shape) ────────
function circSymbolServer(entry, dims) {
  const parts = (dims || []).map(dim => {
    const sel = ((entry.selections || {})[dim.id]) || [];
    if (!sel.length) return null;
    const syms = [];
    (dim.options || []).forEach(opt => {
      if (sel.includes(opt.value) && opt.symbol && !syms.includes(opt.symbol)) syms.push(opt.symbol);
    });
    return syms.join('') || null;
  }).filter(Boolean);
  return parts.join('-');
}
function findCircularEntry(appData, circ) {
  const dims = circ.dimensions || [];
  const LABEL_FIELD = { Class: 'class', Version: 'version', Category: 'category', Group: 'group', Section: 'section' };
  return (circ.entries || []).find(entry => {
    if (!entry.active) return false;
    return dims.every(dim => {
      const field = LABEL_FIELD[dim.label];
      if (!field) return true;
      const sel = ((entry.selections || {})[dim.id]) || [];
      if (!sel.length) return true;
      return sel.includes(appData[field]);
    });
  });
}
function buildIndexId(settings, session, cls, cat, counter) {
  const pattern    = settings.pattern || '{YY}{CLASS}{SEQ4}';
  const classCodes = settings.classCodes || {};
  const catCodes   = settings.categoryCodes || {};
  const yr         = String(session || new Date().getFullYear());
  const classCode  = classCodes[cls] || '';
  const seq        = counter || 1;
  return pattern
    .replace('{YYYY}', yr)
    .replace('{YY}', yr.slice(-2))
    .replace('{CLASS}', classCode)
    .replace('{CAT}', catCodes[cat] || 'X')
    .replace('{SEQ5}', String(seq).padStart(5, '0'))
    .replace('{SEQ4}', String(seq).padStart(4, '0'))
    .replace('{SEQ3}', String(seq).padStart(3, '0'));
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;
  const isFullAdmin = await _isAdmissionAdmin(user_id);
  // Export templates (shared by this route AND app/api/admission-candidates/
  // route.js -- one global pool, not circular-scoped, confirmed via
  // AskUserQuestion) handled up front, before the circular-scoped committee
  // gating below, since they have no circular_id to resolve at all. Listing
  // is open to any signed-in user (so a committee member can pick/use an
  // existing template); creating/editing/deleting one is admin-only.
  if (action === 'listExportTemplates') {
    if (!user_id) return _forbidden();
    const rows = await sbAdmission('export_templates?select=*&order=name.asc');
    return NextResponse.json({ templates: Array.isArray(rows) ? rows : [] });
  }
  if (action === 'saveExportTemplate') {
    if (!isFullAdmin) return NextResponse.json({ error: 'Only an Admin/Admission Admin can save export templates.' }, { status: 403 });
    const name = String(payload.name || '').trim();
    if (!name) return NextResponse.json({ error: 'A template name is required.' });
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const printSettings = (payload.print_settings && typeof payload.print_settings === 'object') ? payload.print_settings : {};
    const id = parseInt(payload.id, 10);
    const data = { name, columns, print_settings: printSettings, updated_at: new Date().toISOString() };
    if (id) {
      const res = await sbAdmission(`export_templates?id=eq.${id}`, 'PATCH', data);
      if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A template with this name already exists.' : res.error });
      return NextResponse.json({ success: true, id });
    }
    data.created_by = user_id;
    const res = await sbAdmission('export_templates', 'POST', data);
    if (res?.error) return NextResponse.json({ error: res.error.includes('duplicate') ? 'A template with this name already exists.' : res.error });
    return NextResponse.json({ success: true, id: res?.[0]?.id });
  }
  if (action === 'deleteExportTemplate') {
    if (!isFullAdmin) return NextResponse.json({ error: 'Only an Admin/Admission Admin can delete export templates.' }, { status: 403 });
    await sbAdmission(`export_templates?id=eq.${parseInt(payload.id, 10) || 0}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  // Saving/deleting a Custom Count card is admin-only, full stop -- not
  // something a committee member's 'applications' edit grant extends to
  // (unlike regular application edits). Checked before the generic
  // committee-permission logic below, which only ever ADDS access for
  // non-admins, never restricts it below what that logic would otherwise allow.
  if (!isFullAdmin && (action === 'saveCustomCounter' || action === 'deleteCustomCounter' || action === 'saveCustomCounterLayout' || action === 'saveApplicantColumns')) {
    return NextResponse.json({ error: 'Only an Admin/Admission Admin can manage this dashboard layout.' }, { status: 403 });
  }
  if (!isFullAdmin) {
    // A committee member (no Admin/Admission Admin role) may only reach this
    // route via a per-circular 'applications' or 'admin_settings' grant --
    // every other action here (and any action that can't resolve a
    // circular_id) stays closed. Session/circular management itself lives
    // entirely in app/api/admission-candidates/route.js, not here.
    // saveCustomCounter/deleteCustomCounter already returned 403 above for
    // every non-admin, so they're deliberately left out of both sets here.
    // 'dashboard' and 'applications' are now two independent permissions
    // (previously one merged 'applications' grant) -- a member can be given
    // Dashboard stats/breakdowns without also being able to open, edit, or
    // delete individual application records, and vice versa.
    const DASHBOARD_ACTIONS = new Set(['getStats', 'listCustomCounters']);
    const APPLICATIONS_ACTIONS = new Set(['getApplication', 'saveApplication', 'deleteApplication', 'updateStatus', 'bulkUpdateStatus', 'bulkDeleteApplications', 'lookupByCode']);
    const EDIT_ACTIONS = new Set(['saveApplication', 'deleteApplication', 'updateStatus', 'bulkUpdateStatus', 'bulkDeleteApplications', 'saveSettings', 'saveFormFields', 'resetCounter', 'verifyPayment', 'markPaid', 'issueAdmits', 'sendTestSms']);
    const tab = DASHBOARD_ACTIONS.has(action) ? 'dashboard' : APPLICATIONS_ACTIONS.has(action) ? 'applications' : 'admin_settings';
    const level = EDIT_ACTIONS.has(action) ? 'edit' : 'view';
    let circularId = parseInt(payload.circular_id, 10) || null;
    // For actions that act on an EXISTING row by id, resolve the circular_id
    // from the row itself -- never trust a client-claimed circular_id for
    // these, or a committee member permitted on circular A could mutate a
    // row that actually belongs to circular B just by lying in the payload.
    const ROW_ID_ACTIONS = { getApplication: 'id', deleteApplication: 'id', updateStatus: 'id' };
    if (ROW_ID_ACTIONS[action] || (action === 'saveApplication' && payload.id)) {
      const rowId = parseInt(payload[ROW_ID_ACTIONS[action] || 'id'], 10);
      const rows = rowId ? await sbAdmission(`admission_applications?id=eq.${rowId}&select=circular_id`) : null;
      circularId = (Array.isArray(rows) && rows[0]) ? rows[0].circular_id : null;
    } else if (action === 'bulkUpdateStatus' || action === 'bulkDeleteApplications') {
      const ids = Array.isArray(payload.ids) ? payload.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
      const rows = ids.length ? await sbAdmission(`admission_applications?id=in.(${ids.join(',')})&select=circular_id`) : [];
      const distinct = [...new Set((Array.isArray(rows) ? rows : []).map(r => r.circular_id))];
      circularId = distinct.length === 1 ? distinct[0] : null;
    }
    if (!circularId) return _forbidden();
    const perms = await _getCommitteePerms(user_id, circularId);
    // getFormFields is shared, low-sensitivity metadata (field names/types,
    // not applicant data) that the Candidates module's mapping screen also
    // needs to read (Part 8) -- a committee member granted only 'import'
    // there (and no 'admin_settings' grant at all) can still read it.
    const formFieldsReadOk = action === 'getFormFields' && _tabOk(false, perms, 'import', 'view');
    // listApplications feeds BOTH the Dashboard's breakdowns (computed
    // client-side from the full roster) and the Applications tab's own
    // table -- either grant unlocks the underlying read, since Dashboard
    // breakdowns can't be computed without it. The two tabs' own UI/edit
    // controls still gate separately (see _admModuleCan('applications', …)
    // client-side and EDIT_ACTIONS above for the real write boundary).
    const listAppsOk = (action === 'listApplications' || action === 'getApplicantColumns' || action === 'getApplicationsFingerprint' || action === 'getApplicationsFullById') && (_tabOk(false, perms, 'dashboard', 'view') || _tabOk(false, perms, 'applications', 'view'));
    if (!_tabOk(false, perms, tab, level) && !formFieldsReadOk && !listAppsOk) return _forbidden();
  }

  // ── List Applications ────────────────────────────────────────────────────
  // Part 8: rows may now come from either this editor (source: 'native') or
  // the Candidates module's VortiBD import/sync (source: 'vortibd') -- an
  // optional source filter lets the Dashboard's filter chip tell them apart;
  // token is selected too so a VortiBD-sourced row (no tracking_id/index_id)
  // still has something identifying to show in the list.
  if (action === 'listApplications') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ applications: [] });
    // scan_values included so the Dashboard/Applications filter panel's
    // dynamic Scan Option dimensions (Part 10) have real data to read --
    // without it every row's scan_values would be undefined client-side.
    // Father/mother/guardian name+contact added so the Applications table's
    // row can show a compact "Family" column without a per-row fetch.
    // room_id/seat_no added: Part 9's seat allocation writes these (FK into
    // the shared inventory.rooms registry), not the legacy room_no text
    // column -- without selecting+resolving them here, every seat-allocated
    // row's room badge in the Dashboard/Applications table silently stayed
    // blank (room_no is only ever set by the separate Payments/Admit-issuing
    // flow, a different feature, left untouched here).
    // Full field set the admin-configurable column layout (applicant_columns,
    // see getApplicantColumns/saveApplicantColumns below) can draw from --
    // added once here rather than per-column, so any combination the admin
    // picks already has real data to show.
    // updated_at included so the client can derive its own baseline
    // fingerprint (count + max updated_at) right after a full load, with no
    // extra round trip -- see getApplicationsFingerprint below, which the
    // Dashboard's background poll checks against that baseline instead of
    // re-pulling every column of every row on a fixed timer.
    // extra_fields included so custom Form Fields (e.g. a VortiBD "Roll No."
    // column mapped onto a custom field during import) actually have data to
    // show in the Applications table -- without it, the column picker's
    // "Custom (mapped)" fields always rendered blank regardless of whether
    // real data had been imported into them.
    // scan_dates + last_scanned_at included alongside scan_values: scan_dates
    // (full per-option scan timeline) is what lets the table show every scan
    // date when a candidate was scanned more than once, not just the
    // current value's own scanned_at; last_scanned_at (global across every
    // option) is what the existing Scanned-Between filter/Last-Scanned sort
    // actually need -- it was missing from this select entirely before, so
    // those silently had nothing to compare against.
    // order=created_at.desc,id.desc -- created_at alone is NOT unique (bulk
    // VortiBD/Excel imports routinely insert many rows in the same instant),
    // and sbAdmissionAllRows below pages this via PARALLEL Range-header
    // requests. Without a unique tie-breaker, Postgres has no guarantee which
    // order tied rows come back in across separate query executions, so a
    // row sitting at a page boundary could land on both pages (inflating the
    // Dashboard's totals) or neither (deflating them) from one fetch to the
    // next, with zero real data changes -- this is what was actually behind
    // a live-reported "Custom Count/Submission Summary fluctuates even with
    // no one inputting anything" bug. `id` (the primary key) makes the sort
    // fully deterministic regardless of how many rows share a created_at.
    let q = `admission_applications?select=id,tracking_id,index_id,token,source,name_english,name_bangla,class,category,version,session,status,stage,payment_status,room_no,room_id,seat_no,scan_values,scan_dates,last_scanned_at,extra_fields,created_at,updated_at,date_of_birth,gender,blood_group,present_address,permanent_address,father_name,father_profession,father_designation,father_contact,father_office_address,mother_name,mother_profession,mother_designation,mother_contact,mother_office_address,guardian_name,guardian_contact,guardian_relation&circular_id=eq.${circularId}&order=created_at.desc,id.desc`;
    if (payload.class)   q += `&class=eq.${encodeURIComponent(payload.class)}`;
    if (payload.status)  q += `&status=eq.${encodeURIComponent(payload.status)}`;
    if (payload.source)  q += `&source=eq.${encodeURIComponent(payload.source)}`;
    const rows = await sbAdmissionAllRows(q);
    if (rows?.error) return NextResponse.json({ error: rows.error });
    const BLDG_PREFIXES = { SB: 'School Building', HB: 'Honors Building', CB: 'College Building', MB: 'Main Building', JB: 'Junior Block' };
    const _guessBldg = (rName) => {
      const m = /^([A-Za-z]{2,3})[-_\s]/.exec(String(rName || '').trim());
      return (m && BLDG_PREFIXES[m[1].toUpperCase()]) || '';
    };
    const roomIds = [...new Set((rows || []).map(r => r.room_id).filter(Boolean))];
    const roomInfoById = {};
    if (roomIds.length) {
      const [roomRows, bldgRows] = await Promise.all([
        sbInventory(`rooms?id=in.(${roomIds.join(',')})&select=id,name,building_id`),
        sbInventory('buildings?select=id,name'),
      ]);
      const bldgById = {};
      (Array.isArray(bldgRows) ? bldgRows : []).forEach(b => { bldgById[b.id] = b.name; });
      (Array.isArray(roomRows) ? roomRows : []).forEach(r => {
        roomInfoById[r.id] = { name: r.name || '', building: (r.building_id && bldgById[r.building_id]) || _guessBldg(r.name) };
      });
    }
    (rows || []).forEach(r => {
      const info = r.room_id ? roomInfoById[r.room_id] : null;
      const rName = (info && info.name) || r.room_no || '';
      r.room_name = rName;
      r.room_no = rName;
      r.building = (info && info.building) || _guessBldg(rName) || '';
      r.seat_no = r.seat_no ?? '';
    });
    return NextResponse.json({ applications: rows || [] });
  }

  // ── Full-column export fetch (Export CSV button only) ───────────────────
  // Export CSV needs literally every database column for whatever rows are
  // CURRENTLY on screen after the admin's search/filter panel narrowed the
  // roster down -- that filtering is entirely client-side against the
  // already-loaded roster (see _admLastFiltered), so rather than
  // reimplement the filter panel's logic here, the client sends the exact
  // ids it's already showing and this returns select=* for just those rows.
  // Deliberately kept separate from listApplications' lean, hand-picked
  // select (used by the Dashboard's 20s poll and the normal table load) so
  // this one-off, user-initiated fetch never adds photo-column weight to
  // that hot path -- same egress-consciousness already documented there.
  if (action === 'getApplicationsFullById') {
    const circularId = parseInt(payload.circular_id, 10);
    const ids = Array.isArray(payload.ids) ? payload.ids.map(i => parseInt(i, 10)).filter(Boolean) : [];
    if (!circularId || !ids.length) return NextResponse.json({ applications: [] });
    const CHUNK = 300;
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
    const pages = await Promise.all(chunks.map(chunk =>
      sbAdmission(`admission_applications?select=*&circular_id=eq.${circularId}&id=in.(${chunk.join(',')})`)
    ));
    if (pages.some(p => p?.error)) return NextResponse.json({ error: 'Failed to load export data' });
    const byId = {};
    pages.forEach(p => (Array.isArray(p) ? p : []).forEach(r => { byId[r.id] = r; }));
    const ordered = ids.map(id => byId[id]).filter(Boolean);
    const BLDG_PREFIXES = { SB: 'School Building', HB: 'Honors Building', CB: 'College Building', MB: 'Main Building', JB: 'Junior Block' };
    const _guessBldg = (rName) => {
      const m = /^([A-Za-z]{2,3})[-_\s]/.exec(String(rName || '').trim());
      return (m && BLDG_PREFIXES[m[1].toUpperCase()]) || '';
    };
    const roomIds = [...new Set(ordered.map(r => r.room_id).filter(Boolean))];
    const roomInfoById = {};
    if (roomIds.length) {
      const [roomRows, bldgRows] = await Promise.all([
        sbInventory(`rooms?id=in.(${roomIds.join(',')})&select=id,name,building_id`),
        sbInventory('buildings?select=id,name'),
      ]);
      const bldgById = {};
      (Array.isArray(bldgRows) ? bldgRows : []).forEach(b => { bldgById[b.id] = b.name; });
      (Array.isArray(roomRows) ? roomRows : []).forEach(r => {
        roomInfoById[r.id] = { name: r.name || '', building: (r.building_id && bldgById[r.building_id]) || _guessBldg(r.name) };
      });
    }
    ordered.forEach(r => {
      const info = r.room_id ? roomInfoById[r.room_id] : null;
      const rName = (info && info.name) || r.room_no || '';
      r.room_name = rName;
      r.room_no = rName;
      r.building = (info && info.building) || _guessBldg(rName) || '';
      r.seat_no = r.seat_no ?? '';
    });
    return NextResponse.json({ applications: ordered });
  }

  // Cheap "has anything changed" check for the Dashboard's background poll
  // (every 20s while that tab is open) -- the roster is expected to grow
  // into the 10k+ range, and re-pulling every column of every row on a
  // fixed timer regardless of whether anything changed doesn't scale. One
  // exact row count (HEAD request, no body) + the single most recent
  // updated_at (a one-row, one-column select) is enough to detect any
  // insert/delete/edit/scan (every one of those already stamps updated_at,
  // including scans via admission-candidates' _applyScanValue) -- the full
  // listApplications re-fetch only runs when this tiny check says something
  // actually moved.
  if (action === 'getApplicationsFingerprint') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ count: 0, latest: null });
    const countRes = await fetch(`${SB_URL}/rest/v1/admission_applications?select=id&circular_id=eq.${circularId}`, {
      method: 'HEAD',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'admission', Prefer: 'count=exact' },
    });
    const cr = countRes.headers.get('content-range') || '';
    const cm = cr.match(/\/(\d+)$/);
    const count = cm ? parseInt(cm[1], 10) : null;
    const latestRows = await sbAdmission(`admission_applications?circular_id=eq.${circularId}&select=updated_at&order=updated_at.desc&limit=1`);
    const latest = (Array.isArray(latestRows) && latestRows[0]) ? latestRows[0].updated_at : null;
    return NextResponse.json({ count, latest });
  }

  // ── Applicant table column layout (admin-defined, per circular) ─────────
  // Which fields appear in the Applications table, grouped into which
  // column, in what order -- Status/Actions stay fixed trailing columns
  // client-side regardless. Lives on exam_circulars (that table, not this
  // route's own admission_applications, is already how this module stores
  // other per-circular display settings) -- read via the same sbAdmission
  // helper, no cross-route call needed for one jsonb column.
  if (action === 'getApplicantColumns') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ columns: [] });
    const rows = await sbAdmission(`exam_circulars?id=eq.${circularId}&select=applicant_columns`);
    return NextResponse.json({ columns: (Array.isArray(rows) && rows[0] && rows[0].applicant_columns) || [] });
  }
  if (action === 'saveApplicantColumns') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
    const columns = Array.isArray(payload.columns) ? payload.columns : [];
    const res = await sbAdmission(`exam_circulars?id=eq.${circularId}`, 'PATCH', { applicant_columns: columns });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true });
  }

  // ── Get Application ──────────────────────────────────────────────────────
  if (action === 'getApplication') {
    const rows = await sbAdmission(`admission_applications?id=eq.${payload.id}`);
    return NextResponse.json({ application: rows?.[0] || null });
  }

  // ── Save Application ─────────────────────────────────────────────────────
  if (action === 'saveApplication') {
    const { id, data } = payload;
    data.updated_at = new Date().toISOString();

    if (!id) {
      const circularId = parseInt(payload.circular_id, 10);
      if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
      data.circular_id = circularId;
      const trackingId = await sbAdmissionRpc('generate_tracking_id', {});
      data.tracking_id = trackingId || Math.random().toString(16).slice(2, 8).toUpperCase();

      const [settingsRows, circRows] = await Promise.all([
        sbAdmission('admission_settings?key=eq.index_settings'),
        sbAdmission(`exam_circulars?id=eq.${circularId}&select=index_dimensions`),
      ]);
      const indexSettings = settingsRows?.find(r => r.key === 'index_settings')?.value || {};
      const circSettings  = (Array.isArray(circRows) && circRows[0] && circRows[0].index_dimensions) || {};
      let counterKey = data.class || '';
      if (circSettings.useSymbolCounter && circSettings.entries && circSettings.dimensions) {
        const matched = findCircularEntry(data, circSettings);
        if (matched) {
          const sym = matched.symbolOverride || circSymbolServer(matched, circSettings.dimensions);
          if (sym) counterKey = sym;
        }
      }
      const counter = await sbAdmissionRpc('increment_index_counter', {
        p_year: String(data.session || new Date().getFullYear()),
        p_class: counterKey,
      });
      data.index_id   = buildIndexId(indexSettings, data.session, data.class, data.category, counter);
      data.created_at = new Date().toISOString();
      data.status     = data.status || 'Pending';

      const res = await sbAdmission('admission_applications', 'POST', data);
      if (res?.error) return NextResponse.json({ error: res.error });
      if (Array.isArray(res) && res[0]) await _tryAutoAllocate(circularId, res[0]);
      return NextResponse.json({ id: res?.[0]?.id, tracking_id: data.tracking_id, index_id: data.index_id });
    } else {
      delete data.circular_id; // reassigning an application to a different circular isn't supported via edit
      const res = await sbAdmission(`admission_applications?id=eq.${id}`, 'PATCH', data);
      if (res?.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ id });
    }
  }

  // ── Delete Application ───────────────────────────────────────────────────
  if (action === 'deleteApplication') {
    await sbAdmission(`admission_applications?id=eq.${payload.id}`, 'DELETE');
    return NextResponse.json({ success: true });
  }

  // ── Update Status ────────────────────────────────────────────────────────
  if (action === 'updateStatus') {
    await sbAdmission(`admission_applications?id=eq.${payload.id}`, 'PATCH',
      { status: payload.status, updated_at: new Date().toISOString() });
    return NextResponse.json({ success: true });
  }

  // ── Bulk status update ───────────────────────────────────────────────────
  if (action === 'bulkUpdateStatus') {
    const ids = Array.isArray(payload.ids) ? payload.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return NextResponse.json({ error: 'No applications selected.' });
    if (ids.length > 300) return NextResponse.json({ error: 'Select 300 or fewer applications at a time.' });
    if (!payload.status) return NextResponse.json({ error: 'Pick a status to apply.' });
    const res = await sbAdmission(`admission_applications?id=in.(${ids.join(',')})`, 'PATCH',
      { status: payload.status, updated_at: new Date().toISOString() });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true, count: ids.length });
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────
  if (action === 'bulkDeleteApplications') {
    const ids = Array.isArray(payload.ids) ? payload.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return NextResponse.json({ error: 'No applications selected.' });
    if (ids.length > 300) return NextResponse.json({ error: 'Select 300 or fewer applications at a time.' });
    const res = await sbAdmission(`admission_applications?id=in.(${ids.join(',')})`, 'DELETE');
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ success: true, count: ids.length });
  }

  // ── Look up by scanned code (QR on an admit card/application — Phase 3 UI) ─
  if (action === 'lookupByCode') {
    const code = String(payload.code || '').trim();
    if (!code) return NextResponse.json({ error: 'No code scanned.' });
    const circularId = parseInt(payload.circular_id, 10);
    const scope = circularId ? `&circular_id=eq.${circularId}` : '';
    const cols = 'id,tracking_id,index_id,name_english,name_bangla,class,category,version,session,status,student_photo';
    let rows = await sbAdmission(`admission_applications?tracking_id=eq.${encodeURIComponent(code)}${scope}&select=${cols}`);
    if (!Array.isArray(rows) || !rows.length) {
      rows = await sbAdmission(`admission_applications?index_id=eq.${encodeURIComponent(code)}${scope}&select=${cols}`);
    }
    const app = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
    if (!app) return NextResponse.json({ error: `No application matches "${code}".` });
    return NextResponse.json({ application: app });
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  if (action === 'getStats') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ stats: {} });
    let statsQ = `admission_applications?select=status&circular_id=eq.${circularId}`;
    if (payload.source) statsQ += `&source=eq.${encodeURIComponent(payload.source)}`;
    const rows = await sbAdmission(statsQ);
    if (!rows || rows.error) return NextResponse.json({ stats: {} });
    const stats = { total: rows.length, pending: 0, admitted: 0, rejected: 0, called: 0 };
    rows.forEach(r => {
      if (r.status === 'Pending') stats.pending++;
      if (r.status === 'Admitted') stats.admitted++;
      if (r.status === 'Rejected') stats.rejected++;
      if (r.status === 'Called for Test') stats.called++;
    });
    return NextResponse.json({ stats });
  }

  // ── Dashboard custom count cards ─────────────────────────────────────────
  // Definitions only -- the count itself is always computed client-side
  // from the circular's already-loaded roster (_admAllApps), same as the
  // built-in Class/Category/Source breakdowns. Keeps this a tiny CRUD, no
  // new query/aggregation surface to keep in sync with listApplications.
  if (action === 'listCustomCounters') {
    const circularId = parseInt(payload.circular_id, 10);
    if (!circularId) return NextResponse.json({ counters: [] });
    const rows = await sbAdmission(`dashboard_custom_counters?circular_id=eq.${circularId}&order=created_at.asc`);
    if (rows?.error) return NextResponse.json({ error: rows.error });
    return NextResponse.json({ counters: rows || [] });
  }
  if (action === 'saveCustomCounter') {
    const circularId = parseInt(payload.circular_id, 10);
    const label = String(payload.label || '').trim();
    if (!circularId || !label) return NextResponse.json({ error: 'Missing circular or label.' });
    const filters = (payload.filters && typeof payload.filters === 'object') ? payload.filters : {};
    const res = await sbAdmission('dashboard_custom_counters', 'POST', { circular_id: circularId, label, filters });
    if (res?.error) return NextResponse.json({ error: res.error });
    return NextResponse.json({ counter: res?.[0] || null });
  }
  if (action === 'deleteCustomCounter') {
    const id = parseInt(payload.id, 10);
    if (!id) return NextResponse.json({ error: 'Missing id.' });
    await sbAdmission(`dashboard_custom_counters?id=eq.${id}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  // Batch-saves the freeform drag/resize position+size for every card the
  // admin just arranged (GridStack's own save()/load() shape: x/y/w/h in
  // 12-column grid units) -- one PATCH per card, same as every other small
  // batch update in this route (no bulk-upsert helper exists here).
  if (action === 'saveCustomCounterLayout') {
    const layouts = Array.isArray(payload.layouts) ? payload.layouts : [];
    for (const l of layouts) {
      const id = parseInt(l.id, 10);
      if (!id) continue;
      await sbAdmission(`dashboard_custom_counters?id=eq.${id}`, 'PATCH', { layout: { x: l.x, y: l.y, w: l.w, h: l.h } });
    }
    return NextResponse.json({ success: true });
  }

  // ── Form field defs (Phase 1 added read-only use — label lookup for the
  // application editor's custom-fields block. Phase 2 below adds the editor
  // itself via saveFormFields) ──────────────────────────────────────────────
  if (action === 'getFormFields') {
    const rows = await sbAdmission(`admission_settings?key=eq.form_fields_json`);
    const stored = (!rows?.error && rows?.[0]) ? rows[0].value : [];
    return NextResponse.json({ fields: reconcileFormFields(stored) });
  }

  // ── Phase 2: Settings (Index Pattern / Circular / generic key-value) ────
  // 'circular_settings' (Part 1's dimensions/entries/symbol-counter matrix,
  // used only to pick an index-ID counter key) is Part 6's one exception to
  // "settings stay shared across circulars" -- it's redirected to live on
  // exam_circulars.index_dimensions for the active circular instead of the
  // global admission_settings table, since the whole point of the Part 1/
  // Part 2 merge is that each circular gets its own. Every other key (index
  // pattern, form fields, templates, payments, counters, SMS) is untouched.
  if (action === 'getSettings') {
    const rows = await sbAdmission('admission_settings');
    if (!rows || rows.error) return NextResponse.json({ settings: {} });
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    const circularId = parseInt(payload.circular_id, 10);
    if (circularId) {
      const circRows = await sbAdmission(`exam_circulars?id=eq.${circularId}&select=index_dimensions`);
      settings.circular_settings = (Array.isArray(circRows) && circRows[0] && circRows[0].index_dimensions) || {};
    }
    return NextResponse.json({ settings });
  }
  if (action === 'saveSettings') {
    const { key, value } = payload;
    if (key === 'circular_settings') {
      const circularId = parseInt(payload.circular_id, 10);
      if (!circularId) return NextResponse.json({ error: 'Pick a circular first.' });
      const res = await sbAdmission(`exam_circulars?id=eq.${circularId}`, 'PATCH', { index_dimensions: value });
      if (res?.error) return NextResponse.json({ error: res.error });
      return NextResponse.json({ success: true });
    }
    const existing = await sbAdmission(`admission_settings?key=eq.${encodeURIComponent(key)}`);
    if (existing && !existing.error && existing.length > 0) {
      await sbAdmission(`admission_settings?key=eq.${encodeURIComponent(key)}`, 'PATCH',
        { value, updated_at: new Date().toISOString() });
    } else {
      await sbAdmission('admission_settings', 'POST', { key, value, updated_at: new Date().toISOString() });
    }
    return NextResponse.json({ success: true });
  }

  // ── Phase 2: Form Fields editor (save side; getFormFields above is the read) ─
  if (action === 'saveFormFields') {
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    const existing = await sbAdmission('admission_settings?key=eq.form_fields_json');
    if (existing && !existing.error && existing.length > 0) {
      await sbAdmission('admission_settings?key=eq.form_fields_json', 'PATCH',
        { value: fields, updated_at: new Date().toISOString() });
    } else {
      await sbAdmission('admission_settings', 'POST', { key: 'form_fields_json', value: fields, updated_at: new Date().toISOString() });
    }
    return NextResponse.json({ success: true });
  }

  // ── Phase 2: Index Pattern preview + Counters ────────────────────────────
  if (action === 'previewIndexId') {
    const { settings, session, cls, cat, counter = 1 } = payload;
    return NextResponse.json({ preview: buildIndexId(settings, session, cls, cat, counter) });
  }
  if (action === 'resetCounter') {
    const { year, cls } = payload;
    await sbAdmission(`index_counters?year=eq.${encodeURIComponent(year)}&class=eq.${encodeURIComponent(cls)}`, 'DELETE');
    return NextResponse.json({ success: true });
  }
  if (action === 'listCounters') {
    const rows = await sbAdmission('index_counters?order=year.desc,class.asc');
    return NextResponse.json({ counters: rows || [] });
  }

  // ── Phase 2: Payments ────────────────────────────────────────────────────
  if (action === 'listPayments') {
    let q = 'admission_payments?select=*&order=created_at.desc&limit=500';
    if (payload.status) q += `&status=eq.${encodeURIComponent(payload.status)}`;
    const pays = await sbAdmission(q);
    if (!Array.isArray(pays)) return NextResponse.json({ payments: [] });
    const ids = [...new Set(pays.map(p => p.application_id).filter(Boolean))];
    let appsById = {};
    if (ids.length) {
      const apps = await sbAdmission(`admission_applications?id=in.(${ids.join(',')})&select=id,tracking_id,index_id,name_english,class,session,payment_status,stage`);
      if (Array.isArray(apps)) for (const a of apps) appsById[a.id] = a;
    }
    return NextResponse.json({ payments: pays.map(p => ({ ...p, application: appsById[p.application_id] || null })) });
  }
  if (action === 'verifyPayment') {
    const pid = parseInt(payload.paymentId, 10);
    const approve = !!payload.approve;
    if (!pid) return NextResponse.json({ error: 'Missing payment id' });
    const rows = await sbAdmission(`admission_payments?id=eq.${pid}&select=*`);
    const p = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
    if (!p) return NextResponse.json({ error: 'Payment not found' });
    const pRes = await sbAdmission(`admission_payments?id=eq.${pid}`, 'PATCH', {
      status: approve ? 'verified' : 'rejected', updated_at: new Date().toISOString(),
    });
    if (pRes && pRes.error) return NextResponse.json({ error: 'Could not update payment' });
    if (p.application_id) {
      const aRes = await sbAdmission(`admission_applications?id=eq.${p.application_id}`, 'PATCH', approve ? {
        payment_status: 'verified', stage: 'paid', paid_at: new Date().toISOString(),
        payment_amount: p.amount, updated_at: new Date().toISOString(),
      } : {
        payment_status: 'rejected', updated_at: new Date().toISOString(),
      });
      if (aRes && aRes.error) return NextResponse.json({ error: 'Payment updated but the application row failed — retry.' });
    }
    return NextResponse.json({ success: true });
  }
  if (action === 'markPaid') {
    const appId = parseInt(payload.appId, 10);
    if (!appId) return NextResponse.json({ error: 'Missing application id' });
    const res = await sbAdmission(`admission_applications?id=eq.${appId}`, 'PATCH', {
      payment_status: 'verified', stage: 'paid', paid_at: new Date().toISOString(),
      payment_method: 'offline', updated_at: new Date().toISOString(),
    });
    if (res && res.error) return NextResponse.json({ error: 'Could not update' });
    return NextResponse.json({ success: true });
  }

  // ── Phase 2: Admit cards — bulk-issue from an uploaded room list ─────────
  if (action === 'issueAdmits') {
    const list = Array.isArray(payload.rows) ? payload.rows : [];
    if (!list.length) return NextResponse.json({ error: 'No rows to issue' });
    const apps = await sbAdmission('admission_applications?select=id,tracking_id,index_id&limit=10000');
    if (!Array.isArray(apps)) return NextResponse.json({ error: 'Could not load applications' });
    const byKey = {};
    for (const a of apps) {
      if (a.tracking_id) byKey[String(a.tracking_id).trim().toUpperCase()] = a.id;
      if (a.index_id) byKey[String(a.index_id).trim().toUpperCase()] = a.id;
    }
    const unmatched = [];
    const roomByAppId = {};
    for (const r of list) {
      const key = String(r.key || '').trim().toUpperCase();
      const room = String(r.room || '').trim();
      if (!key || !room) continue;
      const appId = byKey[key];
      if (appId) roomByAppId[appId] = room; else unmatched.push(key);
    }
    const idsByRoom = {};
    for (const [appId, room] of Object.entries(roomByAppId)) (idsByRoom[room] = idsByRoom[room] || []).push(appId);
    const now = new Date().toISOString();
    let updated = 0;
    for (const [room, ids] of Object.entries(idsByRoom)) {
      const res = await sbAdmission(`admission_applications?id=in.(${ids.join(',')})`, 'PATCH', {
        room_no: room, admit_issued_at: now, updated_at: now,
      });
      if (!(res && res.error)) updated += ids.length;
    }
    return NextResponse.json({ success: true, updated, matched: Object.keys(roomByAppId).length, unmatched });
  }

  // ── Phase 3: SMS test-send — fires the configured gateway with a fixed
  // test code; never stored/verified anywhere (no session to attach an OTP
  // to from the admin side, unlike the applicant-facing requestOtp flow).
  if (action === 'sendTestSms') {
    const phone = String(payload.phone || '').trim();
    if (!phone) return NextResponse.json({ error: 'Enter a phone number to test.' });
    const rows = await sbAdmission('admission_settings?key=eq.sms_settings');
    const s = (Array.isArray(rows) && rows[0]) ? (rows[0].value || {}) : {};
    const code = '123456';
    if (!s.url) return NextResponse.json({ sent: true, devCode: code });
    const message = String(s.messageTemplate || 'Your CCPC Admission verification code is {otp}').replace(/\{phone\}/g, phone).replace(/\{otp\}/g, code);
    let url = String(s.url).replace(/\{phone\}/g, encodeURIComponent(phone)).replace(/\{otp\}/g, encodeURIComponent(code)).replace(/\{message\}/g, encodeURIComponent(message));
    const method = (s.method || 'GET').toUpperCase();
    const headers = { ...(s.headers || {}) };
    let sendBody;
    if (method !== 'GET' && s.bodyTemplate) {
      const jsonSafe = v => JSON.stringify(v).slice(1, -1);
      sendBody = String(s.bodyTemplate).replace(/\{phone\}/g, jsonSafe(phone)).replace(/\{otp\}/g, jsonSafe(code)).replace(/\{message\}/g, jsonSafe(message));
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    }
    try {
      const res = await fetch(url, { method, headers, body: sendBody, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return NextResponse.json({ error: `Gateway responded ${res.status}` });
      return NextResponse.json({ sent: true });
    } catch (e) {
      return NextResponse.json({ error: 'Could not reach the SMS gateway.' });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
