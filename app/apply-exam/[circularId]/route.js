import { NextResponse } from 'next/server';

// Public, login-free application form for an External-Candidate circular
// (see app/api/admission-candidates/route.js) when that circular is set
// to Online + Active -- same "a link anyone can open without signing in"
// shape as app/vote/[slug]/route.js and app/plan/[id]/route.js, GET
// renders the page (with its own inline fetch()-based JS, no build step),
// POST handles the actual submit/edit. Self-contained: own sbAdmission()
// copy, no auth gate at all (public by design) -- this is NOT the same
// route as app/api/admission-candidates/route.js, which stays admin-only.

export const dynamic = 'force-dynamic';

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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const BOUND_CHECKS = [['class', 'class'], ['category', 'student_category'], ['version', 'version']];
function checkBounds(bounds, data) {
  for (const [rowField, boundField] of BOUND_CHECKS) {
    const allowed = bounds[boundField];
    if (Array.isArray(allowed) && allowed.length && data[rowField] && !allowed.includes(data[rowField])) {
      return `${rowField[0].toUpperCase()}${rowField.slice(1)} must be one of: ${allowed.join(', ')}`;
    }
  }
  return null;
}
async function checkUniqueFields(circularId, uniqueFields, data, excludeId) {
  for (const field of uniqueFields) {
    if (field === 'token') continue; // always system-unique already
    const val = data[field];
    if (!val) continue;
    let q = `exam_candidates?circular_id=eq.${circularId}&${field}=eq.${encodeURIComponent(val)}&select=id`;
    if (excludeId) q += `&id=neq.${excludeId}`;
    const rows = await sbAdmission(q);
    if (Array.isArray(rows) && rows.length) return field;
  }
  return null;
}
async function generateUniqueToken(circularId) {
  for (let i = 0; i < 8; i++) {
    const t = Math.random().toString(36).slice(2, 8).toUpperCase();
    const rows = await sbAdmission(`exam_candidates?circular_id=eq.${circularId}&token=eq.${t}&select=id`);
    if (!Array.isArray(rows) || !rows.length) return t;
  }
  return 'T' + Date.now().toString(36).toUpperCase();
}

// Best-effort SMS on a successful new submission, reusing the same generic
// gateway config (admission_settings.sms_settings) Admission Admin's own
// sendTestSms action already uses (app/api/admission-admin/route.js) -- no
// new SMS infrastructure, just a second caller with {token} instead of {otp}.
// Never throws -- a misconfigured/unreachable gateway must never fail the
// applicant's submission.
async function sendSubmissionSms(circular, data) {
  try {
    if (!circular.sms_on_submit || !data.mobile) return;
    const rows = await sbAdmission('admission_settings?key=eq.sms_settings');
    const s = (Array.isArray(rows) && rows[0]) ? (rows[0].value || {}) : {};
    if (!s.url) return;
    const template = circular.sms_template || 'Your application has been received. Your token is {token}.';
    const message = template
      .replace(/\{token\}/g, data.token || '')
      .replace(/\{name\}/g, data.candidate_name || '')
      .replace(/\{class\}/g, data.class || '');
    let url = String(s.url).replace(/\{phone\}/g, encodeURIComponent(data.mobile)).replace(/\{message\}/g, encodeURIComponent(message));
    const method = (s.method || 'GET').toUpperCase();
    const headers = { ...(s.headers || {}) };
    let sendBody;
    if (method !== 'GET' && s.bodyTemplate) {
      const jsonSafe = v => JSON.stringify(v).slice(1, -1);
      sendBody = String(s.bodyTemplate).replace(/\{phone\}/g, jsonSafe(data.mobile)).replace(/\{message\}/g, jsonSafe(message));
      if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    }
    await fetch(url, { method, headers, body: sendBody, signal: AbortSignal.timeout(15000) });
  } catch (e) { /* best-effort -- never fail the submission over SMS */ }
}

function closedHtml(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Application not available</title>
  <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f5;color:#333;text-align:center;padding:24px}
  .box{max-width:380px}h1{font-size:18px;margin-bottom:8px}p{font-size:13px;color:#666}</style></head>
  <body><div class="box"><h1>This application link isn't open</h1><p>${esc(message || "This circular isn't currently accepting online applications. Please check the link or contact the office.")}</p></div></body></html>`;
}

function fieldHtml(id, label, boundValues, currentValue, required) {
  if (Array.isArray(boundValues) && boundValues.length) {
    const opts = boundValues.map(v => `<option value="${esc(v)}" ${v === currentValue ? 'selected' : ''}>${esc(v)}</option>`).join('');
    return `<label class="f"><span>${esc(label)}${required ? ' *' : ''}</span><select id="${id}" ${required ? 'required' : ''}><option value="">— Select —</option>${opts}</select></label>`;
  }
  return `<label class="f"><span>${esc(label)}${required ? ' *' : ''}</span><input id="${id}" type="text" value="${esc(currentValue || '')}" ${required ? 'required' : ''}></label>`;
}

function renderFormPage(circular, existing, editToken) {
  const bounds = circular.bounds || {};
  const title = esc(circular.name);
  const fields = [
    fieldHtml('f_candidate_name', 'Full Name', null, existing?.candidate_name, true),
    fieldHtml('f_mobile', 'Mobile Number', null, existing?.mobile, false),
    fieldHtml('f_class', 'Class', bounds.class, existing?.class, false),
    fieldHtml('f_version', 'Version', bounds.version, existing?.version, false),
    fieldHtml('f_category', 'Category', bounds.student_category, existing?.category, false),
  ].join('');
  const declaration = esc(circular.apply_declaration || 'I hereby declare that the above-made information is true and correct to the best of my knowledge.');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Application Form</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;margin:0;padding:24px 16px;color:#1e293b}
  .card{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:28px 24px}
  h1{font-size:18px;margin:0 0 4px}
  .sub{font-size:12px;color:#64748b;margin:0 0 20px}
  .f{display:block;margin-bottom:14px}
  .f span{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#64748b;margin-bottom:4px}
  .f input,.f select{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;background:#f8fafc}
  button{width:100%;padding:12px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.03em;cursor:pointer}
  button:disabled{opacity:.6}
  #msg{margin-top:14px;font-size:13px;padding:10px 12px;border-radius:10px;display:none}
  #msg.err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;display:block}
  #msg.ok{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;display:block}
  .token{font-family:monospace;font-size:18px;font-weight:700;background:#eff6ff;color:#1d4ed8;padding:6px 10px;border-radius:8px;display:inline-block;margin-top:6px}
  .link{word-break:break-all;font-size:11px;color:#2563eb}
  .decl{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#475569;margin-bottom:16px}
  .decl input{margin-top:2px;flex-shrink:0}
</style></head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p class="sub">${editToken ? 'Edit your submitted application below.' : 'Fill in your details to apply.'}</p>
    <form id="form">
      ${fields}
      <label class="decl"><input type="checkbox" id="f_declaration"><span>${declaration}</span></label>
      <button type="submit" id="submitBtn" disabled>${editToken ? 'Save Changes' : 'Submit Application'}</button>
    </form>
    <div id="msg"></div>
  </div>
<script>
(function(){
  var editToken = ${JSON.stringify(editToken || '')};
  var form = document.getElementById('form');
  var msg = document.getElementById('msg');
  var btn = document.getElementById('submitBtn');
  var decl = document.getElementById('f_declaration');
  decl.addEventListener('change', function(){ btn.disabled = !decl.checked; });
  form.addEventListener('submit', function(e){
    e.preventDefault();
    btn.disabled = true;
    msg.className = ''; msg.textContent = '';
    var body = {
      candidate_name: document.getElementById('f_candidate_name').value.trim(),
      mobile: document.getElementById('f_mobile').value.trim(),
      class: document.getElementById('f_class').value.trim(),
      version: document.getElementById('f_version').value.trim(),
      category: document.getElementById('f_category').value.trim(),
      declaration_accepted: decl.checked,
      token: editToken,
    };
    fetch(location.pathname, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
      .then(function(res){
        btn.disabled = false;
        if (!res.ok || res.j.result !== 'success') {
          msg.className = 'err';
          msg.textContent = (res.j && res.j.message) || 'Something went wrong — please try again.';
          return;
        }
        var token = res.j.token;
        var editUrl = location.origin + location.pathname + '?token=' + token;
        msg.className = 'ok';
        msg.innerHTML = 'Submitted successfully. Your token:<br><span class="token">' + token + '</span>' +
          '<br><br>Save this link to edit your application later:<br><a class="link" href="' + editUrl + '">' + editUrl + '</a>';
        form.style.display = 'none';
      })
      .catch(function(){ btn.disabled = false; msg.className = 'err'; msg.textContent = 'Network error — please try again.'; });
  });
})();
</script>
</body></html>`;
}

export async function GET(request, { params }) {
  const { circularId } = await params;
  const id = parseInt(circularId, 10);
  if (!id) return new Response(closedHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  const url = new URL(request.url);
  const editToken = (url.searchParams.get('token') || '').trim();

  const rows = await sbAdmission(`exam_circulars?id=eq.${id}&select=*`);
  const circular = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
  if (!circular || circular.mode !== 'online' || !circular.is_active) {
    return new Response(closedHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let existing = null;
  if (editToken) {
    const er = await sbAdmission(`exam_candidates?circular_id=eq.${id}&token=eq.${encodeURIComponent(editToken)}&select=*`);
    existing = (Array.isArray(er) && er[0]) ? er[0] : null;
    if (!existing) return new Response(closedHtml('No application found for that link.'), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  return new Response(renderFormPage(circular, existing, editToken), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request, { params }) {
  const { circularId } = await params;
  const id = parseInt(circularId, 10);
  if (!id) return NextResponse.json({ result: 'error', message: 'Invalid link.' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch (e) { return NextResponse.json({ result: 'error', message: 'Bad request.' }, { status: 400 }); }

  const rows = await sbAdmission(`exam_circulars?id=eq.${id}&select=*`);
  const circular = (Array.isArray(rows) && rows[0]) ? rows[0] : null;
  if (!circular || circular.mode !== 'online' || !circular.is_active) {
    return NextResponse.json({ result: 'error', message: "This application isn't currently open." }, { status: 403 });
  }

  const data = {
    candidate_name: String(body.candidate_name || '').trim(),
    mobile: String(body.mobile || '').trim(),
    class: String(body.class || '').trim(),
    version: String(body.version || '').trim(),
    category: String(body.category || '').trim(),
  };
  if (!data.candidate_name) return NextResponse.json({ result: 'error', message: 'Name is required.' }, { status: 400 });
  if (body.declaration_accepted !== true) return NextResponse.json({ result: 'error', message: 'Please accept the declaration before submitting.' }, { status: 400 });

  const boundsErr = checkBounds(circular.bounds || {}, data);
  if (boundsErr) return NextResponse.json({ result: 'error', message: boundsErr }, { status: 400 });

  const editToken = String(body.token || '').trim();
  let existingId = null;
  if (editToken) {
    const er = await sbAdmission(`exam_candidates?circular_id=eq.${id}&token=eq.${encodeURIComponent(editToken)}&select=id`);
    existingId = (Array.isArray(er) && er[0]) ? er[0].id : null;
    if (!existingId) return NextResponse.json({ result: 'error', message: 'Could not find your earlier submission to edit.' }, { status: 404 });
  }

  const uniqueFields = Array.isArray(circular.unique_fields) ? circular.unique_fields : [];
  const dupField = await checkUniqueFields(id, uniqueFields, data, existingId);
  if (dupField) return NextResponse.json({ result: 'error', message: `This ${dupField.replace(/_/g, ' ')} has already been used for this application.` }, { status: 409 });

  if (existingId) {
    const res = await sbAdmission(`exam_candidates?id=eq.${existingId}`, 'PATCH', { ...data, updated_at: new Date().toISOString() });
    if (res && res.error) return NextResponse.json({ result: 'error', message: 'Could not save your changes.' }, { status: 500 });
    return NextResponse.json({ result: 'success', token: editToken });
  }

  const token = await generateUniqueToken(id);
  const res = await sbAdmission('exam_candidates', 'POST', { circular_id: id, external_key: token, token, ...data });
  if (res && res.error) return NextResponse.json({ result: 'error', message: 'Could not submit your application.' }, { status: 500 });
  await sendSubmissionSms(circular, { ...data, token });
  return NextResponse.json({ result: 'success', token });
}
