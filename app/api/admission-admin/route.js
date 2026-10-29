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

  // ── Form field defs (Phase 1 added read-only use — label lookup for the
  // application editor's custom-fields block. Phase 2 below adds the editor
  // itself via saveFormFields) ──────────────────────────────────────────────
  if (action === 'getFormFields') {
    const rows = await sbAdmission(`admission_settings?key=eq.form_fields_json`);
    const stored = (!rows?.error && rows?.[0]) ? rows[0].value : [];
    return NextResponse.json({ fields: reconcileFormFields(stored) });
  }

  // ── Phase 2: Settings (Index Pattern / Circular / generic key-value) ────
  if (action === 'getSettings') {
    const rows = await sbAdmission('admission_settings');
    if (!rows || rows.error) return NextResponse.json({ settings: {} });
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    return NextResponse.json({ settings });
  }
  if (action === 'saveSettings') {
    const { key, value } = payload;
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
