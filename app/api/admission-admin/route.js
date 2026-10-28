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
  { key: 'emergency_contact', label: 'Emergency contact no.', type: 'text', section: 'student', required: false, visible: true, built_in: true, placeholder: '+8801…' },
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
  { key: 'father_contact', label: 'Contact no.', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_nid', label: 'NID', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_office_address', label: 'Office address / unit', type: 'text', section: 'father', required: false, visible: true, built_in: true, wide: true },
  { key: 'father_yearly_income', label: 'Yearly income', type: 'text', section: 'father', required: false, visible: true, built_in: true },
  { key: 'father_photo', label: "Father's photo", type: 'photo', section: 'father', required: false, visible: true, built_in: true, wide: true },

  { key: 'mother_name', label: "Mother's name", type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_profession', label: 'Profession / occupation', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_designation', label: 'Designation / rank', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_education', label: 'Education', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_contact', label: 'Contact no.', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_nid', label: 'NID', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_office_address', label: 'Office address / unit', type: 'text', section: 'mother', required: false, visible: true, built_in: true, wide: true },
  { key: 'mother_yearly_income', label: 'Yearly income', type: 'text', section: 'mother', required: false, visible: true, built_in: true },
  { key: 'mother_photo', label: "Mother's photo", type: 'photo', section: 'mother', required: false, visible: true, built_in: true, wide: true },

  { key: 'guardian_name', label: "Guardian's name", type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_relation', label: 'Relation', type: 'text', section: 'guardian', required: false, visible: true, built_in: true, placeholder: 'e.g. Father' },
  { key: 'guardian_profession', label: 'Profession / occupation', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_designation', label: 'Designation / rank', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_education', label: 'Education', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_contact', label: 'Contact no.', type: 'text', section: 'guardian', required: false, visible: true, built_in: true },
  { key: 'guardian_office_address', label: 'Office address / unit', type: 'text', section: 'guardian', required: false, visible: true, built_in: true, wide: true },
  { key: 'guardian_nid', label: 'Guardian NID', type: 'text', section: 'guardian', required: false, visible: false, built_in: true },
  { key: 'guardian_photo', label: "Guardian's photo", type: 'photo', section: 'guardian', required: false, visible: true, built_in: true, wide: true },
];
function reconcileFormFields(stored) {
  const list = Array.isArray(stored) ? stored.slice() : [];
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

  if (!(await _isAdmissionAdmin(user_id))) {
    return NextResponse.json({ error: 'Admission Admin access required.' }, { status: 403 });
  }

  // ── List Applications ────────────────────────────────────────────────────
  if (action === 'listApplications') {
    let q = 'admission_applications?select=id,tracking_id,index_id,name_english,name_bangla,class,category,version,session,status,stage,payment_status,room_no,created_at&order=created_at.desc&limit=1000';
    if (payload.session) q += `&session=eq.${encodeURIComponent(payload.session)}`;
    if (payload.class)   q += `&class=eq.${encodeURIComponent(payload.class)}`;
    if (payload.status)  q += `&status=eq.${encodeURIComponent(payload.status)}`;
    const rows = await sbAdmission(q);
    if (rows?.error) return NextResponse.json({ error: rows.error });
    return NextResponse.json({ applications: rows || [] });
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
      const trackingId = await sbAdmissionRpc('generate_tracking_id', {});
      data.tracking_id = trackingId || Math.random().toString(16).slice(2, 8).toUpperCase();

      const settingsRows = await sbAdmission('admission_settings?key=in.(index_settings,circular_settings)');
      const indexSettings = settingsRows?.find(r => r.key === 'index_settings')?.value || {};
      const circSettings  = settingsRows?.find(r => r.key === 'circular_settings')?.value || {};
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
      return NextResponse.json({ id: res?.[0]?.id, tracking_id: data.tracking_id, index_id: data.index_id });
    } else {
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

  // ── Look up by scanned code (QR on an admit card/application — Phase 3 UI) ─
  if (action === 'lookupByCode') {
    const code = String(payload.code || '').trim();
    if (!code) return NextResponse.json({ error: 'No code scanned.' });
    const cols = 'id,tracking_id,index_id,name_english,name_bangla,class,category,version,session,status,student_photo';
    let rows = await sbAdmission(`admission_applications?tracking_id=eq.${encodeURIComponent(code)}&select=${cols}`);
    if (!Array.isArray(rows) || !rows.length) {
      rows = await sbAdmission(`admission_applications?index_id=eq.${encodeURIComponent(code)}&select=${cols}`);
    }
    const app = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
    if (!app) return NextResponse.json({ error: `No application matches "${code}".` });
    return NextResponse.json({ application: app });
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  if (action === 'getStats') {
    const q = payload.session
      ? `admission_applications?select=status&session=eq.${encodeURIComponent(payload.session)}`
      : 'admission_applications?select=status';
    const rows = await sbAdmission(q);
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

  // ── Form field defs (read-only use in Phase 1 — label lookup for the
  // application editor's custom-fields block; the editor itself is Phase 2) ─
  if (action === 'getFormFields') {
    const rows = await sbAdmission(`admission_settings?key=eq.form_fields_json`);
    const stored = (!rows?.error && rows?.[0]) ? rows[0].value : [];
    return NextResponse.json({ fields: reconcileFormFields(stored) });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
