import { NextResponse } from 'next/server';
import { supabaseRequest, castToArray } from '@/lib/supabase';

// Helper: convert empty/blank strings to null (used for date fields throughout)
function d(val) { return (val && String(val).trim() !== '') ? val : null; }

// Normalize blank/placeholder emails. Pass teacherId as fallback to generate a unique placeholder
// so NOT NULL and UNIQUE constraints on app_users.email are always satisfied.
function _sanitizeEmail(e, teacherId) {
  if (e) {
    const s = String(e).trim();
    if (s && s !== '-' && s.toLowerCase() !== 'n/a' && s.toLowerCase() !== 'none') return s;
  }
  return teacherId ? `${teacherId}@no-email.local` : null;
}

// Helper: average an array of evaluation objects by their .marks field
function avg(evals) {
  if (!evals || !evals.length) return 0;
  return evals.reduce((s, e) => s + parseFloat(e.marks || 0), 0) / evals.length;
}

// Broadcast a real-time event to a specific user's Supabase Realtime channel.
// Fire-and-forget — messaging still works even if broadcast fails.
function _rtBroadcast(userId, event, payload = {}) {
  const url  = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`;
  const key  = process.env.SUPABASE_SERVICE_KEY;
  fetch(url, {
    method:  'POST',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `user:${userId}`, event, payload }] }),
    signal: AbortSignal.timeout(4000)
  }).catch(() => {}); // ignore errors — delivery is best-effort
}

// ── ROUTINE / CLASS ADJUSTMENT ("Cut & Toss") ────────────────────────────────
// Reads from the master scheduling Google Sheet (same spreadsheet the legacy
// Kodular app + Apps Script web app use) and proxies writes to that same
// deployed Apps Script web app, so both systems stay in sync on one source
// of truth. We never reimplement the swap logic itself — only compute which
// row/column to target and hand off to the already-live endpoint.
const ROUTINE_SHEET_ID = '11l3oc1mpbR8UerpDxCatzuhcBNqkbdNzWzOTiPPdKgk';
const ROUTINE_GAS_URL  = 'https://script.google.com/macros/s/AKfycbyLXrJdZTvPrGYzt9fhBYa3IEUx5G5MrpyqBraVJR4RrDu0FFukdI8u7PupakA5an5AKA/exec';
const PERIOD_LABELS = ['1st','2nd','3rd','4th/junior tiffin','4th/senior tiffin','5th','6th','7th'];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── CLASS TEACHER → STUDENT ROSTER ──────────────────────────────────────────
// Authoritative class→teacher list lives in a separate Google Sheet (not the
// routine one above). Same live-fetch-per-request convention as the routine
// feature — no stored table, no cron, always re-derived from the sheet.
const CLASS_TEACHER_SHEET_ID  = '1QSpqo2tq9aWnrJGr4o-EP5F8Y4FQhRck9BCY2IqjZSk';
const CLASS_TEACHER_SHEET_GID = '383089794';

// The sheet's "Class" column uses Roman-numeral/abbreviated internal codes
// (NUR., KG, I..X) but student.students_data.class stores spelled-out English
// words (Nursery, KG, One..Ten) — confirmed by comparing the sheet against the
// live distinct class/section values. Section is otherwise identical except
// one alias ("BS-EV" in the sheet, stored as "BS-E").
const CLASS_TEACHER_NAME_TO_STUDENT_CLASS = {
  'NUR.': 'Nursery', 'KG': 'KG', 'I': 'One', 'II': 'Two', 'III': 'Three', 'IV': 'Four',
  'V': 'Five', 'VI': 'Six', 'VII': 'Seven', 'VIII': 'Eight', 'IX': 'Nine', 'X': 'Ten',
};
const CLASS_TEACHER_SECTION_ALIASES = { 'BS-EV': 'BS-E' };

// Minimal RFC4180 CSV parser — gviz always quotes every field
function _parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Cache-bust with a timestamp — Google's gviz CSV export can otherwise return a
// cached copy for a short window, which would hide a write that just happened.
async function _fetchSheetRows(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${ROUTINE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read sheet "${sheetName}" (HTTP ${res.status})`);
  return _parseCsv(await res.text());
}

function _findPeriodCols(headerRow) {
  const cols = [];
  (headerRow || []).forEach((h, i) => {
    const norm = String(h || '').trim().toLowerCase();
    if (PERIOD_LABELS.some(k => k.toLowerCase() === norm)) cols.push({ idx: i, label: String(h).trim() });
  });
  return cols;
}

// The "Classes" sheet's gviz CSV export has a leading blank column not present
// in the sheet's visual layout, so column positions must never be hardcoded —
// find the "Weekday" column by its header text (it's fully populated on every
// row, unlike the neighboring "first row of the day" grouping column).
function _findWeekdayCol(headerRow) {
  return (headerRow || []).findIndex(h => String(h).trim() === 'Weekday');
}

// Same cache-busted/no-store convention as _fetchSheetRows, but by gid — the
// class-teacher sheet isn't the routine spreadsheet and its tab is referenced
// by gid, not name.
async function _fetchCsvByGid(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}&_=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read class-teacher sheet (HTTP ${res.status})`);
  return _parseCsv(await res.text());
}

// Cross-schema GET into the `student` schema (same Supabase project, service
// key, Accept-Profile header) — same pattern as student-admin/route.js's own
// sb() helper. Free-standing so it's shared by every class-teacher handler
// below without duplicating the fetch/header boilerplate each time.
async function _sbStudent(path) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Accept-Profile': 'student' },
  });
  return res.ok ? res.json() : [];
}

// Resolves every row of the class-teacher sheet to a real ccpc-teachers
// user_id: try the sheet's own ID column first (most rows are "#N/A" in
// practice), then fall back to the same shortname→full_name→teacher_id chain
// _resolveUserIdsByShortnames already uses for the unrelated routine feature
// (the two sheets share the same shortname vocabulary, confirmed against the
// "Logged in info" tab). Free-standing (not a `handlers` property) since it's
// an internal building block only the validated handlers below should call.
async function _getClassTeacherAssignments() {
  const [sheetRows, profiles, directory] = await Promise.all([
    _fetchCsvByGid(CLASS_TEACHER_SHEET_ID, CLASS_TEACHER_SHEET_GID),
    supabaseRequest('users_profile?select=teacher_id,full_name'),
    handlers.getRoutineDirectory(),
  ]);

  const header = sheetRows[0] || [];
  const classesIdx = header.findIndex(h => String(h).trim() === 'Classes'); // first occurrence
  const idIdx       = header.findIndex(h => String(h).trim() === 'ID');
  const snIdx        = header.findIndex(h => String(h).trim() === 'Sort Names');
  const classIdx     = header.findIndex(h => String(h).trim() === 'Class');   // second table's split column
  const sectionIdx   = header.findIndex(h => String(h).trim() === 'Section');
  if (classesIdx < 0) return [];

  const teacherIdSet = new Set();
  const nameByNormalized = {};
  (Array.isArray(profiles) ? profiles : []).forEach(p => {
    if (p.teacher_id) teacherIdSet.add(String(p.teacher_id));
    const key = _normalizeName(p.full_name);
    if (key) nameByNormalized[key] = p.teacher_id;
  });
  const shortnameToFullName = {};
  directory.forEach(d => { shortnameToFullName[d.shortname.toLowerCase()] = d.fullName; });

  const out = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const classKey = String(row[classesIdx] || '').trim();
    if (!classKey || classKey === '-') break; // sheet trails off into unrelated tables after the class list

    const idVal = String(row[idIdx] || '').trim();
    let resolvedUserId = null, resolvedVia = null;
    if (idVal && idVal !== '#N/A' && teacherIdSet.has(idVal)) {
      resolvedUserId = idVal; resolvedVia = 'id';
    } else {
      const shortname = String(row[snIdx] || '').trim();
      const fullName = shortname ? shortnameToFullName[shortname.toLowerCase()] : '';
      const normalized = fullName ? _normalizeName(fullName) : '';
      if (normalized && nameByNormalized[normalized]) {
        resolvedUserId = nameByNormalized[normalized]; resolvedVia = 'shortname';
      }
    }

    out.push({
      classKey,
      className: classIdx >= 0 ? String(row[classIdx] || '').trim() : '',
      section: sectionIdx >= 0 ? String(row[sectionIdx] || '').trim() : '',
      resolvedUserId,
      resolvedVia,
    });
  }
  return out;
}

async function _callRoutineGas(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${ROUTINE_GAS_URL}?${qs}`, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function _isCordOrAdmin(callerId) {
  if (!callerId) return false;
  const users = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerId)}&select=role`);
  const role = Array.isArray(users) && users[0] ? users[0].role : '';
  const roles = String(role || '').split(',').map(r => r.trim());
  return roles.some(r => ['Cord', 'Admin'].includes(r));
}

// A routine shortname (e.g. "SR") only means something against the "Logged in
// info" sheet, which cross-references reliably to Supabase only by full_name
// (its own "Teacher's ID"/email columns don't match app_users/users_profile
// at all) — so notifying someone by shortname means: shortname -> full_name
// (sheet) -> full_name -> teacher_id (users_profile, which equals app_users
// .user_id by construction in saveAppUser/bulkCreateUsersFromProfiles).
// Normalizes a full name for cross-referencing the sheet against Supabase:
// lowercases, trims, collapses whitespace, and strips periods — the sheet
// writes "Md." while profiles store "Md" for the same person, and a bare
// period-strip can't create a false match the way fuzzy/substring matching
// could, so it's safe to apply unconditionally.
function _normalizeName(name) {
  return String(name || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

async function _resolveUserIdsByShortnames(shortnames) {
  const [directory, profiles] = await Promise.all([
    handlers.getRoutineDirectory(),
    supabaseRequest('users_profile?select=teacher_id,full_name'),
  ]);
  const profileByName = {};
  (Array.isArray(profiles) ? profiles : []).forEach(p => {
    const key = _normalizeName(p.full_name);
    if (key) profileByName[key] = p.teacher_id;
  });
  const out = {};
  shortnames.forEach(sn => {
    const entry = directory.find(d => d.shortname.toLowerCase() === String(sn || '').trim().toLowerCase());
    const fullNameKey = entry ? _normalizeName(entry.fullName) : '';
    out[sn] = fullNameKey ? (profileByName[fullNameKey] || null) : null;
  });
  return out;
}

// Best-effort — an adjustment having gone through is the important part, so a
// notification lookup/insert failure is logged and swallowed, never thrown.
async function _notifyAdjustment({ originalShortname, substituteShortname, periodLabel, oldValue }) {
  try {
    const ids = await _resolveUserIdsByShortnames([originalShortname, substituteShortname]);
    const now = new Date().toISOString();
    const notifs = [];
    if (ids[originalShortname]) {
      notifs.push({
        user_id: ids[originalShortname],
        type: 'class_adjusted',
        title: 'Your class was covered',
        message: `Your ${periodLabel} class (${oldValue || 'scheduled class'}) is being covered by ${substituteShortname} today.`,
        data: { period: periodLabel, coveredBy: substituteShortname, originalClass: oldValue || '' },
        is_read: false,
        created_at: now,
      });
    }
    if (ids[substituteShortname] && ids[substituteShortname] !== ids[originalShortname]) {
      notifs.push({
        user_id: ids[substituteShortname],
        type: 'class_adjusted',
        title: 'You have a new adjustment',
        message: `You're covering ${originalShortname}'s ${periodLabel} class (${oldValue || 'scheduled class'}) today.`,
        data: { period: periodLabel, covering: originalShortname, originalClass: oldValue || '' },
        is_read: false,
        created_at: now,
      });
    }
    if (notifs.length) await supabaseRequest('notifications', 'post', notifs);
  } catch (err) {
    console.error('[_notifyAdjustment] failed:', err);
  }
}

// Cross-schema request into `inventory` (same Supabase project, service key,
// Accept/Content-Profile headers) — kept as a free-standing function, NOT a
// `handlers` property, specifically so it can never be reached directly via
// {fn:"_invReq", args:[...]} from the client. Only the actual action
// handlers below (which validate their own inputs) may call it.
async function _invReq(path, method = 'GET', body = null) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? undefined : 'return=representation',
      'Accept-Profile': 'inventory',
      'Content-Profile': 'inventory',
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (res.status >= 300) return { error: json?.message || 'Inventory request failed', details: json };
    return json;
  } catch {
    return { error: 'Parse error', details: text };
  }
}

// Same accountable-receiver resolution as ccpc-inventory's /api/distribute
// (necessarily duplicated — separate app, no shared package) — committee ->
// chairman, room/building -> its assigned distributor, teacher/staff -> their
// own reference_id, student/others -> no ccpc-teachers identity.
async function _invResolveReceiver(consumer) {
  if (consumer.type === 'committee') {
    const rows = await _invReq(`committees?id=eq.${consumer.reference_id}&select=chairman_user_id`);
    return (Array.isArray(rows) && rows[0]?.chairman_user_id) || null;
  }
  if (consumer.type === 'room' || consumer.type === 'building') {
    const rows = await _invReq(`distributor_assignments?holder_type=eq.${consumer.type}&holder_id=eq.${consumer.reference_id}&select=assignee_user_id&limit=1`);
    return (Array.isArray(rows) && rows[0]?.assignee_user_id) || null;
  }
  if (consumer.type === 'teacher' || consumer.type === 'staff') return consumer.reference_id || null;
  return null;
}

// ─── All handler functions ────────────────────────────────────────────────────

const handlers = {

  // ── AUTH & USER MANAGEMENT ─────────────────────────────────────────────────

  async attemptLogin([idOrEmail, password]) {
    const clean = String(idOrEmail).trim();
    const cleanPass = String(password).trim();
    const res = await supabaseRequest(`app_users?or=(user_id.eq.${clean},email.eq.${clean})`);
    if (Array.isArray(res) && res.length) {
      const user = res[0];
      if (String(user.password).trim() === cleanPass) {
        const rolesArr = user.role.split(',').map(r => r.trim()).filter(Boolean);
        return { success: true, user_id: user.user_id, role: rolesArr[0], roles: rolesArr, email: user.email };
      }
    }
    return { success: false };
  },

  async getAppUsers() {
    return supabaseRequest('app_users?select=*&order=created_at.desc');
  },

  async saveAppUser([data]) {
    const cleanEmail = _sanitizeEmail(data.email, data.user_id);
    const userRes = await supabaseRequest('app_users?on_conflict=user_id', 'post', { ...data, email: cleanEmail });
    if (userRes && userRes.error) throw new Error(userRes.details || 'Failed to create user');
    const roleTokens = (data.role || '').split(',').map(r => r.trim());
    const profileCategory = roleTokens.find(r => r === 'Teacher' || r === 'Staff');
    if (profileCategory) {
      await supabaseRequest('users_profile?on_conflict=teacher_id', 'post', {
        teacher_id: data.user_id,
        email: cleanEmail,
        category: profileCategory
      });
    }
    return userRes;
  },

  async getProfilesWithoutUsers() {
    const [profiles, users] = await Promise.all([
      supabaseRequest('users_profile?select=teacher_id,full_name,email,designation,category&order=full_name.asc'),
      supabaseRequest('app_users?select=user_id')
    ]);
    if (!Array.isArray(profiles)) return { error: true, message: 'users_profile table not found or inaccessible' };
    const existingIds = new Set(Array.isArray(users) ? users.map(u => String(u.user_id).trim()) : []);
    return profiles.filter(p => p.teacher_id && !existingIds.has(String(p.teacher_id).trim()));
  },

  async bulkCreateUsersFromProfiles([profiles, defaultPassword]) {
    const results = { created: [], failed: [], firstError: null };
    for (const p of profiles) {
      const cleanEmail = _sanitizeEmail(p.email, p.teacher_id);
      const res = await supabaseRequest('app_users?on_conflict=user_id', 'post', {
        user_id: p.teacher_id,
        email: cleanEmail,
        password: defaultPassword,
        role: p.role
      });
      if (res && res.error) {
        results.failed.push(p.teacher_id);
        if (!results.firstError) {
          try { results.firstError = JSON.parse(res.details)?.message || res.details; }
          catch { results.firstError = res.details; }
        }
      } else {
        results.created.push(p.teacher_id);
        const roleTokens = (p.role || '').split(',').map(r => r.trim());
        const cat = roleTokens.find(r => r === 'Teacher' || r === 'Staff');
        if (cat) {
          await supabaseRequest('users_profile?on_conflict=teacher_id', 'post', {
            teacher_id: p.teacher_id,
            email: cleanEmail,
            category: cat
          });
        }
      }
    }
    return results;
  },

  async toggleEvaluatable([teacherId, status]) {
    return supabaseRequest(`users_profile?teacher_id=eq.${teacherId}`, 'patch', { is_evaluatable: status });
  },

  async deleteAppUser([userId]) {
    return supabaseRequest(`app_users?user_id=eq.${userId}`, 'delete');
  },

  async updateAppUserPassword([userId, newPassword]) {
    const result = await supabaseRequest(`app_users?user_id=eq.${userId}`, 'patch', { password: newPassword });
    if (result && result.error) throw new Error(result.details || 'Password update failed');
    return result;
  },

  async changeMyPassword([userId, currentPassword, newPassword]) {
    const rows = await supabaseRequest(`app_users?user_id=eq.${userId}&select=password`);
    if (!rows || rows.error || !rows.length) return { success: false, reason: 'user_not_found' };
    if (String(rows[0].password).trim() !== String(currentPassword).trim()) return { success: false, reason: 'wrong_password' };
    const result = await supabaseRequest(`app_users?user_id=eq.${userId}`, 'patch', { password: newPassword });
    if (result && result.error) return { success: false, reason: 'update_failed' };
    return { success: true };
  },

  async updateAppUserRole([userId, newRole]) {
    return supabaseRequest(`app_users?user_id=eq.${userId}`, 'patch', { role: newRole });
  },

  // ── AUTH + PROFILE ────────────────────────────────────────────────────────────

  // Single round-trip login: authenticate the user AND return their scalar profile.
  // This eliminates the sequential attemptLogin → getMyProfile chain on login.
  async loginAndGetProfile([idOrEmail, password]) {
    const clean     = String(idOrEmail).trim();
    const cleanPass = String(password).trim();
    const userRes   = await supabaseRequest(`app_users?or=(user_id.eq.${clean},email.eq.${clean})`);
    if (!Array.isArray(userRes) || !userRes.length) return { success: false };
    const user = userRes[0];
    if (String(user.password).trim() !== cleanPass)  return { success: false };

    const rolesArr = user.role.split(',').map(r => r.trim()).filter(Boolean);
    const auth = { success: true, user_id: user.user_id, role: rolesArr[0], roles: rolesArr, email: user.email };

    // For Teacher / Staff: fetch scalar profile in the same serverless invocation
    if (rolesArr.some(r => ['Teacher','Staff'].includes(r))) {
      let pRes = await supabaseRequest(`users_profile?select=*&email=eq.${encodeURIComponent(user.email)}`);
      if (!Array.isArray(pRes) || !pRes.length) {
        pRes = await supabaseRequest(`users_profile?select=*&teacher_id=eq.${user.user_id}`);
      }
      auth.profile = (Array.isArray(pRes) && pRes.length) ? pRes[0] : null;
    }
    return auth;
  },

  // ── FACULTY PROFILE ─────────────────────────────────────────────────────────

  // Scalar-only profile fetch (fallback: manual tab switch, HR view, etc.)
  async getMyProfile([userEmail, userId]) {
    let res = await supabaseRequest(`users_profile?select=*&email=eq.${encodeURIComponent(userEmail)}`);
    if ((!Array.isArray(res) || !res.length) && userId) {
      res = await supabaseRequest(`users_profile?select=*&teacher_id=eq.${userId}`);
    }
    return (Array.isArray(res) && res.length > 0) ? res[0] : null;
  },

  // All child tables in one background query — called after the profile form renders.
  async getMyProfileSections([teacherId]) {
    const sel = [
      'family_details(*)', 'faculty_attributes(*)', 'countries_visited(*)',
      'language_skills(*)', 'siblings_info(*)', 'spouse_details(*)',
      'children_info(*)', 'sibling_inlaws(*)', 'bank_accounts(*)', 'education_records(*)'
    ].join(',');
    const res = await supabaseRequest(`users_profile?select=${sel}&teacher_id=eq.${teacherId}`);
    return (Array.isArray(res) && res.length > 0) ? res[0] : {};
  },

  async savePersonalProfile([data]) {
    const tid = data.teacher_id;
    if (!tid) return { error: 'Profile did not load correctly (teacher_id missing). Please refresh and try again.' };

    // Helper: extract readable message from a Supabase error response
    function sbErr(res) {
      if (!res || !res.error) return null;
      try { const e = JSON.parse(res.details); return e.message || res.details; } catch { return res.details || res.error; }
    }

    // 1. Core profile scalar fields
    // email excluded — it is managed by app_users, not the personal profile form
    // spouse_name excluded — stored in the spouse_details child table
    const profilePayload = {
      teacher_id: tid,
      full_name: data.full_name || null,
      category: data.category || null,
      designation: data.designation || null,
      joining_date: d(data.joining_date),
      national_id: data.national_id || null,
      auth_ref: data.auth_ref || null,
      name_bengali: data.name_bengali || null,
      school_college: data.school_college || null,
      date_of_birth: d(data.date_of_birth),
      place_of_birth: data.place_of_birth || null,
      birth_certificate_no: data.birth_certificate_no || null,
      height_feet: data.height_feet || null,
      height_inches: data.height_inches || null,
      weight_kg: data.weight_kg || null,
      blood_group: data.blood_group || null,
      medical_category: data.medical_category || null,
      disability_nature: data.disability_nature || null,
      disability_attributable: data.disability_attributable || null,
      religion: data.religion || null,
      caste: data.caste || null,
      nationality: data.nationality || null,
      previous_nationality: data.previous_nationality || null,
      permanent_address: data.permanent_address || null,
      present_address: data.present_address || null,
      alternate_address: data.alternate_address || null,
      personal_email: data.personal_email || null,
      tt_phone: data.tt_phone || null,
      mobile: data.mobile || null,
      passport_number: data.passport_number || null,
      passport_date_issue: d(data.passport_date_issue),
      passport_place_issue: data.passport_place_issue || null,
      passport_date_expiry: d(data.passport_date_expiry),
      passport_type: data.passport_type || null,
      passport_issuing_auth: data.passport_issuing_auth || null,
      father_name: data.father_name || null,
      father_nationality: data.father_nationality || null,
      father_prev_nationality: data.father_prev_nationality || null,
      father_citizenship_auth: data.father_citizenship_auth || null,
      father_present_age: data.father_present_age || null,
      father_date_of_decease: d(data.father_date_of_decease),
      father_occupation: data.father_occupation || null,
      father_annual_income: data.father_annual_income || null,
      mother_name: data.mother_name || null,
      mother_nationality: data.mother_nationality || null,
      mother_prev_nationality: data.mother_prev_nationality || null,
      mother_citizenship_auth: data.mother_citizenship_auth || null,
      mother_present_age: data.mother_present_age || null,
      mother_date_of_decease: d(data.mother_date_of_decease),
      mother_occupation: data.mother_occupation || null,
      position_in_siblings: data.position_in_siblings || null,
      marital_status: data.marital_status || null,
      marriage_divorce_date: d(data.marriage_divorce_date),
      marriage_authority: data.marriage_authority || null,
      own_income: data.own_income || null,
      spouse_income: data.spouse_income || null,
      assets_income: data.assets_income || null,
      assets_details: data.assets_details || null,
      institution_law_breaking: data.institution_law_breaking || null,
      civil_law_breaking: data.civil_law_breaking || null,
      identification_marks: data.identification_marks || null,
      tid_bin_no: data.tid_bin_no || null,
      additional_qualification: data.additional_qualification || null,
      photo_url: data.photo_url || null,
      spouse_name: data.spouse_name_en || null
    };
    // Use PATCH (UPDATE) rather than upsert POST — avoids firing any legacy INSERT
    // trigger in the database that might reference the old "teachers_profile" table.
    const upsertRes = await supabaseRequest(`users_profile?teacher_id=eq.${tid}`, 'patch', profilePayload);
    const upsertErr = sbErr(upsertRes);
    if (upsertErr) return { error: 'DB error saving profile: ' + upsertErr };

    // 2. family_details
    await supabaseRequest(`family_details?teacher_id=eq.${tid}`, 'delete');
    if (data['fam_type[]']) {
      const types = castToArray(data['fam_type[]']);
      const names = castToArray(data['fam_name[]']);
      const dates = castToArray(data['fam_date[]']);
      const rows = [];
      for (let i = 0; i < types.length; i++) {
        if (names[i]) rows.push({ teacher_id: tid, member_type: types[i], name: names[i], marriage_date: d(dates[i]) });
      }
      if (rows.length) await supabaseRequest('family_details', 'post', rows);
    }

    // 3. faculty_attributes
    await supabaseRequest(`faculty_attributes?teacher_id=eq.${tid}`, 'delete');
    if (data['attr_header[]']) {
      const headers = castToArray(data['attr_header[]']);
      const subheaders = castToArray(data['attr_subheader[]']);
      const values = castToArray(data['attr_value[]']);
      const rows = [];
      for (let i = 0; i < headers.length; i++) {
        if (values[i]) rows.push({ teacher_id: tid, header: headers[i], subheader: subheaders[i] || '', value: values[i] });
      }
      if (rows.length) await supabaseRequest('faculty_attributes', 'post', rows);
    }

    // 4. Spouse Details
    if (data.spouse_name_en || data.spouse_name_bn) {
      await supabaseRequest('spouse_details?on_conflict=teacher_id', 'post', {
        teacher_id: tid,
        name_english: data.spouse_name_en || null,
        name_bengali: data.spouse_name_bn || null,
        date_of_birth: d(data.spouse_dob),
        place_of_birth: data.spouse_pob || null,
        birth_reg_number: data.spouse_birth_reg || null,
        nationality: data.spouse_nationality || null,
        prev_nationality: data.spouse_prev_nationality || null,
        citizenship_auth: data.spouse_citizenship_auth || null,
        national_id: data.spouse_nid || null,
        educational_qualification: data.spouse_education || null,
        occupation: data.spouse_occupation || null,
        occupation_designation: data.spouse_occ_designation || null,
        occupation_address: data.spouse_occ_address || null,
        previous_occupation: data.spouse_prev_occupation || null,
        tid_bin_no: data.spouse_tid_bin || null
      });
    }

    // 5. Dynamic tables — delete & reinsert
    const cv = key => { const a = castToArray(data[key] || []); return i => a[i] || null; };
    const dc = key => { const a = castToArray(data[key] || []); return i => d(a[i]); };

    const saveRows = async (table, firstKey, buildRow) => {
      await supabaseRequest(`${table}?teacher_id=eq.${tid}`, 'delete');
      const anchors = castToArray(data[firstKey] || []);
      const rows = [];
      for (let i = 0; i < anchors.length; i++) {
        if (anchors[i] && String(anchors[i]).trim() !== '') rows.push(buildRow(i));
      }
      if (rows.length) {
        const r = await supabaseRequest(table, 'post', rows);
        const e = sbErr(r);
        if (e) return { error: `DB error saving ${table}: ${e}` };
      }
      return null;
    };

    const subErrs = (await Promise.all([
      saveRows('countries_visited', 'country_name[]', i => ({
        teacher_id: tid, country_name: cv('country_name[]')(i),
        duration_from: dc('duration_from[]')(i), duration_to: dc('duration_to[]')(i),
        reasons: cv('visit_reasons[]')(i)
      })),
      saveRows('language_skills', 'language[]', i => ({
        teacher_id: tid, language: cv('language[]')(i), efficiency: cv('efficiency[]')(i)
      })),
      saveRows('siblings_info', 'sibling_name[]', i => ({
        teacher_id: tid, name: cv('sibling_name[]')(i), age: cv('sibling_age[]')(i),
        nationality: cv('sibling_nationality[]')(i), occupation_address: cv('sibling_occ_addr[]')(i),
        dependency: cv('sibling_dependency[]')(i)
      })),
      saveRows('children_info', 'child_name[]', i => ({
        teacher_id: tid, name: cv('child_name[]')(i), sex: cv('child_sex[]')(i),
        date_of_birth: dc('child_dob[]')(i), occupation: cv('child_occupation[]')(i),
        present_address: cv('child_address[]')(i), disease_notes: cv('child_disease_notes[]')(i)
      })),
      saveRows('chronic_diseases', 'disease_name[]', i => ({
        teacher_id: tid, disease_name: cv('disease_name[]')(i), nature: cv('disease_nature[]')(i),
        date_of_illness: dc('disease_date[]')(i), present_condition: cv('disease_condition[]')(i)
      })),
      saveRows('sibling_inlaws', 'inlaw_name[]', i => ({
        teacher_id: tid, name_in_full: cv('inlaw_name[]')(i), address: cv('inlaw_address[]')(i)
      })),
      saveRows('bank_accounts', 'bank_name[]', i => ({
        teacher_id: tid, bank_name: cv('bank_name[]')(i),
        account_number: cv('bank_account_no[]')(i), account_type: cv('bank_account_type[]')(i)
      })),
      saveRows('education_records', 'edu_school[]', i => ({
        teacher_id: tid, from_date: cv('edu_from[]')(i), to_date: cv('edu_to[]')(i),
        school_college: cv('edu_school[]')(i), exam_passed: cv('edu_exam[]')(i),
        division_gpa: cv('edu_gpa[]')(i), year_of_passing: cv('edu_year[]')(i),
        remarks: cv('edu_remarks[]')(i)
      }))
    ])).filter(Boolean);

    if (subErrs.length) return subErrs[0];
    return { success: true };
  },

  // ── STAFF / LEADERSHIP DATA ─────────────────────────────────────────────────

  async getAllStaffData([applyFilter, summaryOnly]) {
    const sel = summaryOnly
      ? 'teacher_id,full_name,category,designation,tt_phone,phone,whatsapp,is_evaluatable,yearly_acr(io_marks,rv_marks,rp_marks,year_num)'
      : '*,family_details(*),faculty_attributes(*),yearly_acr(*)';
    const res = await supabaseRequest(`users_profile?select=${sel}&order=full_name.asc`);
    if (applyFilter && Array.isArray(res)) {
      return res.filter(p => p.is_evaluatable === true && p.full_name && p.full_name.trim() !== '');
    }
    return res;
  },

  async getStaffDetails([teacherId]) {
    const res = await supabaseRequest(`users_profile?select=*,family_details(*),faculty_attributes(*)&teacher_id=eq.${teacherId}`);
    return (Array.isArray(res) && res.length > 0) ? res[0] : null;
  },

  async getTeacherAcr([teacherId]) {
    return (await supabaseRequest(`yearly_acr?teacher_id=eq.${teacherId}&order=year_num.asc`)) || [];
  },

  async updateMarks([teacherId, marks, field]) {
    const payload = {
      teacher_id: teacherId,
      year_num: 1,
      calendar_year: String(new Date().getFullYear())
    };
    payload[field] = parseFloat(marks);
    return supabaseRequest('yearly_acr?on_conflict=teacher_id,year_num', 'post', payload);
  },

  // ── TRACE REPORT ────────────────────────────────────────────────────────────

  async getTeacherTraceReport([teacherId]) {
    const [profile, acrYears, courses, committeeOld, bonusPenalty, settingsRaw, committeeGroups, evaluations] =
      await Promise.all([
        supabaseRequest(`users_profile?teacher_id=eq.${teacherId}`),
        supabaseRequest(`yearly_acr?teacher_id=eq.${teacherId}&order=year_num.asc`),
        supabaseRequest(`course_marks?teacher_id=eq.${teacherId}`),
        supabaseRequest(`committee_eval?teacher_id=eq.${teacherId}`),
        supabaseRequest(`bonus_penalty?teacher_id=eq.${teacherId}`),
        supabaseRequest('system_settings'),
        supabaseRequest('committee_groups?select=*'),
        supabaseRequest(`committee_evaluations_new?evaluated_id=eq.${teacherId}`)
      ]);

    const settings = {};
    if (Array.isArray(settingsRaw)) settingsRaw.forEach(s => { settings[s.key] = s.value; });

    const report = {
      profile: (Array.isArray(profile) && profile.length) ? profile[0] : {},
      yearlyData: Array.isArray(acrYears) ? acrYears : [],
      courses: Array.isArray(courses) ? courses : [],
      committee: (Array.isArray(committeeOld) && committeeOld.length)
        ? committeeOld[0]
        : { input_1: 0, input_2: 0, input_3: 0, input_4: 0 },
      bonusPenalty: Array.isArray(bonusPenalty) ? bonusPenalty : [],
      summary: { acrScore: 0, petScore: 0, courseScore: 0, commScore: 0, bonusTotal: 0, penaltyTotal: 0, finalTotal: 0 }
    };

    // A. ACR (60%) & PET (10%)
    let totalAcrMks = 0, totalPetMks = 0, activeYears = 0;
    report.yearlyData.forEach(yr => {
      if (!yr.is_exempt) {
        activeYears++;
        totalAcrMks += parseFloat(yr.io_marks || 0) + parseFloat(yr.rv_marks || 0) + parseFloat(yr.rp_marks || 0);
        totalPetMks += parseFloat(yr.pet_marks || 0);
      }
    });
    if (activeYears > 0) {
      report.summary.acrScore = (totalAcrMks / activeYears / 100) * 60;
      report.summary.petScore  = (totalPetMks / activeYears / 10) * 10;
    }

    // B. Courses (28%)
    report.courses.forEach(c => {
      report.summary.courseScore += (parseFloat(c.obtained_marks || 0) / parseFloat(c.full_marks || 100)) * parseFloat(c.weight_allotted || 0);
    });

    // C. New Committee Calculation (2%)
    const threshold = parseInt(settings.committee_threshold || 2);
    const weights   = settings.committee_weights || { member_eval: 20, chairman_eval: 30, admin_eval: 50 };
    const committeeScores = [];

    if (Array.isArray(committeeGroups) && Array.isArray(evaluations)) {
      committeeGroups.forEach(group => {
        const members = group.members_list || [];
        if (!members.some(m => m.user_id === teacherId)) return;

        const groupEvals  = evaluations.filter(e => e.committee_id === group.id);
        const memberAvg   = avg(groupEvals.filter(e => e.evaluator_role === 'member'));
        const chairAvg    = avg(groupEvals.filter(e => e.evaluator_role === 'chairman'));
        const adminEvals  = groupEvals.filter(e => ['Principal', 'VP', 'HR'].includes(e.evaluator_role));
        const adminMark   = parseFloat(
          (adminEvals.find(e => e.evaluator_role === 'Principal') ||
           adminEvals.find(e => e.evaluator_role === 'VP') ||
           adminEvals.find(e => e.evaluator_role === 'HR') ||
           { marks: 0 }
          ).marks || 0
        );

        const committeeTotal =
          (memberAvg * 20) * (weights.member_eval   / 100) +
          (chairAvg  * 20) * (weights.chairman_eval  / 100) +
          adminMark        * (weights.admin_eval     / 100);
        committeeScores.push(committeeTotal);
      });
    }

    if (committeeScores.length > 0) {
      const raw = committeeScores.length <= threshold
        ? committeeScores.reduce((s, v) => s + v, 0)
        : committeeScores.reduce((s, v) => s + v, 0) / committeeScores.length;
      report.summary.commScore   = (raw / 100) * 2;
      report.committeeScores     = committeeScores;
    }

    // D. Bonus & Penalty
    report.bonusPenalty.forEach(bp => {
      if (bp.type === 'Bonus')   report.summary.bonusTotal   += parseFloat(bp.amount || 0);
      if (bp.type === 'Penalty') report.summary.penaltyTotal += parseFloat(bp.amount || 0);
    });

    report.summary.finalTotal =
      report.summary.acrScore + report.summary.petScore +
      report.summary.courseScore + report.summary.commScore +
      report.summary.bonusTotal - report.summary.penaltyTotal;

    return report;
  },

  // ── SYSTEM SETTINGS ─────────────────────────────────────────────────────────

  async getSystemSettings() {
    const res = await supabaseRequest('system_settings');
    const settings = {};
    if (Array.isArray(res)) res.forEach(s => { settings[s.key] = s.value; });
    return settings;
  },

  async updateSystemSettings([data]) {
    const payloads = Object.entries(data).map(([key, value]) => ({ key, value }));
    return supabaseRequest('system_settings?on_conflict=key', 'post', payloads);
  },

  // ── COMMITTEES ──────────────────────────────────────────────────────────────

  async createCommittee([data]) {
    return supabaseRequest('committee_groups', 'post', data);
  },

  async updateCommittee([id, data]) {
    return supabaseRequest(`committee_groups?id=eq.${id}`, 'patch', data);
  },

  async deleteCommittee([id]) {
    return supabaseRequest(`committee_groups?id=eq.${id}`, 'delete');
  },

  async getUserCommittees() {
    return supabaseRequest('committee_groups?select=*&order=create_date.desc');
  },

  async getCommitteeChat([committeeId]) {
    const res = await supabaseRequest(`committee_groups?id=eq.${committeeId}&select=chat_messages,member_aliases,members_list,status`);
    if (!Array.isArray(res) || !res.length) return { chat_messages: [], member_aliases: {}, members_list: [], status: 'active' };
    return res[0];
  },

  async sendCommitteeMessage([committeeId, msg, mentions, senderName]) {
    const data = await handlers.getCommitteeChat([committeeId]);
    // Chat is read-only once the committee is closed or archived
    if (data.status === 'closed' || data.status === 'archived') {
      return { error: 'closed', message: 'This committee activity is closed — chat is read-only.' };
    }
    const msgs = Array.isArray(data.chat_messages) ? data.chat_messages : [];
    msgs.push(msg);
    const result = await supabaseRequest(`committee_groups?id=eq.${committeeId}`, 'patch', { chat_messages: msgs });

    // Notify any @mentioned members (mentions = array of user_ids resolved on the client)
    if (Array.isArray(mentions) && mentions.length) {
      const senderId = msg && msg.user_id;
      const recips = [...new Set(mentions.filter(id => id && id !== senderId))];
      if (recips.length) {
        const c = await supabaseRequest(`committee_groups?id=eq.${committeeId}&select=committee_name`);
        const commName = (Array.isArray(c) && c[0]) ? c[0].committee_name : 'a committee';
        const who = senderName || senderId || 'Someone';
        const preview = String((msg && msg.text) || '').slice(0, 120);
        const notifs = recips.map(uid => ({
          user_id: uid,
          type: 'mention',
          title: 'You were mentioned',
          message: `${who} mentioned you in "${commName}": ${preview}`,
          data: { committee_id: committeeId, committee_name: commName },
          is_read: false,
          created_at: new Date().toISOString()
        }));
        await supabaseRequest('notifications', 'post', notifs);
      }
    }
    return result;
  },

  async deleteLastOwnMessage([committeeId, userId]) {
    const data = await handlers.getCommitteeChat([committeeId]);
    const msgs = Array.isArray(data.chat_messages) ? data.chat_messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].user_id === userId) { msgs.splice(i, 1); break; }
    }
    return supabaseRequest(`committee_groups?id=eq.${committeeId}`, 'patch', { chat_messages: msgs });
  },

  async updateMemberAliases([committeeId, aliases]) {
    return supabaseRequest(`committee_groups?id=eq.${committeeId}`, 'patch', { member_aliases: aliases });
  },

  async closeCommitteeActivity([id]) {
    // 1. Mark committee as closed
    const result = await supabaseRequest(`committee_groups?id=eq.${id}`, 'patch', {
      status: 'closed',
      closed_at: new Date().toISOString()
    });

    // 2. Fetch committee details and all users
    const [comm, allUsers] = await Promise.all([
      supabaseRequest(`committee_groups?id=eq.${id}&select=committee_name,members_list`),
      supabaseRequest('app_users?select=user_id,role')
    ]);

    if (!Array.isArray(comm) || !comm.length) return result;

    const c = comm[0];
    const memberIds = (c.members_list || []).map(m => m.user_id);

    // 3. Collect Admin/HR/VP/Principal user IDs
    const privileged = (Array.isArray(allUsers) ? allUsers : [])
      .filter(u => /Admin|HR|VP|Principal/.test(u.role || ''))
      .map(u => u.user_id);

    const recipients = [...new Set([...memberIds, ...privileged])];

    // 4. Post notifications for all recipients
    const notifs = recipients.map(uid => ({
      user_id: uid,
      type: 'committee_closed',
      title: 'Committee Activity Closed',
      message: `"${c.committee_name}" has been marked as closed.`,
      data: { committee_id: id, committee_name: c.committee_name },
      is_read: false,
      created_at: new Date().toISOString()
    }));

    if (notifs.length) await supabaseRequest('notifications', 'post', notifs);
    return result;
  },

  // Archive a closed committee (admins) — moves it out of the active list for later review
  async archiveCommittee([id]) {
    return supabaseRequest(`committee_groups?id=eq.${id}`, 'patch', { status: 'archived' });
  },

  // Restore an archived committee back to closed state
  async unarchiveCommittee([id]) {
    return supabaseRequest(`committee_groups?id=eq.${id}`, 'patch', { status: 'closed' });
  },

  // ── NOTIFICATIONS ────────────────────────────────────────────────────────────

  async getMyNotifications([userId]) {
    const result = await supabaseRequest(`notifications?user_id=eq.${userId}&order=created_at.desc&limit=50`);
    return Array.isArray(result) ? result : [];
  },

  async markNotificationRead([id]) {
    return supabaseRequest(`notifications?id=eq.${id}`, 'patch', { is_read: true });
  },

  async markAllNotificationsRead([userId]) {
    return supabaseRequest(`notifications?user_id=eq.${userId}&is_read=eq.false`, 'patch', { is_read: true });
  },

  // ── PRESENCE ────────────────────────────────────────────────────────────────

  async updateLastActive([userId]) {
    try {
      return await supabaseRequest(`app_users?user_id=eq.${userId}`, 'patch', {
        last_active: new Date().toISOString()
      });
    } catch { return null; } // column may not exist yet — fail silently
  },

  async getAllUsersWithPresence() {
    // Use users_profile as the source of truth (all 243 staff/faculty)
    // Merge app_users (role, email, last_active) for those who have accounts
    const [profiles, users] = await Promise.all([
      supabaseRequest('users_profile?select=teacher_id,full_name,designation,photo_url,category,whatsapp,phone&order=full_name.asc&limit=1000'),
      supabaseRequest('app_users?select=user_id,role,email,last_active&limit=1000')
    ]);
    const userMap = {};
    if (Array.isArray(users)) users.forEach(u => { userMap[u.user_id] = u; });
    const arr = Array.isArray(profiles) ? profiles : [];
    return arr
      .filter(p => p.teacher_id) // skip rows with no ID
      .map(p => {
        const u = userMap[p.teacher_id] || {};
        return {
          user_id:     p.teacher_id,
          full_name:   p.full_name   || null,
          designation: p.designation || null,
          photo_url:   p.photo_url   || null,
          whatsapp:    p.whatsapp    || null,
          phone:       p.phone       || null,
          email:       u.email       || null,
          role:        u.role        || p.category || null,
          last_active: u.last_active || null,
          has_account: !!userMap[p.teacher_id]
        };
      })
      .sort((a, b) => {
        // Active users first, then alphabetical
        if (a.last_active && b.last_active) return new Date(b.last_active) - new Date(a.last_active);
        if (a.last_active) return -1;
        if (b.last_active) return 1;
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
  },

  // ── EVALUATIONS ─────────────────────────────────────────────────────────────

  async saveCommitteeEvalNew([data]) {
    return supabaseRequest('committee_evaluations_new', 'post', data);
  },

  async saveYearlyAcr([data]) {
    return supabaseRequest('yearly_acr?on_conflict=teacher_id,year_num', 'post', data);
  },

  async saveCourseMark([data]) {
    return supabaseRequest('course_marks', 'post', data);
  },

  async deleteCourseMark([id]) {
    return supabaseRequest(`course_marks?id=eq.${id}`, 'delete');
  },

  async saveCommitteeEval([data]) {
    return supabaseRequest('committee_eval?on_conflict=teacher_id', 'post', data);
  },

  async saveBonusPenalty([data]) {
    return supabaseRequest('bonus_penalty', 'post', data);
  },

  async deleteBonusPenalty([id]) {
    return supabaseRequest(`bonus_penalty?id=eq.${id}`, 'delete');
  },

  async getCourseMarks([teacherId]) {
    return (await supabaseRequest(`course_marks?teacher_id=eq.${teacherId}&order=id.asc`)) || [];
  },

  async getBonusPenalty([teacherId]) {
    return (await supabaseRequest(`bonus_penalty?teacher_id=eq.${teacherId}&order=id.asc`)) || [];
  },

  // ── PHOTO UPLOAD ─────────────────────────────────────────────────────────────

  async uploadPhotoToDrive([base64Data, fileName, teacherId]) {
    const raw = base64Data.replace(/^data:[^;]+;base64,/, '');
    const binary = atob(raw);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    const contentType = (base64Data.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const SB_URL = process.env.SUPABASE_URL;
    const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/photos/${fileName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: buf
    });
    if (!uploadRes.ok) return { success: false, error: await uploadRes.text() };

    // Storage object path is constant per teacher (overwritten via x-upsert) — no duplicate files.
    // Cache-bust the stored URL so the freshly overwritten image is shown instead of a CDN-cached one.
    const publicUrl = `${SB_URL}/storage/v1/object/public/photos/${fileName}?v=${Date.now()}`;
    if (teacherId) {
      await supabaseRequest(`users_profile?teacher_id=eq.${teacherId}`, 'patch', { photo_url: publicUrl });
    }
    return { success: true, fileId: publicUrl };
  },

  // Legacy alias — shim may call 'uploadPhoto' from the old dispatch table
  async uploadPhoto([base64Data, fileName, teacherId]) {
    return handlers.uploadPhotoToDrive([base64Data, fileName, teacherId]);
  },

  // ── CONNECTION TEST ───────────────────────────────────────────────────────────

  async testConnection() {
    const res = await supabaseRequest('app_users?select=count');
    return Array.isArray(res) ? { ok: true } : { ok: false };
  },

  // ── DIRECT MESSAGING ──────────────────────────────────────────────────────────

  async sendDirectMessage([senderId, recipientId, message]) {
    const row = { sender_id: senderId, recipient_id: recipientId, message, is_read: false, created_at: new Date().toISOString() };
    const res = await supabaseRequest('direct_messages', 'post', row);
    // Push a real-time ping to the recipient so their browser updates instantly
    _rtBroadcast(recipientId, 'new_message', { from: senderId });
    return res;
  },

  async getConversation([userId, otherId]) {
    const res = await supabaseRequest(
      `direct_messages?or=(and(sender_id.eq.${userId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${userId}))&order=created_at.asc&limit=100`
    );
    return Array.isArray(res) ? res : [];
  },

  async getMyDmInbox([userId]) {
    // Latest message per conversation partner
    const res = await supabaseRequest(
      `direct_messages?or=(sender_id.eq.${userId},recipient_id.eq.${userId})&order=created_at.desc&limit=200`
    );
    if (!Array.isArray(res)) return [];
    const seen = new Map();
    res.forEach(m => {
      const other = m.sender_id === userId ? m.recipient_id : m.sender_id;
      if (!seen.has(other)) seen.set(other, m);
    });
    return Array.from(seen.values());
  },

  async markDmRead([myId, otherId]) {
    return supabaseRequest(
      `direct_messages?sender_id=eq.${otherId}&recipient_id=eq.${myId}&is_read=eq.false`,
      'patch', { is_read: true }
    );
  },

  async countUnreadDms([userId]) {
    const res = await supabaseRequest(`direct_messages?recipient_id=eq.${userId}&is_read=eq.false&select=id`);
    return Array.isArray(res) ? res.length : 0;
  },

  // Inbox enriched with partner profile, presence, last-message preview and unread count.
  // One call powers the whole conversation list in the Messages center.
  async getMessagingOverview([userId]) {
    const [msgs, profiles, users] = await Promise.all([
      supabaseRequest(`direct_messages?or=(sender_id.eq.${userId},recipient_id.eq.${userId})&order=created_at.desc&limit=500`),
      supabaseRequest('users_profile?select=teacher_id,full_name,designation,photo_url,whatsapp,phone&limit=1000'),
      supabaseRequest('app_users?select=user_id,last_active&limit=1000')
    ]);
    const profileMap = {};
    if (Array.isArray(profiles)) profiles.forEach(p => { profileMap[p.teacher_id] = p; });
    const activeMap = {};
    if (Array.isArray(users)) users.forEach(u => { activeMap[u.user_id] = u.last_active; });

    const convMap = new Map();  // insertion order = latest-message-first (msgs are desc)
    let totalUnread = 0;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        const partner = m.sender_id === userId ? m.recipient_id : m.sender_id;
        if (!convMap.has(partner)) {
          convMap.set(partner, {
            partner_id: partner,
            last_message: m.message,
            last_message_at: m.created_at,
            last_sender_id: m.sender_id,
            unread: 0
          });
        }
        const c = convMap.get(partner);
        if (m.recipient_id === userId && !m.is_read) { c.unread++; totalUnread++; }
      }
    }
    const conversations = Array.from(convMap.values()).map(c => {
      const p = profileMap[c.partner_id] || {};
      return {
        ...c,
        full_name:   p.full_name   || c.partner_id,
        designation: p.designation || null,
        photo_url:   p.photo_url   || null,
        whatsapp:    p.whatsapp    || null,
        phone:       p.phone       || null,
        last_active: activeMap[c.partner_id] || null
      };
    });
    return { conversations, totalUnread };
  },

  async deleteDirectMessage([msgId, userId]) {
    // only the sender can delete their own message
    return supabaseRequest(`direct_messages?id=eq.${msgId}&sender_id=eq.${userId}`, 'delete');
  },

  // ── ROUTINE / CLASS ADJUSTMENT ("Cut & Toss") ───────────────────────────────

  // Full staff directory with shortname mapping, sourced from the "Logged in info" sheet.
  async getRoutineDirectory() {
    const rows = await _fetchSheetRows('Logged in info');
    const header = rows[0] || [];
    const fnIdx = header.findIndex(h => String(h).trim() === 'Full Name');
    const snIdx = header.findIndex(h => String(h).trim() === 'NAME IN SHORT');
    const desigIdx = header.findIndex(h => String(h).trim() === 'Designation');
    if (fnIdx < 0 || snIdx < 0) return [];
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const shortname = String(r[snIdx] || '').trim();
      const fullName = String(r[fnIdx] || '').trim();
      if (!shortname || !fullName) continue;
      out.push({ shortname, fullName, designation: desigIdx >= 0 ? String(r[desigIdx] || '').trim() : '' });
    }
    return out;
  },

  // Full week routine for one teacher, from the "Classes" master sheet.
  async getWeeklyRoutine([shortname]) {
    const rows = await _fetchSheetRows('Classes');
    const headerIdx = rows.findIndex(r => r.some(c => String(c).trim() === 'Name'));
    if (headerIdx < 0) return { error: 'Could not read Classes sheet header' };
    const header = rows[headerIdx];
    const nameIdx = header.findIndex(c => String(c).trim() === 'Name');
    const weekdayIdx = _findWeekdayCol(header);
    const periodCols = _findPeriodCols(header);
    const target = String(shortname || '').trim().toLowerCase();
    const days = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 2) continue;
      const wd = weekdayIdx >= 0 ? String(r[weekdayIdx] || '').trim() : '';
      const name = String(r[nameIdx] || '').trim();
      if (!wd || !name || name.toLowerCase() !== target) continue;
      days[wd] = days[wd] || {};
      periodCols.forEach(pc => { days[wd][pc.label] = String(r[pc.idx] || '').trim(); });
    }
    return { periods: periodCols.map(p => p.label), days };
  },

  // Today's live schedule ("Selected" sheet) + derived adjustments (diffed
  // against the matching weekday's master "Classes" routine — a cell that no
  // longer matches the master and contains no ";" is a swapped-in substitute).
  async getTodayRoutineBoard() {
    const rows = await _fetchSheetRows('Selected');
    const headerIdx = rows.findIndex(r => r.some(c => String(c).trim() === 'Name'));
    if (headerIdx < 0) return { error: 'Could not read Selected sheet' };
    const header = rows[headerIdx];
    const nameIdx = header.findIndex(c => String(c).trim() === 'Name');
    const periodCols = _findPeriodCols(header);
    const meta = rows[0] || [];
    const weekday = meta.find(c => WEEKDAYS.includes(String(c).trim())) || '';
    const dateLabel = meta.find(c => /\d{4}/.test(String(c)) && !WEEKDAYS.includes(String(c).trim())) || '';

    // Master routine for the same weekday, keyed by shortname, for diffing
    const classesRows = await _fetchSheetRows('Classes');
    const cHeaderIdx = classesRows.findIndex(r => r.some(c => String(c).trim() === 'Name'));
    const cHeader = classesRows[cHeaderIdx] || [];
    const cNameIdx = cHeader.findIndex(c => String(c).trim() === 'Name');
    const cWeekdayIdx = _findWeekdayCol(cHeader);
    const cPeriodCols = _findPeriodCols(cHeader);
    const masterByName = {};
    for (let i = cHeaderIdx + 1; i < classesRows.length; i++) {
      const r = classesRows[i];
      const wd = cWeekdayIdx >= 0 ? String(r[cWeekdayIdx] || '').trim() : '';
      if (wd !== weekday) continue;
      const nm = String(r[cNameIdx] || '').trim();
      if (!nm) continue;
      masterByName[nm] = masterByName[nm] || {};
      cPeriodCols.forEach(pc => { masterByName[nm][pc.label] = String(r[pc.idx] || '').trim(); });
    }

    const periodColNumbers = {};
    periodCols.forEach(pc => { periodColNumbers[pc.label] = pc.idx + 1; });

    // Trailing summary columns: "...,7th,<scheduled count>,<gotten count>,Adjusted"
    // — "Adjusted" is the only labeled one; gotten is the column right before it.
    const adjustedColIdx = header.findIndex(h => String(h).trim() === 'Adjusted');
    const gottenColIdx = adjustedColIdx >= 0 ? adjustedColIdx - 1 : -1;

    const dataRows = [];
    const adjustments = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[nameIdx] || '').trim();
      if (!name) continue;
      const periods = {};
      periodCols.forEach(pc => {
        const val = String(r[pc.idx] || '').trim();
        periods[pc.label] = val;
        const original = (masterByName[name] || {})[pc.label] || '';
        // A substitute's OWN cell gets annotated by the sheet's write logic as
        // "<classSubject> (<originalTeacher>)" — e.g. "IX-BS-EV; Accounting (SR)".
        // That's the flip side of the same adjustment, not a second one, so it
        // must be excluded here. Semicolon-presence alone isn't reliable (one
        // master-routine cell uses a comma instead), so also match the trailing
        // "(Name)" annotation pattern directly.
        const isAnnotatedBySomeoneElse = /\([^()]+\)\s*$/.test(val);
        if (val && !val.includes(';') && !isAnnotatedBySomeoneElse && val !== original) {
          adjustments.push({ shortname: name, period: pc.label, originalClass: original, coveredBy: val });
        }
      });
      const adjustedCount = adjustedColIdx >= 0 ? parseInt(r[adjustedColIdx], 10) || 0 : 0;
      const gottenCount = gottenColIdx >= 0 ? parseInt(r[gottenColIdx], 10) || 0 : 0;
      dataRows.push({ shortname: name, sheetRow: i + 1, periods, adjustedCount, gottenCount });
    }

    const parsedDate = dateLabel ? new Date(dateLabel) : null;
    const isoDate = parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString().slice(0, 10) : '';

    return { dateLabel, isoDate, weekday, periods: periodCols.map(p => p.label), periodColNumbers, rows: dataRows, adjustments };
  },

  // Free-teacher candidates for a given period, from the "Dropdown" sheet —
  // values are passed through byte-for-byte, matching what a human picking
  // from the same in-sheet dropdown would produce.
  async getSubstituteOptions([periodLabel]) {
    const rows = await _fetchSheetRows('Dropdown');
    const header = rows[0] || [];
    const idx = header.findIndex(h => String(h).trim().toLowerCase() === String(periodLabel || '').trim().toLowerCase());
    if (idx < 0) return [];
    const opts = [];
    for (let i = 1; i < rows.length; i++) {
      const v = String(rows[i][idx] || '').trim();
      if (v) opts.push(v);
    }
    return opts;
  },

  // Reassign one period to a substitute — Cord/Admin only (checked server-side).
  // Delegates the actual sheet mutation to the existing, already-live Apps
  // Script web app so both the Kodular app and this portal share one code path.
  async submitClassAdjustment([callerId, teacherShortname, periodLabel, substituteValue]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized to make adjustments.' };
    const board = await handlers.getTodayRoutineBoard();
    if (board.error) return { success: false, message: board.error };
    const row = board.rows.find(r => r.shortname.toLowerCase() === String(teacherShortname || '').trim().toLowerCase());
    if (!row) return { success: false, message: `Could not find ${teacherShortname} in today's schedule.` };
    const col = board.periodColNumbers[periodLabel];
    if (!col) return { success: false, message: 'Unknown period.' };

    // Defensive: strip any load-info annotation (e.g. "MMU (1,1,0, L./PS: 0)")
    // down to the bare shortname — the sheet's real cells never carry that
    // annotation, and sending it verbatim doesn't match anything on the Apps
    // Script side, which silently no-ops while still reporting "success".
    const sto = String(substituteValue || '').split(' (')[0].trim();
    if (!sto) return { success: false, message: 'No substitute selected.' };

    const gasRes = await _callRoutineGas({ action: 'write', row1: row.sheetRow, col, sto });
    if (!gasRes.ok) return { success: false, message: gasRes.text || 'Write request failed.' };

    // The Apps Script endpoint returns a generic success message even when its
    // internal logic silently does nothing — verify the cell actually changed
    // before reporting success back to the client.
    const verifyBoard = await handlers.getTodayRoutineBoard();
    const verifyRow = !verifyBoard.error && (verifyBoard.rows || []).find(r => r.shortname.toLowerCase() === row.shortname.toLowerCase());
    const newVal = verifyRow ? String(verifyRow.periods[periodLabel] || '').trim() : '';
    if (newVal.toLowerCase() === sto.toLowerCase()) {
      const oldValue = row.periods[periodLabel];
      await _notifyAdjustment({ originalShortname: row.shortname, substituteShortname: sto, periodLabel, oldValue });
      return { success: true, message: gasRes.text, oldValue };
    }
    return { success: false, message: `The sheet did not update as expected (cell still shows "${newVal}"). Please try again.` };
  },

  // Seed today's "Selected" sheet from the master "Classes" routine — Cord/Admin only.
  async runDailyRoutineSetup([callerId, dateStr]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized.' };
    const gasRes = await _callRoutineGas({ action: 'setup', date: dateStr });
    return { success: gasRes.ok, message: gasRes.text };
  },

  // Render today's adjustment notice as PDF — Cord/Admin only (generation has cost).
  async generateAdjustmentPdf([callerId]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized.' };
    const gasRes = await _callRoutineGas({ action: 'pdf' });
    return { success: gasRes.ok && !!gasRes.text, url: gasRes.text };
  },

  // Anyone can see the most recently generated adjustment PDF (read-only).
  async getLatestAdjustmentPdf() {
    const rows = await _fetchSheetRows('Adjustment link');
    if (rows.length < 2) return null;
    const [name, url, status] = rows[1];
    return { name: name || '', url: url || '', status: status || '' };
  },

  // Full history of generated adjustment PDFs (read-only) — the sheet
  // prepends each new entry above row 2 (see appscript.gs), so rows are
  // already newest-first; no sorting needed. Each "PDF Name" cell encodes
  // two dates as one string, e.g.
  //   "Thu Jul 2, 2026,(PDF Created: Jul 5, 2026, 11:08 pm).pdf"
  // — the adjustment date the notice covers, and when it was generated —
  // split apart here so the UI doesn't have to parse it.
  async getAdjustmentPdfHistory() {
    const rows = await _fetchSheetRows('Adjustment link');
    if (rows.length < 2) return [];
    const header = rows[0];
    const nameIdx = header.findIndex(h => String(h).trim() === 'PDF Name');
    const urlIdx = header.findIndex(h => String(h).trim() === 'Download Link');
    const statusIdx = header.findIndex(h => String(h).trim() === 'Status');
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[nameIdx] || '').trim();
      const url = String(r[urlIdx] || '').trim();
      if (!name || !url) continue;
      const m = name.match(/^(.*?),?\s*\(PDF Created:\s*(.*?)\)\.pdf$/i);
      out.push({
        name,
        url,
        status: String(r[statusIdx] || '').trim(),
        adjustmentDateLabel: m ? m[1].trim() : name.replace(/\.pdf$/i, ''),
        createdLabel: m ? m[2].trim() : '',
      });
    }
    return out;
  },

  // ── STUDENT TAB DATA (delegated access) ──────────────────────────────────────
  // Admins pick teachers/staff per custom tab (portal_tabs.data_access_json in the
  // student schema); those users can view + export that tab's submissions here.

  async getMyTabDataAccess([userId]) {
    if (!userId) return [];
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_tabs?select=tab_name,data_access_json&order=sort_order.asc`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Accept-Profile': 'student' },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.filter(t => {
      try { return JSON.parse(t.data_access_json || '[]').includes(String(userId)); } catch { return false; }
    }).map(t => ({ tab_name: t.tab_name }));
  },

  async getTabDataForUser([userId, tabName]) {
    if (!userId || !tabName) return { error: 'Not authorized.' };
    const sbStudent = async (path) => {
      const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Accept-Profile': 'student' },
      });
      return res.ok ? res.json() : { error: 'query failed' };
    };
    // authorization: the caller must be on this tab's access list — checked
    // server-side on every request, never trusted from the client
    const tabRow = await sbStudent(`portal_tabs?tab_name=eq.${encodeURIComponent(tabName)}`);
    const cfg = (Array.isArray(tabRow) && tabRow[0]) ? tabRow[0] : null;
    let allowed = [];
    try { allowed = JSON.parse(cfg?.data_access_json || '[]'); } catch {}
    if (!allowed.includes(String(userId))) return { error: 'Not authorized for this tab.' };

    const rows = await sbStudent(`portal_submissions?tab_name=eq.${encodeURIComponent(tabName)}&order=submitted_at.asc`);
    if (!Array.isArray(rows) || !rows.length) return { headers: ['student_id'], rows: [] };

    // same config-ordered columns as the admin Data view
    const ordered = ['student_id'];
    if (cfg) {
      try { JSON.parse(cfg.include_fields_json || '[]').forEach(k => { if (k && !ordered.includes(k)) ordered.push(k); }); } catch {}
      try {
        JSON.parse(cfg.fields_json || '[]').forEach(f => {
          const k = f?.data_key || f?.id;
          if (k && f.type !== 'group_label' && !ordered.includes(k)) ordered.push(k);
        });
      } catch {}
    }
    const extras = new Set();
    rows.forEach(r => Object.keys(r.data || {}).forEach(k => { if (!ordered.includes(k)) extras.add(k); }));
    const headers = [...ordered, ...extras];
    const dataRows = rows.map(r => headers.map(h => h === 'student_id' ? r.student_id : (r.data?.[h] ?? '')));
    return { headers, rows: dataRows };
  },

  // ── CLASS TEACHER → STUDENT ROSTER ────────────────────────────────────────
  // _getClassTeacherAssignments (free-standing, above) does the actual sheet
  // resolution; these two handlers only ever look up by the CALLER's own
  // userId — a class/section is never accepted from the client.
  async getMyClassAssignments([userId]) {
    if (!userId) return { classes: [] };
    const assignments = await _getClassTeacherAssignments();
    const classes = assignments
      .filter(a => a.resolvedUserId === userId)
      .map(({ classKey, className, section }) => ({ classKey, className, section }));
    return { classes };
  },

  async getMyClassRoster([userId]) {
    if (!userId) return { classes: [] };
    const assignments = await _getClassTeacherAssignments();
    const mine = assignments.filter(a => a.resolvedUserId === userId);
    if (!mine.length) return { classes: [] };

    const classes = await Promise.all(mine.map(async ({ classKey, className, section }) => {
      const studentClass = CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className;
      const studentSection = CLASS_TEACHER_SECTION_ALIASES[section] || section;
      const students = await _sbStudent(
        `students_data?class=eq.${encodeURIComponent(studentClass)}&section=eq.${encodeURIComponent(studentSection)}` +
        `&select=student_id,student_name,roll,gender,version,shift,phone_number,father_phone,mother_phone&order=roll.asc`
      );
      return { classKey, className, section, students: Array.isArray(students) ? students : [] };
    }));
    return { classes };
  },

  // Full read-only detail panel for one student — canteen, attendance, custom
  // tab submissions, and base profile. Authorization is NOT "the roster only
  // links to your own students" (that's just UI convenience) — this handler
  // independently re-derives the caller's resolved classes and checks the
  // requested student actually belongs to one of them before returning
  // anything, so a tampered studentId can never leak another class's data.
  // Custom-tab visibility here deliberately bypasses each tab's own global
  // data_access_json allowlist: being this student's verified class teacher
  // is itself sufficient authorization, per an explicit product decision —
  // it is not, and should not become, a way to read another tab's global
  // allowlist or grant access beyond this one student.
  async getStudentDetail([callerUserId, studentId]) {
    if (!callerUserId || !studentId) return { error: 'Not authorized.' };

    const assignments = await _getClassTeacherAssignments();
    const mine = assignments
      .filter(a => a.resolvedUserId === callerUserId)
      .map(a => ({
        studentClass: CLASS_TEACHER_NAME_TO_STUDENT_CLASS[a.className] || a.className,
        studentSection: CLASS_TEACHER_SECTION_ALIASES[a.section] || a.section,
      }));
    if (!mine.length) return { error: 'Not authorized for this student.' };

    const studentRows = await _sbStudent(`students_data?student_id=eq.${encodeURIComponent(studentId)}&select=*`);
    const student = Array.isArray(studentRows) && studentRows[0];
    if (!student) return { error: 'Student not found.' };

    const isMine = mine.some(m => m.studentClass === student.class && m.studentSection === student.section);
    if (!isMine) return { error: 'Not authorized for this student.' };

    const { pin, nfc_uid, ...profile } = student;

    const [attendance, orders, recharges, tabs, submissions] = await Promise.all([
      _sbStudent(`attendance_records?student_id=eq.${encodeURIComponent(studentId)}&select=date,entry_time,exit_time&order=date.desc&limit=30`),
      _sbStudent(`canteen_orders?student_id=eq.${encodeURIComponent(studentId)}&select=orders,price,is_delivered,invoice_number,created_at&order=created_at.desc&limit=20`),
      _sbStudent(`recharge_history?student_id=eq.${encodeURIComponent(studentId)}&select=amount,gateway,confirmation,created_at&order=created_at.desc&limit=10`),
      _sbStudent(`portal_tabs?is_enabled=eq.true&select=tab_name,fields_json,icon_class&order=sort_order.asc`),
      _sbStudent(`portal_submissions?student_id=eq.${encodeURIComponent(studentId)}&select=tab_name,data,updated_at`),
    ]);

    const submissionByTab = {};
    (Array.isArray(submissions) ? submissions : []).forEach(s => { submissionByTab[s.tab_name] = s; });
    const customTabs = (Array.isArray(tabs) ? tabs : [])
      .filter(t => submissionByTab[t.tab_name])
      .map(t => {
        let fields = [];
        try { fields = JSON.parse(t.fields_json || '[]'); } catch {}
        const sub = submissionByTab[t.tab_name];
        return { tab_name: t.tab_name, icon_class: t.icon_class, updated_at: sub.updated_at, fields, data: sub.data || {} };
      });

    return {
      profile,
      attendance: Array.isArray(attendance) ? attendance : [],
      canteen: {
        orders: Array.isArray(orders) ? orders : [],
        recharges: Array.isArray(recharges) ? recharges : [],
      },
      customTabs,
      resultsAvailable: false,
    };
  },

  // ── INVENTORY (chain-of-custody: receive at ccpc-inventory's central store,
  // then any room/building/person/committee that received something can hand
  // it onward themselves) — cross-schema against the `inventory` schema on
  // the same Supabase project, same pattern as the student-tab-data handlers
  // above (bare id strings, no cross-schema FK, re-verified server-side on
  // every call). "Person" consumer rows are expected to carry the holder's
  // real ccpc-teachers user_id in `reference_id` — see ccpc-inventory's
  // Settings > Consumer Info field hint. _invReq/_invResolveReceiver are
  // free-standing helpers above (not handlers properties), so they can't be
  // reached directly via {fn:"_invReq",...} from the client. ─────────────────

  // Everything this user holds AS THEMSELVES (their own "person" consumer
  // record) plus their full personal receipt history.
  async getMyHolderStock([userId]) {
    if (!userId) return { holdings: [] };
    const consumerRows = await _invReq(
      `consumers?reference_id=eq.${encodeURIComponent(userId)}&type=in.(teacher,staff)&select=id`
    );
    if (!Array.isArray(consumerRows) || !consumerRows.length) return { holdings: [] };
    const consumerId = consumerRows[0].id;
    const holdings = await _invReq(
      `holder_stock?consumer_id=eq.${consumerId}&quantity=gt.0&select=*,products(name,code,unit_id)`
    );
    return { holdings: Array.isArray(holdings) ? holdings : [], consumerId };
  },

  async getMyDistributionHistory([userId]) {
    if (!userId) return { rows: [] };
    const rows = await _invReq(
      `distributions?receiver_user_id=eq.${encodeURIComponent(userId)}&select=*,distribution_items(quantity,total_price,products(name,code)),consumers!distributions_consumer_id_fkey(name,type)&order=created_at.desc`
    );
    return { rows: Array.isArray(rows) ? rows : [] };
  },

  // Rooms/buildings/committees this user has been made a distributor for —
  // each with its own current holder_stock (resolved via the matching
  // consumer row for that holder).
  async getAssignedHolders([userId]) {
    if (!userId) return { holders: [] };
    const assignments = await _invReq(`distributor_assignments?assignee_user_id=eq.${encodeURIComponent(userId)}&select=*`);
    if (!Array.isArray(assignments) || !assignments.length) return { holders: [] };

    const holders = await Promise.all(assignments.map(async (a) => {
      const consumerRows = await _invReq(
        `consumers?type=eq.${a.holder_type}&reference_id=eq.${encodeURIComponent(String(a.holder_id))}&select=id,name`
      );
      const consumer = Array.isArray(consumerRows) && consumerRows[0];
      if (!consumer) return { ...a, consumer_id: null, name: null, holdings: [] };
      const holdings = await _invReq(`holder_stock?consumer_id=eq.${consumer.id}&quantity=gt.0&select=*,products(name,code)`);
      return { ...a, consumer_id: consumer.id, name: consumer.name, holdings: Array.isArray(holdings) ? holdings : [] };
    }));
    return { holders };
  },

  // Recipient picker data for the embedded Distribute form — same shape the
  // standalone ccpc-inventory app's own Distribute page reads directly from
  // Supabase; here it's proxied through _invReq since this app has no direct
  // DB access into the inventory schema.
  async getConsumerOptions() {
    const [consumers, committees, assignments] = await Promise.all([
      _invReq(`consumers?select=id,name,type,reference_id&order=name.asc`),
      _invReq(`committees?select=id,name,chairman_user_id&order=name.asc`),
      _invReq(`distributor_assignments?select=assignee_user_id,holder_type,holder_id`),
    ]);
    return {
      consumers: Array.isArray(consumers) ? consumers : [],
      committees: Array.isArray(committees) ? committees : [],
      assignments: Array.isArray(assignments) ? assignments : [],
    };
  },

  // Second-hop transfer: userId distributes from something they hold — either
  // their own received stock, or stock held by a room/building/committee
  // they're an assigned distributor for. Validates the live balance
  // server-side (never trusts a client-sent quantity) before moving anything.
  async createDistribution([userId, fromHolderType, fromHolderId, productId, toConsumerId, quantity, remarks]) {
    if (!userId) return { result: 'error', message: 'Not authorized.' };
    const qty = Number(quantity);
    if (!productId || !toConsumerId || !qty || qty <= 0) {
      return { result: 'error', message: 'Product, recipient, and a positive quantity are required.' };
    }

    let fromConsumerId;
    if (!fromHolderType || fromHolderType === 'self') {
      const own = await _invReq(`consumers?reference_id=eq.${encodeURIComponent(userId)}&type=in.(teacher,staff)&select=id`);
      if (!Array.isArray(own) || !own.length) return { result: 'error', message: 'No inventory record found for you.' };
      fromConsumerId = own[0].id;
    } else {
      const assigned = await _invReq(
        `distributor_assignments?assignee_user_id=eq.${encodeURIComponent(userId)}&holder_type=eq.${fromHolderType}&holder_id=eq.${fromHolderId}&select=id&limit=1`
      );
      if (!Array.isArray(assigned) || !assigned.length) return { result: 'error', message: 'You are not an assigned distributor for that holder.' };
      const consumerRows = await _invReq(`consumers?type=eq.${fromHolderType}&reference_id=eq.${encodeURIComponent(String(fromHolderId))}&select=id`);
      if (!Array.isArray(consumerRows) || !consumerRows.length) return { result: 'error', message: 'That holder has no inventory record yet.' };
      fromConsumerId = consumerRows[0].id;
    }

    const stockRows = await _invReq(`holder_stock?consumer_id=eq.${fromConsumerId}&product_id=eq.${productId}&select=*`);
    const stock = Array.isArray(stockRows) && stockRows[0];
    const available = Number(stock?.quantity || 0);
    if (available < qty) return { result: 'error', message: `Only ${available} on hand — cannot distribute ${qty}.` };

    const toConsumerRows = await _invReq(`consumers?id=eq.${toConsumerId}&select=*`);
    const toConsumer = Array.isArray(toConsumerRows) && toConsumerRows[0];
    if (!toConsumer) return { result: 'error', message: 'Recipient not found.' };
    const receiverUserId = await _invResolveReceiver(toConsumer);
    const productRows = await _invReq(`products?id=eq.${productId}&select=name`);
    const productName = (Array.isArray(productRows) && productRows[0]?.name) || 'item';

    const distribution = await _invReq('distributions', 'POST', {
      distribute_no: `DIST-${Date.now()}`,
      consumer_id: toConsumerId,
      from_consumer_id: fromConsumerId,
      receiver_user_id: receiverUserId,
      remarks: remarks || (toConsumer.type === 'committee' ? `Committee: ${toConsumer.name}` : null),
    });
    if (distribution?.error) return { result: 'error', message: distribution.error };
    const distributionId = distribution[0].id;

    await _invReq('distribution_items', 'POST', { distribution_id: distributionId, product_id: productId, quantity: qty });
    await _invReq(`holder_stock?id=eq.${stock.id}`, 'PATCH', { quantity: available - qty, updated_at: new Date().toISOString() });

    const toExisting = await _invReq(`holder_stock?consumer_id=eq.${toConsumerId}&product_id=eq.${productId}&select=*`);
    if (Array.isArray(toExisting) && toExisting.length) {
      await _invReq(`holder_stock?id=eq.${toExisting[0].id}`, 'PATCH', { quantity: Number(toExisting[0].quantity) + qty, updated_at: new Date().toISOString() });
    } else {
      await _invReq('holder_stock', 'POST', { consumer_id: toConsumerId, product_id: productId, quantity: qty });
    }

    // Both sides get notified here (unlike ccpc-inventory's anonymous admin
    // tool, the granter is a real identified user in this flow).
    await _invReq('inventory_notifications', 'POST', {
      user_id: userId,
      message: `You distributed ${qty} × ${productName} to ${toConsumer.name}.`,
      distribution_id: distributionId,
    });
    if (receiverUserId && receiverUserId !== userId) {
      await _invReq('inventory_notifications', 'POST', {
        user_id: receiverUserId,
        message: `You received ${qty} × ${productName}${toConsumer.type === 'committee' ? ` on behalf of ${toConsumer.name}` : ''}.`,
        distribution_id: distributionId,
      });
    }

    return { result: 'success', distribution_id: distributionId };
  },

  async getMyNotifications([userId]) {
    if (!userId) return { rows: [] };
    const rows = await _invReq(`inventory_notifications?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=30`);
    return { rows: Array.isArray(rows) ? rows : [] };
  },

  async markNotificationRead([id]) {
    if (!id) return { result: 'error' };
    const r = await _invReq(`inventory_notifications?id=eq.${id}`, 'PATCH', { is_read: true });
    return { result: r?.error ? 'error' : 'success' };
  },

  // ── LEGACY COMPAT ─────────────────────────────────────────────────────────────
  // getInitialDashboardData was used by old shim before role-specific views were added

  async getInitialDashboardData([role, userEmail]) {
    if (['Teacher', 'Staff'].includes(role)) {
      return { html: null, initialData: await handlers.getMyProfile([userEmail]) };
    }
    return {
      html: null,
      initialData: await handlers.getAllStaffData([role === 'Principal' || role === 'VP', true])
    };
  }
};

// ─── Route entry point ────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { fn, args } = await request.json();
    const handler = handlers[fn];
    if (!handler) {
      return NextResponse.json({ error: `Unknown function: ${fn}` }, { status: 400 });
    }
    const result = await handler(args || []);
    return NextResponse.json(result ?? null);
  } catch (err) {
    console.error('[api/exec]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
