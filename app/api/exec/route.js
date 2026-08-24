import { NextResponse } from 'next/server';
import { supabaseRequest, castToArray, supabaseStorageUpload, supabaseStoragePublicUrl, supabaseStorageRemove, supabaseCreateSignedUploadUrl } from '@/lib/supabase';

// A full-day routine reseed (runDailyRoutineSetup) can legitimately take a
// few minutes on the external Apps Script side — this raises the platform's
// own kill switch to accommodate that. 60s is the highest value that's
// guaranteed to work on every Vercel plan (Hobby's hard ceiling); even that
// isn't always enough, which is why runDailyRoutineSetup below aborts its
// own upstream call well before this fires and reports "still working"
// instead of erroring — see _callRoutineGas's timedOut handling.
export const maxDuration = 60;

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

// Mirrors exactly the scalar `name="..."` fields present in each edit-form
// tab of _src/views/TeacherView.html (Personal/Education/Career/Family/
// Financial/Travel) — same set updateProfileProgress() counts client-side
// for the owner's own completion bar, kept here as a plain list since the
// server has no DOM to introspect. Dynamic child-table rows (siblings,
// children, education records, etc.) intentionally don't count toward this
// — same as the client-side version, which only counts non-array inputs.
// Spouse fields live in the spouse_details child table, not on
// users_profile itself, so they're checked separately in
// _computeProfileCompletion below via SPOUSE_FIELD_MAP.
const PROFILE_COMPLETION_SCALAR_FIELDS = [
  'teacher_id', 'joining_date', 'full_name', 'name_bengali', 'designation', 'category', 'school_college',
  'national_id', 'auth_ref', 'date_of_birth', 'place_of_birth', 'birth_certificate_no', 'height_feet',
  'height_inches', 'weight_kg', 'blood_group', 'identification_marks', 'religion', 'caste', 'nationality',
  'mobile', 'tt_phone', 'personal_email', 'permanent_address', 'present_address', 'alternate_address',
  'additional_qualification',
  'institution_law_breaking', 'civil_law_breaking',
  'father_name', 'father_nationality', 'father_prev_nationality', 'father_present_age', 'father_date_of_decease',
  'father_occupation', 'father_annual_income', 'father_citizenship_auth', 'mother_name', 'mother_nationality',
  'mother_prev_nationality', 'mother_present_age', 'mother_date_of_decease', 'mother_occupation', 'mother_citizenship_auth',
  'position_in_siblings', 'marital_status', 'marriage_divorce_date', 'marriage_authority',
  'tid_bin_no', 'own_income',
  'passport_number', 'passport_type', 'passport_date_issue', 'passport_place_issue', 'passport_date_expiry', 'passport_issuing_auth',
];
// [form field name, spouse_details column name]
const SPOUSE_FIELD_MAP = [
  ['spouse_name_en', 'name_english'], ['spouse_name_bn', 'name_bengali'], ['spouse_dob', 'date_of_birth'],
  ['spouse_pob', 'place_of_birth'], ['spouse_birth_reg', 'birth_reg_number'], ['spouse_nid', 'national_id'],
  ['spouse_nationality', 'nationality'], ['spouse_prev_nationality', 'prev_nationality'],
  ['spouse_education', 'educational_qualification'], ['spouse_tid_bin', 'tid_bin_no'],
  ['spouse_occupation', 'occupation'], ['spouse_occ_designation', 'occupation_designation'],
  ['spouse_occ_address', 'occupation_address'], ['spouse_prev_occupation', 'previous_occupation'],
  ['spouse_citizenship_auth', 'citizenship_auth'],
];
function _isFilled(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }
function _computeProfileCompletion(row) {
  if (!row) return 0;
  let total = 0, filled = 0;
  PROFILE_COMPLETION_SCALAR_FIELDS.forEach(f => { total++; if (_isFilled(row[f])) filled++; });
  const sp = (Array.isArray(row.spouse_details) && row.spouse_details[0]) || {};
  SPOUSE_FIELD_MAP.forEach(([, col]) => { total++; if (_isFilled(sp[col])) filled++; });
  return total ? Math.round((filled / total) * 100) : 0;
}

// Fallback used by getColleagueProfile when no admin override has been
// saved yet (system_settings key "profile_public_fields") — a reasonable,
// low-sensitivity starting point (contact/work info + education), leaving
// national ID, address, family, financial, and medical fields hidden from
// non-privileged viewers until an admin explicitly opts them in via the
// System > Profile Privacy panel.
const PROFILE_PUBLIC_FIELDS_DEFAULT = [
  'name_bengali', 'designation', 'category', 'school_college', 'joining_date',
  'personal_email', 'mobile', 'tt_phone', 'additional_qualification', 'education_records',
];

// Who sees a colleague's full personnel record when viewing their card.
const PRIVILEGED_ROLES = ['HR', 'VP', 'Admin', 'Principal', 'Cord'];
// Who may EDIT another teacher's Career tab fields (institution/civil
// law-breaking notes) — deliberately never includes the record's own
// owner, even if they hold one of these roles themselves: see
// saveColleagueCareer, which also hard-blocks self-edits server-side.
const CAREER_EDIT_ROLES = ['HR', 'VP', 'Principal', 'Cord', 'Admin'];
const CAREER_FIELDS = ['institution_law_breaking', 'civil_law_breaking'];
const DIARY_ENTRY_TYPES = ['discipline', 'compliment', 'wish', 'homework'];
const DIARY_LABELS = { discipline: 'Discipline Report', compliment: 'Compliment / Good Report', wish: 'Wish / Greeting', homework: 'Homework / To-do' };

// Field Category row_filter check (student.field_access_grants.row_filter,
// { column: [values] }, AND across columns, IN within each) — local copy
// of student-admin/route.js's _rowMatchesFilter, used by getTabDataForUser
// below to live-evaluate a tab's linked-category access; same cross-route
// duplication convention already used for the CSV/sheet helpers in this file.
function _matchesRowFilter(student, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([col, vals]) => {
    if (!Array.isArray(vals) || !vals.length) return true;
    const rawVal = col === 'group' ? (student.group || 'None') : student[col];
    return vals.includes(String(rawVal ?? '').trim());
  });
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
//
// The institution actually runs three divisions — School, College, Honours —
// each with its own spreadsheet + Apps Script deployment. These two constants
// are now only the fallback for the "school" section when an Admin hasn't
// configured anything yet in System > Routine Settings (see
// _getRoutineSectionConfig below, and routine_section_config in
// system_settings). Never referenced directly anywhere else in this file.
const ROUTINE_SHEET_ID = '11l3oc1mpbR8UerpDxCatzuhcBNqkbdNzWzOTiPPdKgk';
const ROUTINE_GAS_URL  = 'https://script.google.com/macros/s/AKfycbyLXrJdZTvPrGYzt9fhBYa3IEUx5G5MrpyqBraVJR4RrDu0FFukdI8u7PupakA5an5AKA/exec';
const ROUTINE_SECTIONS = ['school', 'college', 'honours'];
const PERIOD_LABELS = ['1st','2nd','3rd','4th/junior tiffin','4th/senior tiffin','5th','6th','7th'];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Accepts whatever an Admin pastes into a Routine Settings address field — a
// full "https://docs.google.com/spreadsheets/d/{ID}/edit?gid={GID}" link, a
// link without a gid, or a bare spreadsheet ID — and extracts {sheetId, gid}.
// Storing only the raw pasted string (not separate ID/gid fields) means
// there's nothing to keep in sync; this is the single place that ever parses it.
function _parseSheetUrlOrId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const idMatch = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = s.match(/[#&?]gid=(\d+)/);
  return { sheetId: idMatch ? idMatch[1] : s, gid: gidMatch ? gidMatch[1] : null };
}

// Resolves one section's {routineSheetId, gasUrl, archiveSheetId, archiveGid}
// from system_settings' routine_section_config, falling back to the original
// hardcoded school sheet/GAS URL for 'school' when nothing has been
// configured yet (so this ships without breaking the one section already in
// live use). College/Honours have no such fallback — an unconfigured section
// returns nulls, and callers show a "not set up yet" state instead of erroring.
async function _getRoutineSectionConfig(sectionKey) {
  const key = ROUTINE_SECTIONS.includes(sectionKey) ? sectionKey : 'school';
  const settingsRows = await supabaseRequest('system_settings?key=eq.routine_section_config');
  const cfg = (Array.isArray(settingsRows) && settingsRows[0] && settingsRows[0].value) || {};
  const section = cfg[key] || {};
  const routine = _parseSheetUrlOrId(section.routineSheetUrl) || (key === 'school' ? { sheetId: ROUTINE_SHEET_ID, gid: null } : null);
  const archive = _parseSheetUrlOrId(section.archiveSheetUrl);
  const gasUrl = section.gasUrl || (key === 'school' ? ROUTINE_GAS_URL : '');
  return {
    routineSheetId: routine ? routine.sheetId : null,
    gasUrl: gasUrl || null,
    archiveSheetId: archive ? archive.sheetId : null,
    archiveGid: archive ? archive.gid : null,
  };
}

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

// Manual per-student overrides a class teacher can apply on top of the
// ESP32-device-derived present/absent baseline (see getMyClassTodayAttendance).
const MY_CLASS_ATTENDANCE_STATUSES = new Set(['present', 'absent', 'late', 'missing', 'late_absent', 'leave']);

// Authorization gate for the per-student attendance-marking endpoints below:
// re-derives the caller's own class-teacher assignments (never trusts a
// class from the client) and confirms the target student actually sits in
// one of them, so a teacher can only ever mark their own students.
async function _isCallerStudentAuthorized(userId, studentId) {
  const assignments = await _getClassTeacherAssignments();
  const mine = assignments.filter(a => a.resolvedUserId === userId);
  for (const { className, section, extraCriteria } of mine) {
    const studentClass = CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className;
    const studentSection = CLASS_TEACHER_SECTION_ALIASES[section] || section;
    const rows = await _sbStudent(
      `students_data?student_id=eq.${encodeURIComponent(studentId)}&class=eq.${encodeURIComponent(studentClass)}&section=eq.${encodeURIComponent(studentSection)}${_extraCriteriaQS(extraCriteria)}&select=student_id`
    );
    if (Array.isArray(rows) && rows.length) return true;
  }
  return false;
}

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
// `selector` is { name } to pick a tab by name (every routine/adjustment tab)
// or { gid } to pick it by tab id (the archive tab, which may live in a
// wholly different spreadsheet than the section's main routine sheet).
async function _fetchSheetRows(sheetId, selector) {
  const tabParam = selector && selector.gid != null
    ? `gid=${encodeURIComponent(selector.gid)}`
    : `sheet=${encodeURIComponent((selector && selector.name) || '')}`;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&${tabParam}&_=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read sheet (HTTP ${res.status})`);
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

// Exact row count for a filtered query, without fetching the rows
// themselves — supabaseRequest() only ever returns the parsed body, so this
// does its own minimal fetch (Range: 0-0, just one row) with
// Prefer: count=exact and reads the total off the Content-Range response
// header (PostgREST's format: "0-0/1234"). Used so a capped/paginated list
// (e.g. Lesson Plan's 500-row cap) can still show "Showing 500 of 1234"
// instead of silently pretending 500 is everything.
async function _countRows(path) {
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Accept-Profile': 'teacher_staff',
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    const range = res.headers.get('content-range'); // "0-0/1234"
    const total = range && range.includes('/') ? Number(range.split('/')[1]) : null;
    return Number.isFinite(total) ? total : null;
  } catch (e) { return null; }
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

// PostgREST silently caps ANY select at this project's configured max_rows
// (3000) with no explicit Range header — confirmed live: students_data has
// 3913 rows, so a plain unbounded _sbStudent() fetch against it only ever
// returns 3000 of them (whichever happened to come back first, no
// guaranteed order), silently missing entire classes' worth of students.
// Paginates with Range instead of trusting one request for a table that
// can legitimately exceed that cap.
async function _sbStudentAllRows(path) {
  const PAGE = 3000;
  let all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Accept-Profile': 'student',
        Range: `${offset}-${offset + PAGE - 1}`,
      },
    });
    if (!res.ok) return [];
    const page = await res.json();
    if (!Array.isArray(page)) return all;
    all = all.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// Single-round-trip upsert — path must include `?on_conflict=<cols>`.
// Cuts the check-then-PATCH-or-POST pattern used elsewhere down to one
// request, which matters for the My Students toggle: that round trip
// happens on every single tap, so shaving it to one call (plus the
// authorization check) is the difference between "instant" and "laggy".
async function _sbStudentUpsert(path, payload) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'student',
      'Content-Profile': 'student',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (res.status >= 400) return { error: 'Supabase Error', details: text, status: res.status };
  return text ? JSON.parse(text) : null;
}

// Write counterpart to _sbStudent (GET-only above) — needed by
// applyClassTeacherSync below, the only exec/route.js handler that writes
// into the `student` schema directly rather than through student-admin/route.js.
async function _sbStudentWrite(path, method, payload) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'student',
      'Content-Profile': 'student',
      Prefer: 'return=representation',
    },
    body: payload != null ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  if (res.status >= 400) return { error: 'Supabase Error', details: text, status: res.status };
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: 'Parse Error', details: text }; }
}

// Resolves every row of the class-teacher sheet to a real ccpc-teachers
// user_id: try the sheet's own ID column first (most rows are "#N/A" in
// practice), then fall back to the same shortname→full_name→teacher_id chain
// _resolveUserIdsByShortnames already uses for the unrelated routine feature
// (the two sheets share the same shortname vocabulary, confirmed against the
// "Logged in info" tab). Free-standing (not a `handlers` property) since it's
// an internal building block only the validated handlers below should call.
async function _getClassTeacherAssignments() {
  const [sheetRows, profiles, directory, dbAssignments] = await Promise.all([
    // Best-effort — the sheet stays authoritative when reachable, but a
    // sheet outage should never take down the DB-backed fallback below too.
    _fetchCsvByGid(CLASS_TEACHER_SHEET_ID, CLASS_TEACHER_SHEET_GID).catch(() => []),
    supabaseRequest('users_profile?select=teacher_id,full_name'),
    // Class-teacher assignment has no section concept of its own — pinned to
    // 'school' (the only section with a hardcoded fallback if unconfigured)
    // rather than adding section-awareness to an unrelated feature.
    handlers.getRoutineDirectory(['school']),
    // Admin-assignable fallback (student.class_teacher_assignments, managed
    // from the "Assign Class Teacher" admin view) — only ever fills in for a
    // class/section the sheet itself couldn't resolve a user for, never
    // overrides a real sheet match. Keyed in the student DB's own class/
    // section spelling (e.g. "Six"/"A"), not the sheet's internal codes.
    // extra_criteria narrows a combo beyond class+section (e.g.
    // {"session":"2026"} or {"group":"Science"}) — one class+section can
    // have several rows here, each scoped to a different teacher, whenever
    // the sheet's single-teacher-per-section model doesn't fit (overlapping
    // cohorts sharing a class+section, group-split sections, etc).
    _sbStudent('class_teacher_assignments?select=class,section,user_id,extra_criteria'),
  ]);

  const dbRows = Array.isArray(dbAssignments) ? dbAssignments : [];
  const isPlainCombo = (ec) => !ec || typeof ec !== 'object' || Array.isArray(ec) || !Object.keys(ec).length;
  // Only a PLAIN (no extra_criteria) DB row can silently fill in for a sheet
  // row the sheet itself couldn't resolve a teacher for — a scoped combo
  // (session/group-specific) has no equivalent single-teacher meaning at
  // the sheet-row level, so it's never used for this particular fallback.
  const plainDbByKey = new Map();
  dbRows.forEach(r => { if (isPlainCombo(r.extra_criteria)) plainDbByKey.set(`${r.class}||${r.section}`, r.user_id); });
  // A class+section with ANY scoped DB row means an admin deliberately split
  // its teaching by some criterion (overlapping cohorts sharing a section,
  // a group-split section, etc) — the sheet's own flat single-teacher
  // resolution for that EXACT combo must be suppressed entirely below, even
  // a real id/shortname match, or that unscoped roster gets unioned back
  // in with the scoped one and silently erases the narrowing (confirmed
  // live: this was still pulling in students from the wrong session).
  const scopedSectionKeys = new Set(dbRows.filter(r => !isPlainCombo(r.extra_criteria)).map(r => `${r.class}||${r.section}`));
  const consumedPlainKeys = new Set();

  const header = sheetRows[0] || [];
  const classesIdx = header.findIndex(h => String(h).trim() === 'Classes'); // first occurrence
  const idIdx       = header.findIndex(h => String(h).trim() === 'ID');
  const snIdx        = header.findIndex(h => String(h).trim() === 'Sort Names');
  const classIdx     = header.findIndex(h => String(h).trim() === 'Class');   // second table's split column
  const sectionIdx   = header.findIndex(h => String(h).trim() === 'Section');

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
  const seenKeys = new Set();
  if (classesIdx >= 0) {
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

      const className = classIdx >= 0 ? String(row[classIdx] || '').trim() : '';
      const section = sectionIdx >= 0 ? String(row[sectionIdx] || '').trim() : '';
      const dbKey = `${CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className}||${CLASS_TEACHER_SECTION_ALIASES[section] || section}`;
      seenKeys.add(dbKey);
      if (scopedSectionKeys.has(dbKey)) {
        // Deliberately split by the DB's scoped combos — never let even a
        // real id/shortname sheet match stand in for "the whole section."
        resolvedUserId = null; resolvedVia = null;
      } else if (!resolvedUserId && plainDbByKey.has(dbKey)) {
        resolvedUserId = plainDbByKey.get(dbKey); resolvedVia = 'db';
        consumedPlainKeys.add(dbKey);
      }

      out.push({ classKey, className, section, resolvedUserId, resolvedVia, extraCriteria: {} });
    }
  }

  // Every DB row not already surfaced above gets its own entry: any SCOPED
  // (non-plain) combo always does, since the sheet has no way to represent
  // those at all — plus any plain combo for a class/section the sheet never
  // listed, or didn't consume as a gap-fill above. className/section here
  // are already in the student DB's own spelling, so the
  // CLASS_TEACHER_NAME_TO_STUDENT_CLASS/SECTION_ALIASES lookups downstream
  // (keyed by the sheet's internal codes) pass them through unchanged.
  dbRows.forEach(r => {
    const key = `${r.class}||${r.section}`;
    const plain = isPlainCombo(r.extra_criteria);
    if (plain && (seenKeys.has(key) || consumedPlainKeys.has(key))) return;
    out.push({
      classKey: `${r.class} ${r.section}`,
      className: r.class,
      section: r.section,
      resolvedUserId: r.user_id,
      resolvedVia: 'db',
      extraCriteria: plain ? {} : r.extra_criteria,
    });
  });

  return out;
}

// Turns a class-teacher assignment's extra_criteria ({"session":"2026"} etc)
// into an additional PostgREST exact-match querystring suffix — shared by
// every roster query below so a scoped combo actually narrows who's in it,
// instead of the extra_criteria being resolved and then silently dropped.
function _extraCriteriaQS(extraCriteria) {
  return Object.entries(extraCriteria || {})
    .map(([k, v]) => `&${encodeURIComponent(k)}=eq.${encodeURIComponent(v)}`)
    .join('');
}

async function _callRoutineGas(gasUrl, params, timeoutMs = 20000) {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${gasUrl}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError'
    // — distinguished from a real HTTP-level failure so a caller that can
    // tolerate a slow-but-still-running script (runDailyRoutineSetup) can
    // report "still working" instead of a hard failure. The Apps Script
    // execution itself isn't stopped by us giving up on the HTTP response —
    // it keeps running on Google's side regardless.
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, status: 0, text: timedOut ? '' : String((e && e.message) || e), timedOut };
  }
}

async function _isCordOrAdmin(callerId) {
  if (!callerId) return false;
  const users = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerId)}&select=role`);
  const role = Array.isArray(users) && users[0] ? users[0].role : '';
  const roles = String(role || '').split(',').map(r => r.trim());
  return roles.some(r => ['Cord', 'Admin'].includes(r));
}

// ── FORUM helpers ────────────────────────────────────────────────────────
// Shared by the human-post RPCs below and by the system-post hooks inside
// saveLessonPlan/bulkImportLessonPlans further down this file.

// Every signed-in user is a forum recipient for a broadcast post — reuses
// the same app_users source the committee-closed notification fan-out uses
// (route.js ~1594) rather than introducing a separate "all staff" query.
async function _forumAllUserIds() {
  const users = await supabaseRequest('app_users?select=user_id');
  return (Array.isArray(users) ? users : []).map(u => u.user_id).filter(Boolean);
}

async function _forumNotify(recipientIds, notif) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length) return;
  const rows = ids.map(uid => ({
    user_id: uid, type: notif.type, title: notif.title, message: notif.message,
    data: notif.data || {}, is_read: false, created_at: new Date().toISOString(),
  }));
  await supabaseRequest('notifications', 'post', rows);
}

// System posts (auto-generated when a lesson plan is created/imported/
// exported) are attributed to the real teacher who triggered them
// (is_system:true styles them distinctly client-side) but deliberately
// never call _forumNotify — the whole point is a quiet audit-trail post,
// not another notification for everyone to dismiss.
async function _createSystemForumPost(callerId, body, meta) {
  if (!callerId || !body) return;
  try {
    await supabaseRequest('forum_posts', 'post', {
      author_id: callerId, post_type: 'system', body,
      photo_urls: [], tagged_user_ids: [], is_system: true,
      is_pinned: false, section: 'system', data: meta || {},
      last_activity_at: new Date().toISOString(), created_at: new Date().toISOString(),
    });
  } catch (e) { /* best-effort — a failed system post must never fail the caller's real action */ }
}

// Pin permission is deliberately broader than _isCordOrAdmin (delete/edit
// gate elsewhere in Forum) — Admin/VP/Cord can highlight a post, but that
// doesn't imply they can delete someone else's content.
async function _isForumModerator(callerId) {
  if (!callerId) return false;
  const users = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerId)}&select=role`);
  const role = Array.isArray(users) && users[0] ? users[0].role : '';
  const roles = String(role || '').split(',').map(r => r.trim());
  return roles.some(r => ['Admin', 'VP', 'Cord'].includes(r));
}

// A section='student' post is visible to: Admin/VP/Cord (see everything),
// the post's own author, or a class teacher whose class_teacher_assignments
// row matches the post's targeted class (and section, when the audience is
// narrowed to one). class_teacher_assignments columns confirmed at the
// existing get_class_teacher_assignments handler: class, section,
// extra_criteria, user_id.
async function _forumFilterStudentVisible(callerId, posts) {
  const studentPosts = posts.filter(p => p.section === 'student');
  if (!studentPosts.length) return posts;
  if (await _isForumModerator(callerId)) return posts;
  const assignments = await supabaseRequest(`class_teacher_assignments?user_id=eq.${encodeURIComponent(callerId)}&select=class,section`);
  const myAssignments = Array.isArray(assignments) ? assignments : [];
  const ownsClass = (cls, sec) => myAssignments.some(a =>
    a.class === cls && (!sec || !a.section || a.section === sec));
  return posts.filter(p => {
    if (p.section !== 'student') return true;
    if (p.author_id === callerId) return true;
    const aud = p.audience || {};
    return !!aud.class && ownsClass(aud.class, aud.section);
  });
}

function _forumLessonPlanSummary(row) {
  const cls = row.class_name || '?', subj = row.subject || '?';
  const chapter = row.chapter || (Array.isArray(row.lesson_refs) && row.lesson_refs[0] && row.lesson_refs[0].chapter) || '';
  return chapter ? `${cls} · ${subj} — ${chapter}` : `${cls} · ${subj}`;
}

// Stricter than _isCordOrAdmin above — API keys are more sensitive than the
// things Cord is normally trusted with, so this gates AI provider setup to
// the top Admin role only, matching the client's adminOnly = role==='Admin'
// gate on the Module Access / Profile Fields / Routine Settings panels.
async function _isAdmin(callerId) {
  if (!callerId) return false;
  const users = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerId)}&select=role`);
  const role = Array.isArray(users) && users[0] ? users[0].role : '';
  return String(role || '').split(',').map(r => r.trim()).includes('Admin');
}

// ── AI lesson-plan draft generation ─────────────────────────────────────────
// Pluggable across providers so adding a new one later is just: write one
// _callXxx function below, add its entry to AI_PROVIDERS/AI_PROVIDER_FN, add
// its API key — the Super Admin dropdown and the client's "Generate" button
// don't need to change. API keys are never returned to the client: they're
// stored in system_settings under a key ('ai_provider_keys') that only the
// handlers below ever read, separate from ai_model_settings (the active
// model + enabled list, which IS safe to return — no secret material in it).
// A provider's key can also come from an env var as a zero-UI-setup fallback
// (checked only if nothing's stored in the DB for that provider).
const AI_PROVIDERS = {
  'claude-haiku': { label: 'Claude Haiku', envKey: 'ANTHROPIC_API_KEY' },
  'gemini-flash': { label: 'Gemini Flash', envKey: 'GOOGLE_AI_API_KEY' },
  'gpt-4o-mini':  { label: 'GPT-4o Mini',  envKey: 'OPENAI_API_KEY' },
};

async function _getAiProviderKeys() {
  const rows = await supabaseRequest(`system_settings?key=eq.ai_provider_keys&select=value`);
  return (Array.isArray(rows) && rows[0] && rows[0].value) || {};
}

async function _getAiProviderKey(provider) {
  const stored = await _getAiProviderKeys();
  const meta = AI_PROVIDERS[provider];
  return (stored && stored[provider]) || (meta && process.env[meta.envKey]) || null;
}

function _lessonPlanDraftPrompt(ctx) {
  const c = ctx || {};
  const reference = [
    c.book_url ? `Official textbook: ${c.book_url}` : '',
    c.page_number ? `Page(s) covered by this lesson: ${c.page_number}` : '',
  ].filter(Boolean).join('\n');
  return `You are helping a Bangladeshi school teacher draft a lesson plan in the Bloom's Taxonomy + 5E Model format used by NCTB schools.
Class: ${c.class_name || ''}
Subject: ${c.subject || ''}
Chapter: ${c.chapter || ''}
Topic: ${c.topic || '(not given — infer a reasonable topic for this chapter)'}
${c.learning_outcomes ? `Existing learning outcomes to build on: ${c.learning_outcomes}` : ''}
${reference ? `\n${reference}\nUse the textbook and page(s) above as the precise source — align content, terminology, and (for Math/Physics/Chemistry) exact equations to what's actually on those pages rather than inventing generic content.` : ''}
${c.elaborate_summary ? `\nTeacher's Guide content for this lesson (pedagogical approach, activities, examples used — treat as ground truth, not a suggestion):\n${c.elaborate_summary}` : ''}
${c.textbook_context ? `\nStudent textbook page content for this lesson (the exact examples, numbers, exercises, and images printed on the referenced page(s) — treat as ground truth, not a suggestion):\n${c.textbook_context}` : ''}

If — and only if — you are confident you know a real, specific, well-established educational YouTube video genuinely relevant to this exact topic (e.g. from a well-known educational channel), include its full URL as "youtube_video_url". The teacher will see an embedded preview of whatever URL you give before deciding to attach it, so a wrong or fabricated link is not harmful — it will simply fail to preview and get ignored — but do not put effort into guessing when you have no real candidate in mind; use null in that case rather than inventing a plausible-looking URL.

Return ONLY valid JSON, no markdown fencing, no commentary, in exactly this shape:
{
  "topic": "string",
  "learning_outcomes": "string",
  "teaching_aids": "string",
  "method": "string",
  "youtube_video_url": "string or null",
  "phases": [
    {"phase": "Greetings", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Engagement", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Exploration", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Explanation and Elaboration", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Evaluation", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Summarization", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Assignment/Homework", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number},
    {"phase": "Closing", "teacher_activity": "string", "learner_activity": "string", "duration_minutes": number}
  ]
}`;
}

// ── Non-AI translation (free Google Translate web endpoint, no API key) ───
// Used by the Lesson Plan import's auto-translate flow — deliberately NOT
// routed through this app's Admin-configured AI providers above, since that
// requires an Admin to have set up a key and costs per call. This is plain
// machine translation (same engine translate.google.com's web UI itself
// calls), field-by-field, with a small concurrency cap so a chapter-sized
// batch (~8 lessons) doesn't hammer the endpoint or the request all at once.

async function _googleTranslateOne(text, targetLangCode) {
  const s = String(text || '').trim();
  if (!s) return '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLangCode)}&dt=t&q=${encodeURIComponent(s)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Translate request failed (' + res.status + ')');
  const data = await res.json();
  return Array.isArray(data) && Array.isArray(data[0]) ? data[0].map(seg => seg[0]).join('') : s;
}

// Runs `fn` over `items` with at most `limit` in flight at once — a minimal
// concurrency pool since no queue/throttle library is otherwise used in
// this codebase, just enough to avoid firing 100+ requests simultaneously.
async function _mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Which text fields actually get translated on a lesson object — chapter/
// topic/teaching_aids/method/learning_outcomes plus every phase's
// teacher_activity/learner_activity. Deliberately excludes class_name and
// subject (this app's existing convention keeps those in English even on
// Bangla-medium rows — "Six" / "Science" — only the content changes
// language) and the phase "name" itself (Greetings/Engagement/etc. stay
// fixed English keys the rest of the app matches against by exact string).
function _translatableFieldPaths(item) {
  const paths = ['chapter', 'topic', 'teaching_aids', 'method', 'learning_outcomes'];
  const phases = Array.isArray(item.phases) ? item.phases : [];
  const phasePaths = [];
  phases.forEach((_, i) => { phasePaths.push(`phases.${i}.teacher_activity`, `phases.${i}.learner_activity`); });
  return [...paths, ...phasePaths];
}

function _getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function _setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

async function _logAiGeneration(userId, model, ctx, success, errorMessage) {
  try {
    await supabaseRequest('ai_generation_log', 'post', [{
      user_id: userId || null, model: model || null,
      class_name: ctx.class_name || null, subject: ctx.subject || null,
      chapter: ctx.chapter || null, version: ctx.version || null,
      success: !!success, error_message: errorMessage || null,
    }]);
  } catch (_) { /* logging failures must never block generation */ }
}

function _parseAiJson(text) {
  const cleaned = String(text || '').replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

async function _callClaudeHaiku(apiKey, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Claude request failed');
  return data.content[0].text;
}

async function _callGeminiFlash(apiKey, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'Gemini request failed');
  return data.candidates[0].content.parts[0].text;
}

async function _callGpt4oMini(apiKey, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || 'OpenAI request failed');
  return data.choices[0].message.content;
}

const AI_PROVIDER_FN = {
  'claude-haiku': _callClaudeHaiku,
  'gemini-flash': _callGeminiFlash,
  'gpt-4o-mini': _callGpt4oMini,
};

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
    // Class-teacher assignment has no section concept of its own — pinned to
    // 'school' (the only section with a hardcoded fallback if unconfigured)
    // rather than adding section-awareness to an unrelated feature.
    handlers.getRoutineDirectory(['school']),
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
    // Only real app_users columns go here — data may also carry
    // users_profile-only fields (full_name, category, department, ...)
    // from the fuller admin "Add Staff" form, which must never be spread
    // blindly into this table (PGRST204: column not found).
    const userRow = { user_id: data.user_id, email: cleanEmail, password: data.password, role: data.role };
    if (data.phone) userRow.phone = data.phone;
    const userRes = await supabaseRequest('app_users?on_conflict=user_id', 'post', userRow);
    if (userRes && userRes.error) throw new Error(userRes.details || 'Failed to create user');
    const roleTokens = (data.role || '').split(',').map(r => r.trim());
    const profileCategory = roleTokens.find(r => r === 'Teacher' || r === 'Staff');
    if (profileCategory || data.full_name || data.category || data.department || data.designation || data.joining_date) {
      await supabaseRequest('users_profile?on_conflict=teacher_id', 'post', {
        teacher_id: data.user_id,
        email: cleanEmail,
        category: data.category || profileCategory || null,
        full_name: data.full_name || null,
        department: data.department || null,
        designation: data.designation || null,
        joining_date: data.joining_date || null,
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

  // How many rows in each linked table hold this exact user_id/teacher_id
  // today — shown to the admin as a confirmation popup before a rename, so
  // they know what's actually getting relinked (attendance history, leave
  // requests, family/education records, evaluation grants, etc.).
  async previewRenameTeacherIdImpact([oldUserId]) {
    const impact = await supabaseRequest('rpc/preview_rename_teacher_id_impact', 'post', { p_old_id: oldUserId });
    if (impact && impact.error) return { error: true, message: 'Could not check impact.' };
    return impact || {};
  },

  // Full edit of an EXISTING account — unlike saveAppUser (create-only,
  // upsert keyed on user_id), this can also rename the id itself (cascading
  // via teacher_staff.rename_teacher_id across every table that references it —
  // profile, payroll, leave, family/education records, evaluation grants,
  // ...) and checks the separate email-uniqueness constraint before writing,
  // neither of which the simple create path needs to worry about.
  async saveAppUserFull([oldUserId, data]) {
    const newUserId = String(data.user_id || '').trim();
    if (!newUserId) return { error: true, message: 'User ID is required.' };

    if (newUserId !== oldUserId) {
      const renameRes = await supabaseRequest('rpc/rename_teacher_id', 'post', { p_old_id: oldUserId, p_new_id: newUserId });
      if (renameRes && renameRes.error) {
        let msg = 'Could not change User ID.';
        try { const e = JSON.parse(renameRes.details); msg = e.code === '23505' ? `User ID "${newUserId}" is already in use.` : (e.message || msg); } catch {}
        return { error: true, message: msg };
      }
    }

    const cleanEmail = _sanitizeEmail(data.email, newUserId);
    if (cleanEmail) {
      const [dupUser, dupProfile] = await Promise.all([
        supabaseRequest(`app_users?email=eq.${encodeURIComponent(cleanEmail)}&user_id=neq.${encodeURIComponent(newUserId)}&select=user_id`),
        supabaseRequest(`users_profile?email=eq.${encodeURIComponent(cleanEmail)}&teacher_id=neq.${encodeURIComponent(newUserId)}&select=teacher_id`),
      ]);
      if (Array.isArray(dupUser) && dupUser.length) return { error: true, message: `Email "${cleanEmail}" is already used by another account (${dupUser[0].user_id}).` };
      if (Array.isArray(dupProfile) && dupProfile.length) return { error: true, message: `Email "${cleanEmail}" is already used by another profile (${dupProfile[0].teacher_id}).` };
    }

    const userPatch = { email: cleanEmail, phone: data.phone || null };
    if (data.role) userPatch.role = data.role;
    const userRes = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(newUserId)}`, 'patch', userPatch);
    if (userRes && userRes.error) return { error: true, message: userRes.details || 'Failed to update account.' };

    const roleTokens = (data.role || '').split(',').map(r => r.trim());
    const profileCategory = roleTokens.find(r => r === 'Teacher' || r === 'Staff');
    const profilePatch = {
      email: cleanEmail,
      full_name: data.full_name || null,
      category: data.category || profileCategory || null,
      department: data.department || null,
      designation: data.designation || null,
      joining_date: data.joining_date || null,
    };
    const existingProfile = await supabaseRequest(`users_profile?teacher_id=eq.${encodeURIComponent(newUserId)}&select=teacher_id`);
    if (Array.isArray(existingProfile) && existingProfile.length) {
      await supabaseRequest(`users_profile?teacher_id=eq.${encodeURIComponent(newUserId)}`, 'patch', profilePatch);
    } else {
      await supabaseRequest('users_profile?on_conflict=teacher_id', 'post', { teacher_id: newUserId, ...profilePatch });
    }

    return { success: true, user_id: newUserId };
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
    const auth = { success: true, user_id: user.user_id, role: rolesArr[0], roles: rolesArr, email: user.email, phone: user.phone || '' };

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
      'children_info(*)', 'education_records(*)'
    ].join(',');
    const res = await supabaseRequest(`users_profile?select=${sel}&teacher_id=eq.${teacherId}`);
    return (Array.isArray(res) && res.length > 0) ? res[0] : {};
  },

  // ── COLLEAGUE PROFILE VIEWER (Users Directory card click) ───────────────────
  // Any teacher/staff can view any colleague's profile card — but the depth
  // shown depends on the VIEWER's own role, enforced here server-side (never
  // trust a client-side toggle for data this sensitive): HR/VP/Admin/
  // Principal/Cord get the full personnel record, same as the owner's own
  // edit form; everyone else gets a curated, Facebook-style summary (photo,
  // designation, department, contact info, education highlights) with no
  // national ID, address, family, financial, or medical fields. Completion %
  // is always computed from the FULL record regardless of viewer privilege —
  // it's a property of the profile itself, not of what this viewer may see.
  async getColleagueProfile([viewerUserId, targetTeacherId]) {
    if (!viewerUserId || !targetTeacherId) return { error: 'Missing parameters.' };
    const viewerRows = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(viewerUserId)}&select=role`);
    const viewerRole = (Array.isArray(viewerRows) && viewerRows[0]) ? viewerRows[0].role : '';
    const viewerRoles = String(viewerRole || '').split(',').map(r => r.trim());
    const isSelf = viewerUserId === targetTeacherId;
    const isPrivilegedRole = viewerRoles.some(r => PRIVILEGED_ROLES.includes(r));
    const isPrivileged = isPrivilegedRole || isSelf;
    // Career fields are only ever editable for SOMEONE ELSE's record, by a
    // role in CAREER_EDIT_ROLES — never your own, regardless of role.
    const canEditCareer = viewerRoles.some(r => CAREER_EDIT_ROLES.includes(r)) && !isSelf;

    const fullSel = [
      '*', 'family_details(*)', 'faculty_attributes(*)', 'countries_visited(*)',
      'language_skills(*)', 'siblings_info(*)', 'spouse_details(*)',
      'children_info(*)', 'education_records(*)'
    ].join(',');
    const fullRes = await supabaseRequest(`users_profile?select=${fullSel}&teacher_id=eq.${encodeURIComponent(targetTeacherId)}`);
    const full = (Array.isArray(fullRes) && fullRes.length) ? fullRes[0] : null;
    if (!full) return { error: 'Profile not found.' };

    const completion = _computeProfileCompletion(full);

    if (isPrivileged) {
      return { result: 'success', isPrivileged: true, canEditCareer, completion, profile: full };
    }

    // Which fields count as "public" (visible to any teacher, not just the
    // privileged roles above) is admin-configurable — see
    // saveProfilePublicFields/PROFILE_PUBLIC_FIELDS_DEFAULT below. Name and
    // photo are always shown regardless (a card with neither isn't usable).
    const cfgRows = await supabaseRequest('system_settings?key=eq.profile_public_fields&select=value');
    const cfg = (Array.isArray(cfgRows) && cfgRows[0]) ? cfgRows[0].value : null;
    const publicFields = (cfg && Array.isArray(cfg.fields)) ? cfg.fields : PROFILE_PUBLIC_FIELDS_DEFAULT;

    const curated = { teacher_id: full.teacher_id, full_name: full.full_name, photo_url: full.photo_url };
    publicFields.forEach(f => {
      curated[f] = f === 'education_records' ? (full.education_records || []) : full[f];
    });
    return { result: 'success', isPrivileged: false, canEditCareer: false, completion, profile: curated };
  },

  // Update someone ELSE's Career tab fields (institution/civil law-breaking
  // notes) — never your own, even if you hold one of CAREER_EDIT_ROLES;
  // both checks are re-verified here, never trusted from the client. Every
  // actually-changed field is logged to career_edit_log (who, when, old →
  // new) — see getCareerEditHistory to read it back. Only the two fields
  // named here are ever touched; nothing else on the profile.
  async saveColleagueCareer([callerUserId, targetTeacherId, institution_law_breaking, civil_law_breaking]) {
    if (!callerUserId || !targetTeacherId) return { error: 'Missing parameters.' };
    if (callerUserId === targetTeacherId) return { error: 'You cannot edit your own career record.' };
    const rows = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerUserId)}&select=role`);
    const role = (Array.isArray(rows) && rows[0]) ? rows[0].role : '';
    const roles = String(role || '').split(',').map(r => r.trim());
    if (!roles.some(r => CAREER_EDIT_ROLES.includes(r))) return { error: 'Not authorized to edit career records.' };

    const curRows = await supabaseRequest(`users_profile?teacher_id=eq.${encodeURIComponent(targetTeacherId)}&select=${CAREER_FIELDS.join(',')}`);
    if (!Array.isArray(curRows) || !curRows.length) return { error: 'Profile not found.' };
    const cur = curRows[0];

    const incoming = { institution_law_breaking, civil_law_breaking };
    const updates = {};
    const logs = [];
    CAREER_FIELDS.forEach(field => {
      const newVal = incoming[field] != null ? String(incoming[field]).trim() : '';
      const oldVal = cur[field] || '';
      if (newVal !== oldVal) {
        updates[field] = newVal || null;
        logs.push({ target_teacher_id: targetTeacherId, editor_user_id: callerUserId, field, old_value: oldVal || null, new_value: newVal || null });
      }
    });
    if (!logs.length) return { result: 'success', changed: false };

    const upd = await supabaseRequest(`users_profile?teacher_id=eq.${encodeURIComponent(targetTeacherId)}`, 'patch', updates);
    if (upd && upd.error) return { error: 'DB error saving career record: ' + (upd.details || upd.error) };
    await supabaseRequest('career_edit_log', 'post', logs);
    return { result: 'success', changed: true };
  },

  // Read-only audit trail for one teacher's Career tab — viewable by the
  // owner themselves (transparency: you can always see what's on record
  // about you, even though you can't change it) or by a CAREER_EDIT_ROLES
  // holder viewing someone else's.
  async getCareerEditHistory([callerUserId, targetTeacherId]) {
    if (!callerUserId || !targetTeacherId) return { error: 'Missing parameters.' };
    if (callerUserId !== targetTeacherId) {
      const rows = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerUserId)}&select=role`);
      const role = (Array.isArray(rows) && rows[0]) ? rows[0].role : '';
      const roles = String(role || '').split(',').map(r => r.trim());
      if (!roles.some(r => CAREER_EDIT_ROLES.includes(r))) return { error: 'Not authorized.' };
    }
    const logRows = await supabaseRequest(`career_edit_log?target_teacher_id=eq.${encodeURIComponent(targetTeacherId)}&select=*&order=created_at.desc&limit=50`);
    return { result: 'success', history: Array.isArray(logRows) ? logRows : [] };
  },

  // Admin-only — which profile fields a non-privileged viewer sees on a
  // colleague's card (see getColleagueProfile above). Deliberately a
  // dedicated action rather than reusing the generic updateSystemSettings
  // (which has no role gate) — this setting controls the privacy of every
  // teacher's personal data, so it needs its own server-side enforcement
  // regardless of what the client-side admin-only UI shows.
  async saveProfilePublicFields([callerUserId, fields]) {
    const rows = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(callerUserId || '')}&select=role`);
    const role = (Array.isArray(rows) && rows[0]) ? rows[0].role : '';
    const roles = String(role || '').split(',').map(r => r.trim());
    if (!roles.includes('Admin')) return { error: 'Only Admin can change profile field privacy.' };
    const clean = Array.isArray(fields) ? fields.filter(f => typeof f === 'string') : [];
    await supabaseRequest('system_settings?on_conflict=key', 'post', [{ key: 'profile_public_fields', value: { fields: clean } }]);
    return { result: 'success' };
  },

  async savePersonalProfile([data]) {
    const tid = data.teacher_id;
    if (!tid) return { error: 'Profile did not load correctly (teacher_id missing). Please refresh and try again.' };

    // Helper: extract readable message from a Supabase error response
    function sbErr(res) {
      if (!res || !res.error) return null;
      try { const e = JSON.parse(res.details); return e.message || res.details; } catch { return res.details || res.error; }
    }

    // Login email and account phone live on app_users, not users_profile —
    // validated and written separately below, BEFORE the profile fields, so
    // a rejected email (already used by another account) fails the whole
    // save instead of silently leaving the profile and credentials
    // inconsistent with each other.
    if (data.email !== undefined) {
      const newEmail = String(data.email || '').trim();
      if (newEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { error: 'Enter a valid email address.' };
        const dupe = await supabaseRequest(`app_users?email=eq.${encodeURIComponent(newEmail)}&user_id=neq.${tid}&select=user_id`);
        if (Array.isArray(dupe) && dupe.length) return { error: 'That email is already used by another account.' };
      }
      const acctPayload = { email: newEmail || null };
      if (data.phone !== undefined) acctPayload.phone = String(data.phone || '').trim() || null;
      const acctRes = await supabaseRequest(`app_users?user_id=eq.${tid}`, 'patch', acctPayload);
      const acctErr = sbErr(acctRes);
      if (acctErr) return { error: 'DB error saving account info: ' + acctErr };
    } else if (data.phone !== undefined) {
      const acctRes = await supabaseRequest(`app_users?user_id=eq.${tid}`, 'patch', { phone: String(data.phone || '').trim() || null });
      const acctErr = sbErr(acctRes);
      if (acctErr) return { error: 'DB error saving account info: ' + acctErr };
    }

    // 1. Core profile scalar fields
    // email excluded — it is managed by app_users, not the personal profile form
    // spouse_name excluded — stored in the spouse_details child table
    const profilePayload = {
      teacher_id: tid,
      full_name: data.full_name || null,
      category: data.category || null,
      designation: data.designation || null,
      shortname: data.shortname || null,
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
      religion: data.religion || null,
      caste: data.caste || null,
      nationality: data.nationality || null,
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
      // institution_law_breaking / civil_law_breaking deliberately excluded
      // here — no one may edit their own Career tab, not even via a crafted
      // request to this endpoint. Only saveColleagueCareer (below) may set
      // these, gated to HR/VP/Principal/Cord/Admin editing someone ELSE's
      // record, with every change logged to career_edit_log.
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

  // ── AI lesson-plan draft generation (Admin-only setup, any teacher can generate) ──
  async getAiModelSettings([callerId]) {
    if (!(await _isAdmin(callerId))) return { result: 'error', message: 'Admin access required.' };
    const rows = await supabaseRequest(`system_settings?key=in.(ai_model_settings,ai_provider_keys)&select=key,value`);
    const map = {};
    if (Array.isArray(rows)) rows.forEach(r => { map[r.key] = r.value; });
    const modelSettings = map.ai_model_settings || {};
    const storedKeys = map.ai_provider_keys || {};
    const providers = Object.entries(AI_PROVIDERS).map(([id, meta]) => ({
      id, label: meta.label,
      configured: !!(storedKeys[id] || process.env[meta.envKey]),
      source: storedKeys[id] ? 'database' : (process.env[meta.envKey] ? 'env' : null),
    }));
    return { result: 'success', active: modelSettings.active || 'claude-haiku', enabled: modelSettings.enabled && modelSettings.enabled.length ? modelSettings.enabled : Object.keys(AI_PROVIDERS), providers };
  },

  async saveAiModelSettings([callerId, settings]) {
    if (!(await _isAdmin(callerId))) return { result: 'error', message: 'Admin access required.' };
    const s = settings || {};
    const value = { active: s.active || null, enabled: Array.isArray(s.enabled) ? s.enabled : [] };
    const saved = await supabaseRequest('system_settings?on_conflict=key', 'post', [{ key: 'ai_model_settings', value }]);
    if (saved?.error) return { result: 'error', message: saved.details || saved.error };
    return { result: 'success' };
  },

  // apiKey === '' clears a stored key (falls back to the env var, if any).
  async saveAiProviderKey([callerId, provider, apiKey]) {
    if (!(await _isAdmin(callerId))) return { result: 'error', message: 'Admin access required.' };
    if (!AI_PROVIDERS[provider]) return { result: 'error', message: 'Unknown provider.' };
    const existing = await _getAiProviderKeys();
    if (apiKey) existing[provider] = apiKey; else delete existing[provider];
    const saved = await supabaseRequest('system_settings?on_conflict=key', 'post', [{ key: 'ai_provider_keys', value: existing }]);
    if (saved?.error) return { result: 'error', message: saved.details || saved.error };
    return { result: 'success' };
  },

  // Auto-translates a batch of already-parsed NotebookLM lesson objects to
  // the other language via the free (no API key) Google Translate endpoint
  // — see _googleTranslateOne above. Quality is plain machine translation,
  // not NCTB-terminology-aware like the careful manual translations done
  // elsewhere in this app — good enough for a fast side-by-side preview the
  // teacher reviews before importing, not a substitute for one.
  async translateLessonPlanBatch([callerId, items, targetVersion]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return { result: 'error', message: 'Nothing to translate.' };
    const targetLangCode = targetVersion === 'Bangla Version' ? 'bn' : 'en';

    // Flatten every (item, field path) pair across the whole batch into one
    // job list so the concurrency cap applies globally, not per-lesson.
    const jobs = [];
    const translated = list.map(item => JSON.parse(JSON.stringify(item)));
    translated.forEach((item, itemIdx) => {
      _translatableFieldPaths(item).forEach(path => {
        const text = _getPath(item, path);
        if (text) jobs.push({ itemIdx, path, text });
      });
    });

    try {
      await _mapWithConcurrency(jobs, 6, async job => {
        const result = await _googleTranslateOne(job.text, targetLangCode);
        _setPath(translated[job.itemIdx], job.path, result);
      });
    } catch (err) {
      return { result: 'error', message: 'Translation failed: ' + (err.message || err) };
    }

    translated.forEach(item => { item.version = targetVersion; });
    return { result: 'success', items: translated };
  },

  async generateLessonPlanDraft([callerId, context]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const rows = await supabaseRequest(`system_settings?key=eq.ai_model_settings&select=value`);
    const active = (Array.isArray(rows) && rows[0] && rows[0].value && rows[0].value.active) || 'claude-haiku';
    const c = context || {};
    if (!active || !AI_PROVIDER_FN[active]) {
      await _logAiGeneration(callerId, active, c, false, 'No AI model is set up yet');
      return { result: 'error', message: 'No AI model is set up yet — ask an Admin to configure one under Settings.' };
    }
    const apiKey = await _getAiProviderKey(active);
    if (!apiKey) {
      await _logAiGeneration(callerId, active, c, false, 'No API key configured');
      return { result: 'error', message: `No API key configured for ${(AI_PROVIDERS[active] || {}).label || active}.` };
    }
    try {
      const prompt = _lessonPlanDraftPrompt(c);
      const raw = await AI_PROVIDER_FN[active](apiKey, prompt);
      const draft = _parseAiJson(raw);
      await _logAiGeneration(callerId, active, c, true, null);
      return { result: 'success', draft };
    } catch (err) {
      await _logAiGeneration(callerId, active, c, false, String(err.message || err).slice(0, 500));
      return { result: 'error', message: 'AI generation failed: ' + (err.message || err) };
    }
  },

  async getAiGenerationLog([callerId, limit]) {
    if (!(await _isAdmin(callerId))) return { result: 'error', message: 'Admin access required.' };
    const n = Math.min(Number(limit) || 50, 200);
    const [logRows, profiles] = await Promise.all([
      supabaseRequest(`ai_generation_log?select=*&order=created_at.desc&limit=${n}`),
      supabaseRequest('users_profile?select=teacher_id,full_name'),
    ]);
    const nameMap = {};
    (Array.isArray(profiles) ? profiles : []).forEach(p => { nameMap[p.teacher_id] = p.full_name; });
    const items = (Array.isArray(logRows) ? logRows : []).map(r => ({ ...r, user_name: nameMap[r.user_id] || r.user_id }));
    return { result: 'success', items };
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

  // ── STUDENT MESSAGE HISTORY (oversight) ────────────────────────────────────────
  // Student-side sending happens in the separate ccpc-students app, writing
  // into this same direct_messages table with the same 'student:<id>' prefix
  // convention _forumUserName-style code elsewhere in this codebase uses to
  // namespace a student identity distinct from app_users.user_id. This is
  // the read-only oversight side: Admin/VP/Cord see every student thread;
  // a plain Teacher only sees threads for students in a class they're the
  // class teacher of (class_teacher_assignments).

  async getStudentMessageThreads([callerId]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const isModerator = await _isForumModerator(callerId);
    let studentIdFilter = null;
    if (!isModerator) {
      const assignments = await supabaseRequest(`class_teacher_assignments?user_id=eq.${encodeURIComponent(callerId)}&select=class,section`);
      const myAssignments = Array.isArray(assignments) ? assignments : [];
      if (!myAssignments.length) return { result: 'success', threads: [] };
      const orClauses = myAssignments.map(a => a.section ? `and(class.eq.${encodeURIComponent(a.class)},section.eq.${encodeURIComponent(a.section)})` : `class.eq.${encodeURIComponent(a.class)}`).join(',');
      // students_data lives in the `student` schema, not `teacher_staff`.
      const students = await _sbStudent(`students_data?or=(${orClauses})&select=student_id`);
      studentIdFilter = new Set((Array.isArray(students) ? students : []).map(s => String(s.student_id)));
      if (!studentIdFilter.size) return { result: 'success', threads: [] };
    }
    const msgs = await supabaseRequest(`direct_messages?or=(sender_id.like.student:*,recipient_id.like.student:*)&order=created_at.desc&limit=1000`);
    if (msgs?.error) return { result: 'error', message: msgs.details || msgs.error };
    const list = Array.isArray(msgs) ? msgs : [];
    const seen = new Map();
    list.forEach(m => {
      const studentSide = String(m.sender_id || '').startsWith('student:') ? m.sender_id : m.recipient_id;
      if (!String(studentSide || '').startsWith('student:')) return;
      const studentId = studentSide.slice('student:'.length);
      if (studentIdFilter && !studentIdFilter.has(studentId)) return;
      if (!seen.has(studentId)) seen.set(studentId, { student_id: studentId, last_message: m.message, last_at: m.created_at, unread: 0 });
      if (!m.is_read && m.recipient_id !== studentSide) seen.get(studentId).unread++;
    });
    const studentIds = [...seen.keys()];
    if (studentIds.length) {
      const profiles = await _sbStudent(`students_data?student_id=in.(${studentIds.map(encodeURIComponent).join(',')})&select=student_id,student_name,class,section,roll`);
      (Array.isArray(profiles) ? profiles : []).forEach(p => {
        const t = seen.get(String(p.student_id));
        if (t) Object.assign(t, { student_name: p.student_name, class: p.class, section: p.section, roll: p.roll });
      });
    }
    return { result: 'success', threads: [...seen.values()].sort((a, b) => new Date(b.last_at) - new Date(a.last_at)) };
  },

  async getStudentMessageThread([callerId, studentId]) {
    if (!callerId || !studentId) return { result: 'error', message: 'Missing student id.' };
    if (!(await _isForumModerator(callerId))) {
      const [assignments, studentRows] = await Promise.all([
        supabaseRequest(`class_teacher_assignments?user_id=eq.${encodeURIComponent(callerId)}&select=class,section`),
        _sbStudent(`students_data?student_id=eq.${encodeURIComponent(studentId)}&select=class,section`),
      ]);
      const myAssignments = Array.isArray(assignments) ? assignments : [];
      const student = Array.isArray(studentRows) && studentRows[0];
      const owns = student && myAssignments.some(a => a.class === student.class && (!a.section || !student.section || a.section === student.section));
      if (!owns) return { result: 'error', message: 'You are not the class teacher for this student.' };
    }
    const sid = 'student:' + studentId;
    const msgs = await supabaseRequest(`direct_messages?or=(sender_id.eq.${encodeURIComponent(sid)},recipient_id.eq.${encodeURIComponent(sid)})&order=created_at.asc&limit=500`);
    if (msgs?.error) return { result: 'error', message: msgs.details || msgs.error };
    return { result: 'success', messages: Array.isArray(msgs) ? msgs : [] };
  },

  // ── STUDENT DIARY ────────────────────────────────────────────────────────
  // Any teacher can report a diary entry (discipline case, compliment/good
  // report, wish/greeting) or assign homework/a to-do straight to a student,
  // a whole class, or a class+section — same audience shape as the Forum's
  // Student section (mode/session/class/section/student_ids), reusing
  // searchStudentsForAudience for the picker. Entries live in a new
  // `student_diary_entries` table; the actual student-side reading happens
  // in the separate ccpc-students app via the shared `notifications` table
  // (same 'student:<id>' identity prefix convention used everywhere else
  // student-facing). See DIARY_ENTRY_TYPES/DIARY_LABELS near the top of
  // this file.

  async createDiaryEntry([callerId, payload]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const p = payload || {};
    const entryType = DIARY_ENTRY_TYPES.includes(p.entry_type) ? p.entry_type : null;
    if (!entryType) return { result: 'error', message: 'Pick an entry type.' };
    const message = String(p.message || '').trim();
    if (!message) return { result: 'error', message: 'Write a message first.' };
    const a = p.audience || {};
    if (!a.class) return { result: 'error', message: 'Pick a Class (and optionally Section/Student) this entry is for.' };
    const audience = {
      mode: a.mode || 'class', session: a.session || null, class: a.class, section: a.section || null,
      student_ids: Array.isArray(a.student_ids) ? a.student_ids.map(String) : [],
    };
    if (audience.mode === 'students' && !audience.student_ids.length) return { result: 'error', message: 'Pick at least one student.' };
    const row = {
      teacher_id: callerId, entry_type: entryType, audience,
      subject: (p.subject || '').trim() || null, message,
      due_date: p.due_date || null, created_at: new Date().toISOString(),
    };
    const created = await supabaseRequest('student_diary_entries', 'post', row);
    if (created?.error) return { result: 'error', message: created.details || created.error };
    const entry = created[0];

    // Resolve the actual targeted students (explicit list for "students"
    // mode, or every student_id matching class/class+section otherwise) —
    // same resolution createForumPost already does for its Student section.
    let targetStudentIds = audience.student_ids;
    if (audience.mode !== 'students') {
      let path = `students_data?select=student_id&class=eq.${encodeURIComponent(audience.class)}`;
      if (audience.section) path += `&section=eq.${encodeURIComponent(audience.section)}`;
      const students = await _sbStudent(path);
      targetStudentIds = (Array.isArray(students) ? students : []).map(s => String(s.student_id));
    }
    const label = DIARY_LABELS[entryType];
    const preview = message.length > 100 ? message.slice(0, 100) + '…' : message;
    if (targetStudentIds.length) {
      _forumNotify(targetStudentIds.map(id => 'student:' + id), {
        type: 'diary_entry', title: `${label} — ${audience.class}${audience.section ? '/' + audience.section : ''}`,
        message: preview, data: { diary_entry_id: entry.id, entry_type: entryType },
      });
    }
    // Discipline reports also alert Admin/VP/Cord and the class's own
    // teacher(s) — the one diary type where oversight matters at the
    // moment it's filed, not just whenever someone next opens the
    // oversight list. Compliments/wishes/homework don't need this — they'd
    // just be inbox noise for every discipline case's worth of routine
    // homework.
    if (entryType === 'discipline') {
      const [moderatorIds, classTeacherRows] = await Promise.all([
        supabaseRequest(`app_users?select=user_id,role`).then(rows => (Array.isArray(rows) ? rows : []).filter(u => String(u.role || '').split(',').map(r => r.trim()).some(r => ['Admin', 'VP', 'Cord'].includes(r))).map(u => u.user_id)),
        supabaseRequest(`class_teacher_assignments?class=eq.${encodeURIComponent(audience.class)}&select=user_id,section`),
      ]);
      const relevantTeacherIds = (Array.isArray(classTeacherRows) ? classTeacherRows : [])
        .filter(a2 => !audience.section || !a2.section || a2.section === audience.section).map(a2 => a2.user_id);
      const recipients = [...new Set([...moderatorIds, ...relevantTeacherIds])].filter(id => id !== callerId);
      _forumNotify(recipients, {
        type: 'diary_discipline', title: `Discipline Report Filed — ${audience.class}${audience.section ? '/' + audience.section : ''}`,
        message: preview, data: { diary_entry_id: entry.id },
      });
    }
    return { result: 'success', entry };
  },

  // scope: 'mine' (entries this teacher authored) | 'oversight' (Admin/VP/
  // Cord see everything, a plain Teacher sees entries for classes they're
  // the class teacher of — empty list otherwise, same access rule as
  // getStudentMessageThreads).
  async getDiaryEntries([callerId, scope, filters]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const f = filters || {};
    let path = 'student_diary_entries?select=*';
    if (scope === 'oversight') {
      if (!(await _isForumModerator(callerId))) {
        const assignments = await supabaseRequest(`class_teacher_assignments?user_id=eq.${encodeURIComponent(callerId)}&select=class,section`);
        const myAssignments = Array.isArray(assignments) ? assignments : [];
        if (!myAssignments.length) return { result: 'success', entries: [] };
        const classes = [...new Set(myAssignments.map(a => a.class))];
        path += `&audience->>class=in.(${classes.map(encodeURIComponent).join(',')})`;
      }
    } else {
      path += `&teacher_id=eq.${encodeURIComponent(callerId)}`;
    }
    if (f.entry_type) path += `&entry_type=eq.${encodeURIComponent(f.entry_type)}`;
    path += '&order=created_at.desc&limit=300';
    const rows = await supabaseRequest(path);
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const list = Array.isArray(rows) ? rows : [];
    if (scope === 'oversight' && list.length) {
      const ids = [...new Set(list.map(r => r.teacher_id))];
      const profiles = await supabaseRequest(`users_profile?teacher_id=in.(${ids.map(encodeURIComponent).join(',')})&select=teacher_id,full_name`);
      const nameById = {};
      if (Array.isArray(profiles)) profiles.forEach(p2 => { nameById[p2.teacher_id] = p2.full_name; });
      list.forEach(r => { r.teacher_name = nameById[r.teacher_id] || r.teacher_id; });
    }
    return { result: 'success', entries: list };
  },

  async deleteDiaryEntry([callerId, id]) {
    if (!callerId || !id) return { result: 'error', message: 'Missing entry id.' };
    const rows = await supabaseRequest(`student_diary_entries?id=eq.${encodeURIComponent(id)}&select=teacher_id`);
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const entry = Array.isArray(rows) && rows[0];
    if (!entry) return { result: 'error', message: 'Entry not found.' };
    if (entry.teacher_id !== callerId && !(await _isCordOrAdmin(callerId))) {
      return { result: 'error', message: 'Only the author (or an Admin) can delete this entry.' };
    }
    const deleted = await supabaseRequest(`student_diary_entries?id=eq.${encodeURIComponent(id)}`, 'delete');
    if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    return { result: 'success' };
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
  // Every handler below takes a leading sectionKey ('school'|'college'|
  // 'honours') and resolves that section's own sheet/GAS addresses via
  // _getRoutineSectionConfig before doing anything else — see System >
  // Routine Settings for where an Admin configures those addresses.

  // Full staff directory with shortname mapping, sourced from the "Logged in info" sheet.
  async getRoutineDirectory([sectionKey]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.routineSheetId) return [];
    const rows = await _fetchSheetRows(cfg.routineSheetId, { name: 'Logged in info' });
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
  async getWeeklyRoutine([sectionKey, shortname]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.routineSheetId) return { error: 'This section has not been set up yet. Ask an Admin to configure it in System > Routine Settings.' };
    const rows = await _fetchSheetRows(cfg.routineSheetId, { name: 'Classes' });
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
  async getTodayRoutineBoard([sectionKey]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.routineSheetId) return { error: 'This section has not been set up yet. Ask an Admin to configure it in System > Routine Settings.' };
    const rows = await _fetchSheetRows(cfg.routineSheetId, { name: 'Selected' });
    const headerIdx = rows.findIndex(r => r.some(c => String(c).trim() === 'Name'));
    if (headerIdx < 0) return { error: 'Could not read Selected sheet' };
    const header = rows[headerIdx];
    const nameIdx = header.findIndex(c => String(c).trim() === 'Name');
    const periodCols = _findPeriodCols(header);
    const meta = rows[0] || [];
    const weekday = meta.find(c => WEEKDAYS.includes(String(c).trim())) || '';
    const dateLabel = meta.find(c => /\d{4}/.test(String(c)) && !WEEKDAYS.includes(String(c).trim())) || '';

    // Master routine for the same weekday, keyed by shortname, for diffing
    const classesRows = await _fetchSheetRows(cfg.routineSheetId, { name: 'Classes' });
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
  async getSubstituteOptions([sectionKey, periodLabel]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.routineSheetId) return [];
    const rows = await _fetchSheetRows(cfg.routineSheetId, { name: 'Dropdown' });
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
  async submitClassAdjustment([sectionKey, callerId, teacherShortname, periodLabel, substituteValue]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized to make adjustments.' };
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.routineSheetId || !cfg.gasUrl) return { success: false, message: 'This section has not been set up yet. Ask an Admin to configure it in System > Routine Settings.' };
    const board = await handlers.getTodayRoutineBoard([sectionKey]);
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

    const gasRes = await _callRoutineGas(cfg.gasUrl, { action: 'write', row1: row.sheetRow, col, sto });
    if (!gasRes.ok) return { success: false, message: gasRes.text || 'Write request failed.' };

    // The Apps Script endpoint returns a generic success message even when its
    // internal logic silently does nothing — verify the cell actually changed
    // before reporting success back to the client.
    const verifyBoard = await handlers.getTodayRoutineBoard([sectionKey]);
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
  // A full reseed can legitimately take a few minutes on the Apps Script
  // side. 50s leaves this function's own maxDuration (60s, see top of file)
  // enough headroom to still return cleanly instead of being hard-killed by
  // the platform — if the upstream call is still running past that, this
  // reports "pending" rather than a hard failure; the client then polls
  // getTodayRoutineBoard for the real outcome (see _confirmDailySetup).
  async runDailyRoutineSetup([sectionKey, callerId, dateStr]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized.' };
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.gasUrl) return { success: false, message: 'This section has not been set up yet. Ask an Admin to configure it in System > Routine Settings.' };
    const gasRes = await _callRoutineGas(cfg.gasUrl, { action: 'setup', date: dateStr }, 50000);
    if (gasRes.timedOut) return { success: null, pending: true, message: 'Still working — a full day reseed can take a few minutes.' };
    return { success: gasRes.ok, message: gasRes.text };
  },

  // Render today's adjustment notice as PDF — Cord/Admin only (generation has cost).
  async generateAdjustmentPdf([sectionKey, callerId]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized.' };
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.gasUrl) return { success: false, message: 'This section has not been set up yet. Ask an Admin to configure it in System > Routine Settings.' };
    const gasRes = await _callRoutineGas(cfg.gasUrl, { action: 'pdf' });
    return { success: gasRes.ok && !!gasRes.text, url: gasRes.text };
  },

  // Full history of generated adjustment PDFs (read-only) — the sheet
  // prepends each new entry above row 2 (see appscript.gs), so rows are
  // already newest-first; no sorting needed. Each "PDF Name" cell encodes
  // two dates as one string, e.g.
  //   "Thu Jul 2, 2026,(PDF Created: Jul 5, 2026, 11:08 pm).pdf"
  // — the adjustment date the notice covers, and when it was generated —
  // split apart here so the UI doesn't have to parse it.
  async getAdjustmentPdfHistory([sectionKey]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.routineSheetId) return [];
    const rows = await _fetchSheetRows(cfg.routineSheetId, { name: 'Adjustment link' });
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

  // ── ROUTINE ARCHIVE (read-only browser) ─────────────────────────────────────
  // A tab already maintained automatically by the school's existing Apps
  // Script/Kodular system — NOT written by this app. Same column shape as
  // getTodayRoutineBoard's "Selected" sheet (Name + period columns), but with
  // many past days stacked one after another in the same tab, each day's
  // block preceded by a date/weekday header row. We only ever read it.

  // Fast pass: just the list of {date, weekday} blocks present, newest data
  // first as found — no full per-day parse, mirrors getAdjustmentPdfHistory's
  // list-first pattern so opening the browser doesn't parse the whole tab.
  async getArchivedAdjustmentDaysIndex([sectionKey]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.archiveSheetId) return [];
    const rows = await _fetchSheetRows(cfg.archiveSheetId, { gid: cfg.archiveGid, name: 'Sheet1' });
    const days = [];
    for (const r of rows) {
      const dateCell = String((r || [])[0] || '').trim();
      const m = dateCell.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) continue;
      const weekday = String(r[1] || r[2] || '').trim();
      days.push({ date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, dateLabel: dateCell, weekday });
    }
    return days;
  },

  // One day's block of teacher rows from the archive tab, same {periods,
  // rows} shape as getTodayRoutineBoard so the client can reuse the same
  // rendering it already has for today's board.
  async getArchivedAdjustmentDay([sectionKey, dateStr]) {
    const cfg = await _getRoutineSectionConfig(sectionKey);
    if (!cfg.archiveSheetId) return { error: 'This section has no archive configured.' };
    const rows = await _fetchSheetRows(cfg.archiveSheetId, { gid: cfg.archiveGid, name: 'Sheet1' });
    // Find the header row nearest above the matching date block — the "Name"/
    // period-column header repeats before every day's block in this sheet
    // (confirmed against the live example), not just once at the very top.
    let headerRow = null, headerIdx = -1, blockStart = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      if (r.some(c => String(c).trim() === 'Name')) { headerRow = r; headerIdx = i; }
      const dateCell = String(r[0] || '').trim();
      const m = dateCell.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (iso === dateStr) { blockStart = i; break; }
      }
    }
    if (blockStart < 0 || !headerRow) return { error: 'Could not find that date in the archive.' };
    const nameIdx = headerRow.findIndex(c => String(c).trim() === 'Name');
    const periodCols = _findPeriodCols(headerRow);
    const dataRows = [];
    for (let i = blockStart + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const dateCell = String(r[0] || '').trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateCell)) break; // next day's block starts here
      const name = String(r[nameIdx] || '').trim();
      if (!name) continue;
      const periods = {};
      periodCols.forEach(pc => { periods[pc.label] = String(r[pc.idx] || '').trim(); });
      dataRows.push({ shortname: name, periods });
    }
    return { periods: periodCols.map(p => p.label), rows: dataRows };
  },

  // ── STUDENT TAB DATA (delegated access) ──────────────────────────────────────
  // Admins pick teachers/staff per custom tab (portal_tabs.data_access_json in the
  // student schema); those users can view + export that tab's submissions here.

  async getMyTabDataAccess([userId]) {
    if (!userId) return [];
    // Four independent grant paths: the global per-tab allowlist
    // (portal_tabs.data_access_json), admin-given class-scoped grants
    // (tab_class_access), being a verified class teacher (automatic, every
    // enabled tab, scoped to their own class(es), no explicit grant
    // needed — sheet resolution is best-effort so explicit grants keep
    // working if the sheet is down), and holding a Field Category grant
    // for ANY category this tab is live-linked to
    // (portal_tabs.linked_categories_json) — any one of them counts,
    // filtered or not.
    const [tabs, scoped, assignments, catGrants] = await Promise.all([
      _sbStudent(`portal_tabs?select=tab_name,data_access_json,is_enabled,linked_categories_json&order=sort_order.asc`),
      _sbStudent(`tab_class_access?user_id=eq.${encodeURIComponent(userId)}&select=tab_name`),
      _getClassTeacherAssignments().catch(() => []),
      _sbStudent(`field_access_grants?user_id=eq.${encodeURIComponent(userId)}&select=category_name`),
    ]);
    const scopedNames = new Set((Array.isArray(scoped) ? scoped : []).map(r => r.tab_name));
    const isClassTeacher = assignments.some(a => a.resolvedUserId === userId);
    const myCategories = new Set((Array.isArray(catGrants) ? catGrants : []).map(g => g.category_name));
    const names = [];
    (Array.isArray(tabs) ? tabs : []).forEach(t => {
      let global = false;
      try { global = JSON.parse(t.data_access_json || '[]').includes(String(userId)); } catch {}
      let linkedCats = [];
      try { linkedCats = JSON.parse(t.linked_categories_json || '[]'); } catch {}
      const linkedMatch = Array.isArray(linkedCats) && linkedCats.some(c => myCategories.has(c));
      if (global || scopedNames.has(t.tab_name) || (isClassTeacher && t.is_enabled !== false) || linkedMatch) names.push(t.tab_name);
    });
    return names.map(tab_name => ({ tab_name }));
  },

  async getTabDataForUser([userId, tabName]) {
    if (!userId || !tabName) return { error: 'Not authorized.' };
    // authorization: the caller must be on this tab's global access list, or
    // hold class-scoped grants for it — checked server-side on every request,
    // never trusted from the client
    const tabRow = await _sbStudent(`portal_tabs?tab_name=eq.${encodeURIComponent(tabName)}`);
    const cfg = (Array.isArray(tabRow) && tabRow[0]) ? tabRow[0] : null;
    let allowed = [];
    try { allowed = JSON.parse(cfg?.data_access_json || '[]'); } catch {}
    const isGlobal = allowed.includes(String(userId));

    // Live-linked Field Categories (portal_tabs.linked_categories_json) —
    // a category grant with NO row_filter acts exactly like a global Data
    // Access grant; one WITH a row_filter is re-evaluated against the live
    // roster below rather than copied into a static list, so it tracks
    // both roster changes and any later edit to the category's own filter.
    // Holding grants in several linked categories at once unions together
    // (OR) — a student needs to match only one of them.
    let linkedCats = [];
    try { linkedCats = JSON.parse(cfg?.linked_categories_json || '[]'); } catch {}
    let linkedRowFilters = []; // [] = no link/no grant; entries can be null (unfiltered/global) or a filter object
    let isLinkedGlobal = false;
    if (!isGlobal && Array.isArray(linkedCats) && linkedCats.length) {
      const grantRows = await _sbStudent(`field_access_grants?user_id=eq.${encodeURIComponent(userId)}&category_name=in.(${linkedCats.map(encodeURIComponent).join(',')})&select=row_filter`);
      if (Array.isArray(grantRows) && grantRows.length) {
        linkedRowFilters = grantRows.map(g => (g.row_filter && typeof g.row_filter === 'object') ? g.row_filter : null);
        isLinkedGlobal = linkedRowFilters.some(f => f === null);
      }
    }

    // Class-scoped path: global grantees see everything (as always); a
    // scoped-only grantee sees just their granted class-sections' students,
    // with class/section columns prepended so multi-class views stay readable.
    // Grant sources merged here: explicit admin grants (tab_class_access) +
    // being the verified class teacher of a class (automatic, enabled tabs
    // only — no explicit grant needed; sheet resolution is best-effort so
    // explicit grants keep working if the sheet is down) + a live-linked
    // category's row_filter, matched per-student rather than via combos.
    let allowedStudentIds = null; // null = unrestricted (global grant)
    let roster; // student_id,student_name,roll,class,section,gender — the full
                // universe this call can ever show, submitted or not, so
                // non-submitters appear as blank/"not filled" rows instead of
                // silently vanishing from the list.
    if (!isGlobal && !isLinkedGlobal) {
      const [grants, assignments] = await Promise.all([
        _sbStudent(`tab_class_access?tab_name=eq.${encodeURIComponent(tabName)}&user_id=eq.${encodeURIComponent(userId)}&select=class,section,group`),
        cfg?.is_enabled !== false ? _getClassTeacherAssignments().catch(() => []) : Promise.resolve([]),
      ]);
      const seen = new Set();
      const filters = [];
      // grp === null means "no group constraint" (matches every group) — used
      // for sheet-resolved class teachers, since the routine sheet has no
      // concept of group. Explicit admin grants always carry a specific group
      // (defaulting to the literal value 'None'), matched exactly — that's the
      // whole point of making Class Access group-aware.
      const addFilter = (cls, sec, grp) => {
        if (!cls || !sec) return;
        const key = `${cls}|${sec}|${grp === null ? '*' : grp}`;
        if (seen.has(key)) return;
        seen.add(key);
        filters.push(grp !== null
          ? `and(class.eq.${encodeURIComponent(cls)},section.eq.${encodeURIComponent(sec)},group.eq.${encodeURIComponent(grp)})`
          : `and(class.eq.${encodeURIComponent(cls)},section.eq.${encodeURIComponent(sec)})`);
      };
      (Array.isArray(grants) ? grants : []).forEach(g => addFilter(g.class, g.section, g.group || 'None'));
      assignments.filter(a => a.resolvedUserId === userId).forEach(a => addFilter(
        CLASS_TEACHER_NAME_TO_STUDENT_CLASS[a.className] || a.className,
        CLASS_TEACHER_SECTION_ALIASES[a.section] || a.section,
        null
      ));
      let comboStudents = [];
      if (filters.length) {
        const orFilter = filters.join(',');
        const r = await _sbStudent(`students_data?or=(${orFilter})&select=student_id,student_name,roll,class,section,group,gender&order=roll.asc`);
        comboStudents = Array.isArray(r) ? r : [];
      }
      let linkedStudents = [];
      const activeFilters = linkedRowFilters.filter(f => f && Object.keys(f).length);
      if (activeFilters.length) {
        const all = await _sbStudentAllRows(`students_data?select=student_id,student_name,roll,class,section,group,gender,version`);
        linkedStudents = (Array.isArray(all) ? all : []).filter(s => activeFilters.some(f => _matchesRowFilter(s, f)));
      }
      const merged = {};
      [...comboStudents, ...linkedStudents].forEach(s => { merged[s.student_id] = s; });
      roster = Object.values(merged);
      if (!roster.length) return { error: 'Not authorized for this tab.' };
      allowedStudentIds = new Set(roster.map(s => String(s.student_id)));
    } else {
      const all = await _sbStudentAllRows(`students_data?select=student_id,student_name,roll,class,section,group,gender&order=class.asc,section.asc,roll.asc`);
      roster = Array.isArray(all) ? all : [];
    }
    const scopedCols = allowedStudentIds ? ['class', 'section', 'group'] : [];
    if (!roster.length) return { headers: ['student_id', ...scopedCols], rows: [], sort_meta: {}, filled: {} };

    let subRows = await _sbStudent(`portal_submissions?tab_name=eq.${encodeURIComponent(tabName)}`);
    if (!Array.isArray(subRows)) subRows = [];
    if (allowedStudentIds) subRows = subRows.filter(r => allowedStudentIds.has(String(r.student_id)));
    const subByStudent = {};
    subRows.forEach(r => { subByStudent[String(r.student_id)] = r.data || {}; });

    // Sort metadata (roll/name/class/section/gender per student) — always
    // returned so the teacher's own view can offer a "Sort by" control at
    // view-time rather than an admin pre-configuring one; none of these
    // live on the submission row itself. Keyed by student_id so the client
    // can re-sort without a round-trip regardless of display-column config.
    const sortMeta = {};
    roster.forEach(s => { sortMeta[String(s.student_id)] = s; });
    // Same keying — whether this student actually has a portal_submissions
    // row for this tab, independent of which individual fields are blank.
    const filled = {};
    roster.forEach(s => { filled[String(s.student_id)] = subByStudent.hasOwnProperty(String(s.student_id)); });

    // same config-ordered columns as the admin Data view
    const ordered = ['student_id', ...scopedCols];
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
    subRows.forEach(r => Object.keys(r.data || {}).forEach(k => { if (!ordered.includes(k)) extras.add(k); }));
    const headers = [...ordered, ...extras];
    const dataRows = roster.map(s => headers.map(h => {
      if (h === 'student_id') return s.student_id;
      const data = subByStudent[String(s.student_id)];
      if (scopedCols.includes(h)) return (data && data[h]) || s[h] || '';
      return data ? (data[h] ?? '') : '';
    }));
    return { headers, rows: dataRows, sort_meta: sortMeta, filled };
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
      .map(({ classKey, className, section, extraCriteria }) => ({ classKey, className, section, extraCriteria: extraCriteria || {} }));
    return { classes };
  },

  async getMyClassRoster([userId]) {
    if (!userId) return { classes: [] };
    const assignments = await _getClassTeacherAssignments();
    const mine = assignments.filter(a => a.resolvedUserId === userId);
    if (!mine.length) return { classes: [] };

    const classes = await Promise.all(mine.map(async ({ classKey, className, section, extraCriteria }) => {
      const studentClass = CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className;
      const studentSection = CLASS_TEACHER_SECTION_ALIASES[section] || section;
      const students = await _sbStudent(
        `students_data?class=eq.${encodeURIComponent(studentClass)}&section=eq.${encodeURIComponent(studentSection)}${_extraCriteriaQS(extraCriteria)}` +
        `&select=student_id,student_name,roll,gender,group,version,shift,phone_number,father_phone,mother_phone,photo&order=roll.asc`
      );
      return { classKey, className, section, students: Array.isArray(students) ? students : [] };
    }));
    return { classes };
  },

  // ── CLASS TEACHER → TODAY'S ATTENDANCE (mark/revert) ─────────────────────
  // "Present" by default means the ESP32/NFC device logged them today
  // (student.attendance_records) — a class teacher can override that per
  // student to any of MY_CLASS_ATTENDANCE_STATUSES, which writes/overwrites
  // a row in manual_attendance_overrides. Reverting just DELETEs that
  // override row rather than trying to restore a remembered "previous"
  // value — the device-derived status underneath was never touched, so
  // deleting the override naturally falls back to it. This mirrors (and
  // shares the roster query with) getMyClassRoster; a student outside every
  // one of the caller's own assigned classes is never a valid target,
  // checked server-side, never trusted from the client.
  async getMyClassTodayAttendance([userId]) {
    if (!userId) return { classes: [] };
    const today = new Date().toISOString().slice(0, 10);
    const assignments = await _getClassTeacherAssignments();
    const mine = assignments.filter(a => a.resolvedUserId === userId);
    if (!mine.length) return { classes: [] };

    const [presentRows, overrideRows] = await Promise.all([
      _sbStudent(`attendance_records?date=eq.${today}&select=student_id`),
      _sbStudent(`manual_attendance_overrides?date=eq.${today}&select=student_id,status`),
    ]);
    const presentSet = new Set((Array.isArray(presentRows) ? presentRows : []).map(p => p.student_id));
    const overrideMap = {};
    (Array.isArray(overrideRows) ? overrideRows : []).forEach(o => { overrideMap[o.student_id] = o.status; });

    const classes = await Promise.all(mine.map(async ({ classKey, className, section, extraCriteria }) => {
      const studentClass = CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className;
      const studentSection = CLASS_TEACHER_SECTION_ALIASES[section] || section;
      const students = await _sbStudent(
        `students_data?class=eq.${encodeURIComponent(studentClass)}&section=eq.${encodeURIComponent(studentSection)}${_extraCriteriaQS(extraCriteria)}` +
        `&select=student_id,student_name,roll,phone_number,father_phone,mother_phone,photo&order=roll.asc`
      );
      const roster = (Array.isArray(students) ? students : []).map(s => {
        const override = overrideMap[s.student_id];
        const status = override || (presentSet.has(s.student_id) ? 'present' : 'absent');
        return { ...s, status, is_override: !!override };
      });
      return { classKey, className, section, students: roster };
    }));
    return { classes, date: today };
  },

  async setMyClassStudentAttendance([userId, studentId, status]) {
    if (!userId || !studentId) return { success: false, message: 'Missing student.' };
    if (!MY_CLASS_ATTENDANCE_STATUSES.has(status)) return { success: false, message: 'Invalid status.' };
    if (!(await _isCallerStudentAuthorized(userId, studentId))) return { success: false, message: 'Not your student.' };
    const today = new Date().toISOString().slice(0, 10);
    const r = await _sbStudentUpsert('manual_attendance_overrides?on_conflict=student_id,date', {
      student_id: studentId, date: today, status, marked_by: userId,
    });
    if (r && r.error) return { success: false, message: r.error };
    return { success: true, status };
  },

  async revertMyClassStudentAttendance([userId, studentId]) {
    if (!userId || !studentId) return { success: false, message: 'Missing student.' };
    if (!(await _isCallerStudentAuthorized(userId, studentId))) return { success: false, message: 'Not your student.' };
    const today = new Date().toISOString().slice(0, 10);
    const r = await _sbStudentWrite(`manual_attendance_overrides?student_id=eq.${encodeURIComponent(studentId)}&date=eq.${today}`, 'DELETE');
    if (r && r.error) return { success: false, message: r.error };
    const presentRows = await _sbStudent(`attendance_records?date=eq.${today}&student_id=eq.${encodeURIComponent(studentId)}&select=student_id`);
    return { success: true, status: (Array.isArray(presentRows) && presentRows.length) ? 'present' : 'absent' };
  },

  // "Mark All Present" quick action (the top checkbox) — forces every
  // student in every one of the caller's own classes to an explicit
  // 'present' override, one write per student. Scoped the same way as
  // everything else here: only the caller's OWN resolved classes, never a
  // class/roster supplied by the client.
  async setMyClassAllPresent([userId]) {
    if (!userId) return { success: false, message: 'Not logged in.' };
    const assignments = await _getClassTeacherAssignments();
    const mine = assignments.filter(a => a.resolvedUserId === userId);
    if (!mine.length) return { success: false, message: 'You are not currently assigned as a class teacher.' };
    const today = new Date().toISOString().slice(0, 10);

    const rosters = await Promise.all(mine.map(async ({ className, section, extraCriteria }) => {
      const studentClass = CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className;
      const studentSection = CLASS_TEACHER_SECTION_ALIASES[section] || section;
      const students = await _sbStudent(
        `students_data?class=eq.${encodeURIComponent(studentClass)}&section=eq.${encodeURIComponent(studentSection)}${_extraCriteriaQS(extraCriteria)}&select=student_id`
      );
      return Array.isArray(students) ? students.map(s => s.student_id) : [];
    }));
    const studentIds = Array.from(new Set(rosters.flat()));
    if (!studentIds.length) return { success: true, count: 0 };

    // One batched upsert instead of one request per student — a single
    // POST with on_conflict handles the whole roster's insert-or-update in
    // one round trip.
    const rows = studentIds.map(sid => ({ student_id: sid, date: today, status: 'present', marked_by: userId }));
    const r = await _sbStudentUpsert('manual_attendance_overrides?on_conflict=student_id,date', rows);
    if (r && r.error) return { success: false, message: r.error };
    return { success: true, count: studentIds.length };
  },

  // ── CLASS TEACHER → ATTENDANCE REPORT ─────────────────────────────────────
  // Same authorization shape as getMyClassRoster: class/section is never
  // accepted from the client, only re-derived from the CALLER's own
  // class-teacher assignments. For each of the caller's classes, pulls the
  // roster plus every attendance_records/manual_attendance_overrides row in
  // [fromDate, toDate] and folds it into one present/absent count per
  // student — the report itself (day-by-day breakdown, CSV, printing) is
  // built client-side from this summary, nothing is persisted here.
  async getMyClassAttendanceReport([userId, fromDate, toDate]) {
    if (!userId) return { classes: [] };
    if (!fromDate || !toDate) return { classes: [], error: 'fromDate and toDate required.' };
    const assignments = await _getClassTeacherAssignments();
    const mine = assignments.filter(a => a.resolvedUserId === userId);
    if (!mine.length) return { classes: [] };

    const feeRows = await supabaseRequest('system_settings?key=eq.attendance_absent_fee&select=value').catch(() => null);
    const absentFeeAmount = (Array.isArray(feeRows) && feeRows[0] && feeRows[0].value && Number(feeRows[0].value.amount)) || 0;

    const classes = await Promise.all(mine.map(async ({ classKey, className, section, extraCriteria }) => {
      const studentClass = CLASS_TEACHER_NAME_TO_STUDENT_CLASS[className] || className;
      const studentSection = CLASS_TEACHER_SECTION_ALIASES[section] || section;
      const [students, presentRows, overrideRows] = await Promise.all([
        _sbStudent(
          `students_data?class=eq.${encodeURIComponent(studentClass)}&section=eq.${encodeURIComponent(studentSection)}${_extraCriteriaQS(extraCriteria)}` +
          `&select=student_id,student_name,roll&order=roll.asc`
        ),
        _sbStudent(`attendance_records?date=gte.${encodeURIComponent(fromDate)}&date=lte.${encodeURIComponent(toDate)}&select=student_id,date`),
        _sbStudent(`manual_attendance_overrides?date=gte.${encodeURIComponent(fromDate)}&date=lte.${encodeURIComponent(toDate)}&select=student_id,date,status`),
      ]);
      const roster = Array.isArray(students) ? students : [];
      const rosterIds = new Set(roster.map(s => s.student_id));

      // "Was this a school day at all" is judged school-wide (any student's
      // device punch or manual override that date), not just this one
      // class's roster — a class where every single student happened to be
      // absent on a real school day must still count that day, not silently
      // drop it because nobody in the roster has a row for it.
      const allPresentRows = Array.isArray(presentRows) ? presentRows : [];
      const allOverrideRows = Array.isArray(overrideRows) ? overrideRows : [];
      const allDates = Array.from(new Set([
        ...allPresentRows.map(p => p.date),
        ...allOverrideRows.map(o => o.date),
      ])).sort();

      // date -> Set(student_id) present via device; overrides win per (student,date)
      const presentByDate = {};
      allPresentRows.forEach(p => {
        if (!rosterIds.has(p.student_id)) return;
        (presentByDate[p.date] = presentByDate[p.date] || new Set()).add(p.student_id);
      });
      const overrideByStudentDate = {};
      allOverrideRows.forEach(o => {
        if (!rosterIds.has(o.student_id)) return;
        overrideByStudentDate[`${o.student_id}||${o.date}`] = o.status;
      });

      const students_summary = roster.map(s => {
        // "absent" here means fee-liable absence — a class teacher marking
        // specific days 'leave' (via My Students → Leave Apply) pulls those
        // days out of the fee entirely without touching the attendance %,
        // which still treats a leave day as not-present. late/missing/
        // late_absent are still fee-liable, same as a plain absence.
        let present = 0, absent = 0, leave = 0;
        allDates.forEach(dt => {
          const ov = overrideByStudentDate[`${s.student_id}||${dt}`];
          const status = ov || (presentByDate[dt] && presentByDate[dt].has(s.student_id) ? 'present' : 'absent');
          if (status === 'present') present++;
          else if (status === 'leave') leave++;
          else absent++;
        });
        const total = allDates.length;
        return {
          student_id: s.student_id, student_name: s.student_name, roll: s.roll,
          present, absent, leave, total,
          percentage: total ? Math.round((present / total) * 1000) / 10 : 0,
          absent_fee: Math.round(absent * absentFeeAmount * 100) / 100,
        };
      });

      return { classKey, className, section, dates: allDates, students: students_summary };
    }));
    return { classes, absentFeeAmount };
  },

  // ── CLASS TEACHER SYNC (bulk admin tool, "Staff Access & Roles" panel) ──
  // Surfaces _getClassTeacherAssignments' own sheet+DB merge for manual
  // review instead of silent internal resolution: every class/section the
  // sheet lists, translated into the student DB's own class/section spelling
  // (so it matches Class-Wide Access and can be written straight back), with
  // whichever teacher got resolved — sheet ID match, sheet shortname match,
  // or an existing DB row filling a gap the sheet couldn't resolve.
  async previewClassTeacherSync() {
    const rows = await _getClassTeacherAssignments();
    return {
      rows: rows.map(r => ({
        class: CLASS_TEACHER_NAME_TO_STUDENT_CLASS[r.className] || r.className,
        section: CLASS_TEACHER_SECTION_ALIASES[r.section] || r.section,
        user_id: r.resolvedUserId,
        source: r.resolvedVia, // 'id' | 'shortname' | 'db' | null (sheet listed it but nobody could be resolved)
      })),
    };
  },

  // Admin-only: replaces student.class_teacher_assignments wholesale with
  // the reviewed list (a row with no teacher picked is simply omitted, not
  // written as a blank assignment). The sheet has no concept of narrowing a
  // combo further than class+section, so this bulk replace never invents
  // extra_criteria of its own — but it MUST NOT blank out extra_criteria a
  // Cord/Admin already set manually via the per-teacher combo builder
  // elsewhere in the same panel (e.g. a session/group-scoped assignment) for
  // a class+section+teacher triple this sync leaves otherwise unchanged.
  async applyClassTeacherSync([callerId, rows]) {
    if (!(await _isCordOrAdmin(callerId))) return { success: false, message: 'Not authorized.' };
    const clean = (Array.isArray(rows) ? rows : [])
      .map(r => ({ class: String(r.class || '').trim(), section: String(r.section || '').trim(), user_id: String(r.user_id || '').trim() }))
      .filter(r => r.class && r.section && r.user_id);
    const existing = await _sbStudent('class_teacher_assignments?select=class,section,user_id,extra_criteria');
    const existingCriteria = new Map();
    (Array.isArray(existing) ? existing : []).forEach(r => existingCriteria.set(`${r.class}||${r.section}||${r.user_id}`, r.extra_criteria || {}));
    const cleanWithCriteria = clean.map(r => ({ ...r, extra_criteria: existingCriteria.get(`${r.class}||${r.section}||${r.user_id}`) || {} }));
    const del = await _sbStudentWrite('class_teacher_assignments?id=gt.0', 'DELETE');
    if (del && del.error) return { success: false, message: del.error };
    if (cleanWithCriteria.length) {
      const ins = await _sbStudentWrite('class_teacher_assignments', 'POST', cleanWithCriteria);
      if (ins && ins.error) return { success: false, message: ins.error };
    }
    return { success: true, count: cleanWithCriteria.length };
  },

  // Bare tab list for the "My Class" button row — tab NAMES aren't sensitive
  // (only submission data is, gated per-tab below), so no per-user filtering
  // needed here.
  async getEnabledPortalTabs() {
    const rows = await _sbStudent(`portal_tabs?is_enabled=eq.true&select=tab_name,icon_class&order=sort_order.asc`);
    return { tabs: Array.isArray(rows) ? rows : [] };
  },

  // Whole-class, at-a-glance table for one custom tab: one row per student in
  // the caller's own resolved class(es), one column per tab field. Same
  // authorization model as getMyClassRoster/getStudentDetail — the roster is
  // re-derived server-side from the caller's own resolved classes, never
  // from client input, and submissions are queried scoped to just those
  // student_ids.
  async getMyClassTabTable([userId, tabName]) {
    if (!userId || !tabName) return { error: 'Not authorized.' };
    const assignments = await _getClassTeacherAssignments();
    const mine = assignments
      .filter(a => a.resolvedUserId === userId)
      .map(a => ({
        classKey: a.classKey,
        studentClass: CLASS_TEACHER_NAME_TO_STUDENT_CLASS[a.className] || a.className,
        studentSection: CLASS_TEACHER_SECTION_ALIASES[a.section] || a.section,
        extraCriteria: a.extraCriteria || {},
      }));
    if (!mine.length) return { error: 'Not authorized.' };

    const rosterLists = await Promise.all(mine.map(async (m) => {
      const students = await _sbStudent(
        `students_data?class=eq.${encodeURIComponent(m.studentClass)}&section=eq.${encodeURIComponent(m.studentSection)}${_extraCriteriaQS(m.extraCriteria)}&select=student_id,student_name,roll,class,section,group,gender&order=roll.asc`
      );
      return (Array.isArray(students) ? students : []).map(s => ({ ...s, classKey: m.classKey }));
    }));
    const roster = rosterLists.flat();
    if (!roster.length) return { headers: [], rows: [], sort_meta: [], filled: [] };

    const studentIds = roster.map(s => s.student_id);
    const [tabRows, subRows] = await Promise.all([
      _sbStudent(`portal_tabs?tab_name=eq.${encodeURIComponent(tabName)}&select=fields_json`),
      _sbStudent(`portal_submissions?tab_name=eq.${encodeURIComponent(tabName)}&student_id=in.(${studentIds.map(encodeURIComponent).join(',')})&select=student_id,data`),
    ]);
    const cfg = Array.isArray(tabRows) && tabRows[0];
    let fields = [];
    try { fields = JSON.parse(cfg?.fields_json || '[]'); } catch {}
    // Track each field's nearest preceding group_label (e.g. "Father's
    // Information") so same-named fields in different branches of a form
    // (three separate "Occupation Type" fields, one per parent/guardian) can
    // be disambiguated in the table header instead of all showing identically.
    let currentGroup = '';
    const dataFields = [];
    fields.forEach(f => {
      if (f.type === 'group_label') { currentGroup = f.label || ''; return; }
      if (f.data_key) dataFields.push({ ...f, _group: currentGroup });
    });
    const bareLabel = f => f.name || f.label || f.data_key;

    const subByStudent = {};
    (Array.isArray(subRows) ? subRows : []).forEach(s => { subByStudent[s.student_id] = s.data || {}; });
    const submittedIds = new Set((Array.isArray(subRows) ? subRows : []).map(s => String(s.student_id)));

    // Prune to only fields that at least one student actually filled in —
    // forms like this routinely define 40+ conditional sub-fields (Father's
    // Info / Mother's Info / Local Guardian branches), and showing every one
    // as a column defeats "at a glance" with a wall of empty, duplicate-
    // labelled cells (e.g. three separate "Occupation Type" columns).
    const usedFields = dataFields.filter(f => roster.some(s => {
      const v = (subByStudent[s.student_id] || {})[f.data_key];
      return v !== undefined && v !== null && v !== '';
    }));
    const labelCounts = {};
    usedFields.forEach(f => { const l = bareLabel(f); labelCounts[l] = (labelCounts[l] || 0) + 1; });
    const labelFor = f => (labelCounts[bareLabel(f)] > 1 && f._group) ? `${f._group}: ${bareLabel(f)}` : bareLabel(f);

    const multiClass = mine.length > 1;
    const headers = ['Roll', 'Name', ...(multiClass ? ['Class'] : []), ...usedFields.map(labelFor)];
    const rows = roster.map(s => {
      const data = subByStudent[s.student_id] || {};
      return [s.roll || '', s.student_name || '', ...(multiClass ? [s.classKey] : []), ...usedFields.map(f => data[f.data_key] ?? '')];
    });
    // Index-aligned with `rows` (not keyed by student_id — it isn't a visible
    // column here) so the teacher's "Sort by" control can re-order both
    // together without another round-trip; Roll/Name are already visible
    // columns, class/section/gender are not.
    const sortMeta = roster.map(s => ({ roll: s.roll, student_name: s.student_name, class: s.class, section: s.section, group: s.group, gender: s.gender }));
    // Index-aligned with `rows`, same reasoning as sort_meta above — lets the
    // teacher filter to Filled/Not Filled client-side with no extra round-trip.
    const filled = roster.map(s => submittedIds.has(String(s.student_id)));
    return { headers, rows, tab_name: tabName, sort_meta: sortMeta, filled };
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
        extraCriteria: a.extraCriteria || {},
      }));
    if (!mine.length) return { error: 'Not authorized for this student.' };

    const studentRows = await _sbStudent(`students_data?student_id=eq.${encodeURIComponent(studentId)}&select=*`);
    const student = Array.isArray(studentRows) && studentRows[0];
    if (!student) return { error: 'Student not found.' };

    // A scoped combo (e.g. {"session":"2026"}) means this teacher is only
    // authorized for students matching that value too -- not every student
    // in the raw class+section, which can span multiple overlapping cohorts.
    const isMine = mine.some(m => m.studentClass === student.class && m.studentSection === student.section &&
      Object.entries(m.extraCriteria).every(([k, v]) => String(student[k] ?? '') === String(v)));
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

  async getMyInventoryNotifications([userId]) {
    if (!userId) return { rows: [] };
    const rows = await _invReq(`inventory_notifications?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=30`);
    return { rows: Array.isArray(rows) ? rows : [] };
  },

  async markInventoryNotificationRead([id]) {
    if (!id) return { result: 'error' };
    const r = await _invReq(`inventory_notifications?id=eq.${id}`, 'PATCH', { is_read: true });
    return { result: r?.error ? 'error' : 'success' };
  },

  // ── LESSON PLAN ──────────────────────────────────────────────────────────
  // Teacher-authored lesson plans (Bloom's Taxonomy + 5E Model format). Any
  // teacher can mark their own plan "shared" so others can browse and reuse
  // it — but editing someone ELSE's shared plan always forks into a new row
  // under the editor's own name (see saveLessonPlan) rather than overwriting
  // the original author's plan. Enforced here server-side, not trusted to
  // the client, matching this file's usual authorization pattern.

  async getLessonPlans([callerId, scope, filters]) {
    if (!callerId) return { error: 'Not signed in.' };
    const f = filters || {};
    // 'all' is Admin/Cord-only — every plan regardless of author/shared
    // status, so Admin can search, review, and manage the whole school's
    // lesson plans (duplicate cleanup, ownership reassignment, etc.), not
    // just their own + whatever's been explicitly shared.
    const wantsAll = scope === 'all';
    if (wantsAll && !(await _isCordOrAdmin(callerId))) return { error: 'Admin access required.' };
    let path = 'lesson_plans?select=id,class_name,subject,version,chapter,lesson_number,lesson_refs,topic,is_shared,created_by,forked_from_id,updated_at,youtube_url,lesson_code,class_date,period';
    if (wantsAll) {
      // no visibility filter — every row
    } else {
      path += scope === 'shared'
        ? `&is_shared=eq.true&created_by=neq.${encodeURIComponent(callerId)}`
        : `&created_by=eq.${encodeURIComponent(callerId)}`;
    }
    if (f.class_name) path += `&class_name=eq.${encodeURIComponent(f.class_name)}`;
    if (f.version) path += `&version=eq.${encodeURIComponent(f.version)}`;
    if (f.subject) path += `&subject=eq.${encodeURIComponent(f.subject)}`;
    if (f.chapter) path += `&chapter=eq.${encodeURIComponent(f.chapter)}`;
    if (f.owner) path += `&created_by=eq.${encodeURIComponent(f.owner)}`;
    if (f.search) {
      const term = String(f.search).trim();
      if (term) path += `&or=(topic.ilike.*${encodeURIComponent(term)}*,chapter.ilike.*${encodeURIComponent(term)}*,lesson_code.ilike.*${encodeURIComponent(term)}*)`;
    }
    const countPath = path.replace('select=id,class_name,subject,version,chapter,lesson_number,lesson_refs,topic,is_shared,created_by,forked_from_id,updated_at,youtube_url,lesson_code,class_date,period', 'select=id');
    path += '&order=updated_at.desc&limit=500';
    const [rows, totalCount] = await Promise.all([supabaseRequest(path), _countRows(countPath)]);
    if (rows?.error) return { error: rows.details || rows.error };
    const list = Array.isArray(rows) ? rows : [];

    // Uploader display names — only needed for the Shared Library and Admin's
    // All Plans view (My Plans is always the caller themselves), same
    // profile-join pattern as getAllUsersWithPresence.
    if ((scope === 'shared' || wantsAll) && list.length) {
      const ids = [...new Set(list.map(r => r.created_by))];
      const profiles = await supabaseRequest(`users_profile?teacher_id=in.(${ids.map(encodeURIComponent).join(',')})&select=teacher_id,full_name`);
      const nameById = {};
      if (Array.isArray(profiles)) profiles.forEach(p => { nameById[p.teacher_id] = p.full_name; });
      list.forEach(r => { r.uploaded_by_name = nameById[r.created_by] || r.created_by; });
    }
    return { result: 'success', plans: list, total: totalCount != null ? totalCount : list.length };
  },

  // Owner dropdown for the search-by-owner filter and the Admin ownership
  // reassignment picker — distinct authors among lesson plans this caller
  // can see (their own + shared) for regular teachers, or literally every
  // author school-wide for Admin/Cord.
  async getLessonPlanOwners([callerId, scope]) {
    if (!callerId) return { error: 'Not signed in.' };
    const isAdmin = await _isCordOrAdmin(callerId);
    const visibility = (scope === 'all' && isAdmin)
      ? ''
      : `&or=(created_by.eq.${encodeURIComponent(callerId)},is_shared.eq.true)`;
    const rows = await supabaseRequest(`lesson_plans?select=created_by${visibility}`);
    if (rows?.error) return { error: rows.details || rows.error };
    const ids = [...new Set((Array.isArray(rows) ? rows : []).map(r => r.created_by).filter(Boolean))];
    if (!ids.length) return { result: 'success', owners: [] };
    const profiles = await supabaseRequest(`users_profile?teacher_id=in.(${ids.map(encodeURIComponent).join(',')})&select=teacher_id,full_name`);
    const nameById = {};
    if (Array.isArray(profiles)) profiles.forEach(p => { nameById[p.teacher_id] = p.full_name; });
    const owners = ids.map(id => ({ id, name: nameById[id] || id })).sort((a, b) => a.name.localeCompare(b.name));
    return { result: 'success', owners };
  },

  // Admin/Cord-only: reassign an existing lesson plan to a different owner,
  // e.g. correcting a plan that was authored/imported under the wrong
  // teacher's account. Plain patch of created_by — the plan's content is
  // untouched.
  async reassignLessonPlanOwner([callerId, planId, newOwnerId]) {
    if (!callerId || !planId || !newOwnerId) return { result: 'error', message: 'Missing plan or new owner.' };
    if (!(await _isCordOrAdmin(callerId))) return { result: 'error', message: 'Admin access required.' };
    const updated = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(planId)}`, 'patch', { created_by: newOwnerId });
    if (updated?.error) return { result: 'error', message: updated.details || updated.error };
    if (!updated[0]) return { result: 'error', message: 'Lesson plan not found.' };
    return { result: 'success', plan: updated[0] };
  },

  // Duplicate-lesson-plan finder. Two plans are treated as duplicates when
  // they share Class+Subject+Version+Chapter+Lesson Number (the natural key
  // a lesson plan should be unique on) — a common artifact of repeated JSON/
  // Excel bulk imports or the same lesson entered twice by hand. Admin/Cord
  // see duplicates across the whole school; a regular teacher only sees
  // duplicates among their own plans, since that's the only set they're
  // allowed to clean up themselves.
  async getLessonPlanDuplicates([callerId]) {
    if (!callerId) return { error: 'Not signed in.' };
    const isAdmin = await _isCordOrAdmin(callerId);
    const visibility = isAdmin ? '' : `&created_by=eq.${encodeURIComponent(callerId)}`;
    const rows = await supabaseRequest(`lesson_plans?select=id,class_name,subject,version,chapter,lesson_number,topic,created_by,updated_at,is_shared${visibility}`);
    if (rows?.error) return { error: rows.details || rows.error };
    const list = Array.isArray(rows) ? rows : [];
    const groups = {};
    list.forEach(r => {
      if (!r.class_name || !r.subject || !r.chapter || !r.lesson_number) return;
      const key = [r.class_name, r.subject, r.version || '', r.chapter, r.lesson_number].join('||');
      (groups[key] = groups[key] || []).push(r);
    });
    const dupGroups = Object.values(groups).filter(g => g.length > 1);
    if (!dupGroups.length) return { result: 'success', groups: [] };
    const ids = [...new Set(dupGroups.flat().map(r => r.created_by).filter(Boolean))];
    const profiles = ids.length ? await supabaseRequest(`users_profile?teacher_id=in.(${ids.map(encodeURIComponent).join(',')})&select=teacher_id,full_name`) : [];
    const nameById = {};
    if (Array.isArray(profiles)) profiles.forEach(p => { nameById[p.teacher_id] = p.full_name; });
    dupGroups.forEach(g => g.forEach(r => { r.owner_name = nameById[r.created_by] || r.created_by; }));
    dupGroups.sort((a, b) => b.length - a.length);
    return { result: 'success', groups: dupGroups.map(g => ({
      class_name: g[0].class_name, subject: g[0].subject, version: g[0].version,
      chapter: g[0].chapter, lesson_number: g[0].lesson_number, count: g.length, plans: g,
    })) };
  },

  async getLessonPlan([callerId, id]) {
    if (!callerId || !id) return { error: 'Missing plan id.' };
    const rows = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(id)}&select=*`);
    if (rows?.error) return { error: rows.details || rows.error };
    const plan = Array.isArray(rows) && rows[0];
    if (!plan) return { error: 'Lesson plan not found.' };
    if (plan.created_by !== callerId && !plan.is_shared) return { error: 'This lesson plan is private to its author.' };
    return { result: 'success', plan };
  },

  // Distinct values already in use, scoped to whatever this caller can see
  // (their own plans + anyone's shared ones) — powers the Class/Subject/
  // Version/Chapter autocomplete instead of a separate master-data table
  // (mirrors _productAttributeOptions in the Inventory module).
  async getLessonPlanFieldOptions([callerId]) {
    if (!callerId) return { error: 'Not signed in.' };
    const rows = await supabaseRequest(`lesson_plans?or=(created_by.eq.${encodeURIComponent(callerId)},is_shared.eq.true)&select=class_name,subject,version,chapter`);
    if (rows?.error) return { error: rows.details || rows.error };
    const list = Array.isArray(rows) ? rows : [];
    const uniq = key => [...new Set(list.map(r => r[key]).filter(Boolean))].sort();
    return {
      result: 'success',
      class_name: uniq('class_name'),
      subject: uniq('subject'),
      version: uniq('version'),
      chapter: uniq('chapter'),
    };
  },

  // Cascading list-filter options — Class → Version → Subject → Chapter,
  // each level's dropdown scoped to only the values that actually appear
  // among lesson plans matching the levels already picked (and the current
  // scope: 'mine' or 'shared', same visibility rule as getLessonPlans
  // itself) — never a static/global list, so a filter never offers a combo
  // with zero results. Four small parallel queries rather than one big
  // fetch-everything-and-slice-client-side, since the visible list can run
  // into the hundreds of rows (see getLessonPlans' limit=500).
  async getLessonPlanFilterOptions([callerId, scope, filters]) {
    if (!callerId) return { error: 'Not signed in.' };
    const f = filters || {};
    const visibility = scope === 'shared'
      ? `is_shared=eq.true&created_by=neq.${encodeURIComponent(callerId)}`
      : `created_by=eq.${encodeURIComponent(callerId)}`;
    const buildPath = (col, precedingFilters) => {
      let path = `lesson_plans?select=${col}&${visibility}`;
      precedingFilters.forEach(([k, v]) => { if (v) path += `&${k}=eq.${encodeURIComponent(v)}`; });
      return path;
    };
    const uniq = (rows, key) => Array.isArray(rows) ? [...new Set(rows.map(r => r[key]).filter(Boolean))].sort() : [];

    const classRows = await supabaseRequest(buildPath('class_name', []));
    if (classRows?.error) return { error: classRows.details || classRows.error };
    const result = { result: 'success', class_name: uniq(classRows, 'class_name'), version: [], subject: [], chapter: [] };
    if (!f.class_name) return result;

    const versionRows = await supabaseRequest(buildPath('version', [['class_name', f.class_name]]));
    if (versionRows?.error) return { error: versionRows.details || versionRows.error };
    result.version = uniq(versionRows, 'version');
    if (!f.version) return result;

    const subjectRows = await supabaseRequest(buildPath('subject', [['class_name', f.class_name], ['version', f.version]]));
    if (subjectRows?.error) return { error: subjectRows.details || subjectRows.error };
    result.subject = uniq(subjectRows, 'subject');
    if (!f.subject) return result;

    const chapterRows = await supabaseRequest(buildPath('chapter', [['class_name', f.class_name], ['version', f.version], ['subject', f.subject]]));
    if (chapterRows?.error) return { error: chapterRows.details || chapterRows.error };
    result.chapter = uniq(chapterRows, 'chapter');
    return result;
  },

  // One-time cleanup for lesson plans imported BEFORE the JSON-import
  // pipeline started stripping NotebookLM's inline citation markers (e.g.
  // "...আলোচনা করা [১০৪]।" or "...discussed [104]."; see _lpStripRefNumbers
  // client-side, which now strips these going forward). Re-runs the same
  // strip against every already-saved row's free-text fields, patching only
  // rows that actually had a marker — safe to re-run any time, a no-op once
  // the data's clean. Admin/Cord-only since it rewrites other teachers'
  // plans too.
  async cleanupLessonPlanReferenceNumbers([callerId]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    if (!(await _isCordOrAdmin(callerId))) return { result: 'error', message: 'Admin access required.' };
    const strip = s => (typeof s === 'string' ? s.replace(/\s*\[[0-9০-৯]+\]/g, '').trim() : s);
    const rows = await supabaseRequest('lesson_plans?select=id,topic,chapter,teaching_aids,method,learning_outcomes,phases');
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const list = Array.isArray(rows) ? rows : [];
    let fixed = 0;
    for (const r of list) {
      const patch = {};
      const topic = strip(r.topic); if (topic !== r.topic) patch.topic = topic;
      const chapter = strip(r.chapter); if (chapter !== r.chapter) patch.chapter = chapter;
      const teachingAids = strip(r.teaching_aids); if (teachingAids !== r.teaching_aids) patch.teaching_aids = teachingAids;
      const method = strip(r.method); if (method !== r.method) patch.method = method;
      const outcomes = strip(r.learning_outcomes); if (outcomes !== r.learning_outcomes) patch.learning_outcomes = outcomes;
      if (Array.isArray(r.phases)) {
        let phasesChanged = false;
        const phases = r.phases.map(p => {
          const ta = strip(p && p.teacher_activity), la = strip(p && p.learner_activity);
          if (p && (ta !== p.teacher_activity || la !== p.learner_activity)) { phasesChanged = true; return { ...p, teacher_activity: ta, learner_activity: la }; }
          return p;
        });
        if (phasesChanged) patch.phases = phases;
      }
      if (Object.keys(patch).length) {
        const updated = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(r.id)}`, 'patch', patch);
        if (!updated?.error) fixed++;
      }
    }
    return { result: 'success', scanned: list.length, fixed };
  },

  // Chapter dropdown options for the web form's cascading picker — scoped to
  // one Class+Subject+Version combo (unlike getLessonPlanFieldOptions above,
  // which returns every chapter ever used, globally). Sourced from
  // lesson_curricula (the authoritative breakdown table) unioned with
  // whatever's already in lesson_plans for that combo, so the dropdown works
  // even before a formal curriculum breakdown exists.
  async getChapterOptions([callerId, class_name, subject, version]) {
    if (!callerId) return { error: 'Not signed in.' };
    if (!class_name || !subject) return { result: 'success', chapters: [] };
    const versionFilter = version ? `&version=eq.${encodeURIComponent(version)}` : '';
    const [curricula, plans] = await Promise.all([
      supabaseRequest(`lesson_curricula?class_name=eq.${encodeURIComponent(class_name)}&subject=eq.${encodeURIComponent(subject)}${versionFilter}&select=chapter`),
      supabaseRequest(`lesson_plans?class_name=eq.${encodeURIComponent(class_name)}&subject=eq.${encodeURIComponent(subject)}${versionFilter}&or=(created_by.eq.${encodeURIComponent(callerId)},is_shared.eq.true)&select=chapter`),
    ]);
    const chapters = new Set();
    if (Array.isArray(curricula)) curricula.forEach(r => { if (r.chapter) chapters.add(r.chapter); });
    if (Array.isArray(plans)) plans.forEach(r => { if (r.chapter) chapters.add(r.chapter); });
    return { result: 'success', chapters: [...chapters].sort() };
  },

  async saveLessonPlan([callerId, planId, payload]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const p = payload || {};
    // lesson_refs (new, multi-chapter-capable UI) is the source of truth when
    // present: [{ chapter, lesson_numbers: [1,2] }, ...]. chapter/lesson_number
    // stay as flat columns, auto-derived from the first ref, so every existing
    // display/filter/autocomplete path (and older callers like bulk import that
    // still send flat chapter/lesson_number directly) keeps working unchanged.
    const lessonRefs = Array.isArray(p.lesson_refs) ? p.lesson_refs.filter(r => r && r.chapter) : [];
    const primaryChapter = p.chapter || (lessonRefs[0] && lessonRefs[0].chapter) || '';
    const primaryLessonNumber = p.lesson_number || (lessonRefs[0] && Array.isArray(lessonRefs[0].lesson_numbers) && lessonRefs[0].lesson_numbers[0]) || null;
    if (!p.class_name || !p.subject || !primaryChapter) {
      return { result: 'error', message: 'Class, Subject, and Chapter are required.' };
    }
    const row = {
      class_name: p.class_name, subject: p.subject, version: p.version || null,
      chapter: primaryChapter, lesson_number: primaryLessonNumber, topic: p.topic || null,
      time_minutes: p.time_minutes || null, teaching_aids: p.teaching_aids || null,
      method: p.method || null, learning_outcomes: p.learning_outcomes || null,
      phases: p.phases || null, self_reflection: p.self_reflection || null,
      is_shared: !!p.is_shared, source: p.source || 'web', lesson_refs: lessonRefs,
      youtube_url: p.youtube_url || null, lesson_code: (p.lesson_code || '').trim() || null,
      class_date: p.class_date || null, period: (p.period || '').trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (!planId) {
      // p.forked_from_id is set by the client's "Duplicate" action (teacher
      // voluntarily starting a new plan from an existing one, own or shared) —
      // distinct from the automatic fork below, which triggers on editing
      // someone else's plan without an explicit duplicate step.
      const created = await supabaseRequest('lesson_plans', 'post', { ...row, created_by: callerId, forked_from_id: p.forked_from_id || null });
      if (created?.error) return { result: 'error', message: created.details || created.error };
      _createSystemForumPost(callerId, `📝 New lesson plan created: ${_forumLessonPlanSummary(row)}`, { lesson_plan_id: created[0] && created[0].id, action: 'created' });
      return { result: 'success', plan: created[0], forked: false };
    }

    const existingRows = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(planId)}&select=id,created_by`);
    if (existingRows?.error) return { result: 'error', message: existingRows.details || existingRows.error };
    const existing = Array.isArray(existingRows) && existingRows[0];
    if (!existing) return { result: 'error', message: 'Lesson plan not found.' };

    // Admin/Cord editing someone else's plan (e.g. fixing a duplicate or a
    // data-entry mistake flagged in the Duplicates view) edits in place,
    // same as the author would — an Admin correction isn't a new plan.
    if (existing.created_by === callerId || await _isCordOrAdmin(callerId)) {
      const updated = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(planId)}`, 'patch', row);
      if (updated?.error) return { result: 'error', message: updated.details || updated.error };
      return { result: 'success', plan: updated[0], forked: false };
    }

    // Editing a plan that isn't the caller's own — never overwrite the
    // original author's row. Fork it: a brand new row owned by the caller,
    // starting private (they can choose to share their own copy).
    const forked = await supabaseRequest('lesson_plans', 'post', {
      ...row, is_shared: false, created_by: callerId, forked_from_id: planId,
    });
    if (forked?.error) return { result: 'error', message: forked.details || forked.error };
    _createSystemForumPost(callerId, `📝 New lesson plan created: ${_forumLessonPlanSummary(row)}`, { lesson_plan_id: forked[0] && forked[0].id, action: 'forked' });
    return { result: 'success', plan: forked[0], forked: true };
  },

  async deleteLessonPlan([callerId, id]) {
    if (!callerId || !id) return { result: 'error', message: 'Missing plan id.' };
    const rows = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(id)}&select=created_by`);
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const plan = Array.isArray(rows) && rows[0];
    if (!plan) return { result: 'error', message: 'Lesson plan not found.' };
    if (plan.created_by !== callerId && !(await _isCordOrAdmin(callerId))) {
      return { result: 'error', message: 'Only the author (or an Admin) can delete this lesson plan.' };
    }
    const deleted = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(id)}`, 'delete');
    if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    return { result: 'success' };
  },

  // Multi-select delete — used by the Duplicates view's "select all" +
  // delete flow, so cleaning up a whole batch of near-identical imported
  // plans doesn't take one confirm-click per row. Same per-row permission
  // rule as the single-delete RPC (author or Admin/Cord); ids the caller
  // isn't allowed to delete are silently skipped and reported back rather
  // than failing the whole batch.
  async deleteLessonPlansBulk([callerId, ids]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!list.length) return { result: 'error', message: 'No lesson plans selected.' };
    const isAdmin = await _isCordOrAdmin(callerId);
    const rows = await supabaseRequest(`lesson_plans?id=in.(${list.map(encodeURIComponent).join(',')})&select=id,created_by`);
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const allowedIds = (Array.isArray(rows) ? rows : []).filter(r => isAdmin || r.created_by === callerId).map(r => r.id);
    if (!allowedIds.length) return { result: 'error', message: 'You are not allowed to delete any of the selected plans.' };
    const deleted = await supabaseRequest(`lesson_plans?id=in.(${allowedIds.map(encodeURIComponent).join(',')})`, 'delete');
    if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    return { result: 'success', deletedCount: allowedIds.length, skippedCount: list.length - allowedIds.length };
  },

  // Bulk import (100-1000+ plans from a single Excel file, one row per
  // plan — see the client's _lpBulk* functions for the column-mapping UI).
  // Chunked so a single huge file can't blow past PostgREST/Vercel payload
  // or timeout limits; each chunk's failure is reported without aborting
  // the rest, so one bad row doesn't sink the whole import.
  async bulkImportLessonPlans([callerId, rows]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { result: 'error', message: 'No rows to import.' };

    const CHUNK_SIZE = 200;
    let inserted = 0, failed = 0;
    const errors = [];
    const importSummary = {}; // { 'Class · Subject': { Chapter: count, ... } }
    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE)
        .filter(p => p && p.class_name && p.subject && p.chapter)
        .map(p => ({
          class_name: p.class_name, subject: p.subject, version: p.version || null,
          chapter: p.chapter, lesson_number: p.lesson_number || null,
          lesson_refs: Array.isArray(p.lesson_refs) ? p.lesson_refs : [],
          topic: p.topic || null, time_minutes: p.time_minutes || null,
          teaching_aids: p.teaching_aids || null, method: p.method || null,
          learning_outcomes: p.learning_outcomes || null, phases: p.phases || null,
          self_reflection: p.self_reflection || null, is_shared: !!p.is_shared,
          source: p.source || 'bulk_excel', created_by: callerId,
        }));
      if (!chunk.length) continue;
      const created = await supabaseRequest('lesson_plans', 'post', chunk);
      if (created?.error) {
        failed += chunk.length;
        errors.push(`Rows ${i + 1}-${i + chunk.length}: ${created.details || created.error}`);
      } else {
        inserted += Array.isArray(created) ? created.length : chunk.length;
        (Array.isArray(created) ? created : []).forEach(r => {
          const key = `${r.class_name || '?'} · ${r.subject || '?'}`;
          const chapter = r.chapter || '?';
          if (!importSummary[key]) importSummary[key] = {};
          importSummary[key][chapter] = (importSummary[key][chapter] || 0) + 1;
        });
      }
    }
    // One summary post for the whole import, not one per row — e.g.
    // "📥 Imported 81 lesson plan(s): Six · Science: Chapter One (9), ..."
    if (inserted > 0) {
      const parts = Object.entries(importSummary).map(([key, chapters]) =>
        `${key}: ${Object.entries(chapters).map(([c, n]) => `${c} (${n})`).join(', ')}`);
      const isNotebookLm = list.some(r => r && r.source === 'notebooklm_import');
      _createSystemForumPost(callerId, `${isNotebookLm ? '🤖' : '📥'} Imported ${inserted} lesson plan(s) — ${parts.join(' | ')}`, { action: 'imported', inserted, source: isNotebookLm ? 'notebooklm_import' : 'bulk_excel' });
    }
    return { result: failed ? 'partial' : 'success', inserted, failed, errors };
  },

  // ── FORUM ────────────────────────────────────────────────────────────────
  // A staff-wide social feed: posts (post/question/fact/birthday/thanks/
  // greeting), threaded replies (one level of nesting via parent_reply_id),
  // emoji reactions, @mentions, and photos (client pre-compresses to ~130KB
  // before calling uploadForumPhoto). Human posts broadcast a notification
  // to every user (plus an extra @mention notification for tagged users);
  // system posts (is_system:true, created via _createSystemForumPost above)
  // never do. Posts "expire" after 4 months with no reply/reaction — see
  // getForumPosts' activity filter and cleanupExpiredForumPosts below; there
  // is no cron in this app, so cleanup runs opportunistically, throttled
  // client-side to once/day (see _forumMaybeCleanup in _src/app.js).

  // General file attachments (any type, up to 50MB, expire after 1 month —
  // independent of the post's own 4-month reply/reaction-inactivity expiry,
  // see cleanupExpiredForumPosts). Large files can't go through the base64-
  // JSON /api/exec gateway (Vercel body-size limit), so this only issues a
  // signed upload URL — the browser does the actual PUT straight to
  // Supabase Storage via _sbClient.storage.from('forum').uploadToSignedUrl().
  async getForumFileUploadUrl([callerId, filename, sizeBytes]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const MAX_BYTES = 50 * 1024 * 1024;
    if (Number(sizeBytes) > MAX_BYTES) return { result: 'error', message: 'Files must be 50MB or smaller.' };
    const safeName = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `${callerId}/files/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const signed = await supabaseCreateSignedUploadUrl('forum', path);
    if (signed?.error) return { result: 'error', message: signed.details || signed.error };
    return { result: 'success', path: signed.path, token: signed.token, url: supabaseStoragePublicUrl('forum', path) };
  },

  // Powers the Student-section composer's audience picker — live search over
  // students_data (columns confirmed via class_teacher_assignments/portal
  // code elsewhere: student_id, student_name, class, section, roll,
  // session), returning just enough to render "id — name" checkboxes.
  async searchStudentsForAudience([callerId, filters]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const f = filters || {};
    if (!f.class) return { result: 'success', students: [] };
    let path = `students_data?select=student_id,student_name,class,section,roll,session&class=eq.${encodeURIComponent(f.class)}&order=roll.asc&limit=300`;
    if (f.section) path += `&section=eq.${encodeURIComponent(f.section)}`;
    if (f.session) path += `&session=eq.${encodeURIComponent(f.session)}`;
    if (f.roll) path += `&roll=eq.${encodeURIComponent(f.roll)}`;
    // students_data lives in the separate `student` Postgres schema, not
    // `teacher_staff` — supabaseRequest() always targets `teacher_staff`, so
    // this needs the cross-schema helper (_sbStudent, already used by the
    // class-teacher handlers elsewhere in this file) instead.
    const rows = await _sbStudent(path);
    return { result: 'success', students: Array.isArray(rows) ? rows : [] };
  },

  // Distinct Class → [Sections] straight from real student records, for
  // audience-picker dropdowns (Diary, and anywhere else that targets a
  // class/section) — never a static list, so a class with no students
  // enrolled yet just doesn't appear rather than offering a dead end.
  async getClassSectionOptions([callerId]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const rows = await _sbStudent('students_data?select=class,section&limit=10000');
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const byClass = {};
    (Array.isArray(rows) ? rows : []).forEach(r => {
      if (!r.class) return;
      const set = byClass[r.class] || (byClass[r.class] = new Set());
      if (r.section) set.add(r.section);
    });
    const classes = Object.keys(byClass).sort();
    const sections = {};
    classes.forEach(c => { sections[c] = [...byClass[c]].sort(); });
    return { result: 'success', classes, sections };
  },

  async uploadForumPhoto([callerId, dataUrl, filename]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!match) return { result: 'error', message: 'Invalid image data.' };
    const [, contentType, base64] = match;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 200 * 1024) return { result: 'error', message: 'Photo is larger than expected after compression — please retry.' };
    const safeName = String(filename || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    const path = `${callerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const uploaded = await supabaseStorageUpload('forum', path, buffer, contentType);
    if (uploaded?.error) return { result: 'error', message: uploaded.details || uploaded.error };
    return { result: 'success', url: supabaseStoragePublicUrl('forum', path), path };
  },

  async createForumPost([callerId, payload]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const p = payload || {};
    const body = String(p.body || '').trim();
    const photoUrls = Array.isArray(p.photo_urls) ? p.photo_urls.slice(0, 6) : [];
    const fileAttachments = Array.isArray(p.file_attachments) ? p.file_attachments.slice(0, 5).map(f => ({
      name: f.name, path: f.path, url: f.url, size_bytes: f.size_bytes, uploaded_at: new Date().toISOString(),
    })) : [];
    if (!body && !photoUrls.length && !fileAttachments.length) return { result: 'error', message: 'Write something, or add a photo/file first.' };

    // Light anti-spam guard — one post per 10 seconds per user, not a hard
    // rate limit, just enough to stop accidental double-submits/spam-clicks.
    const recent = await supabaseRequest(`forum_posts?author_id=eq.${encodeURIComponent(callerId)}&is_system=eq.false&order=created_at.desc&limit=1&select=created_at`);
    if (Array.isArray(recent) && recent[0] && (Date.now() - new Date(recent[0].created_at).getTime()) < 10000) {
      return { result: 'error', message: 'Please wait a few seconds before posting again.' };
    }

    const taggedIds = Array.isArray(p.tagged_user_ids) ? [...new Set(p.tagged_user_ids.filter(Boolean))] : [];
    // 'system' is reserved for _createSystemForumPost — a human-authored
    // post can never claim that section, no matter what the client sends.
    const section = ['teacher', 'student'].includes(p.section) ? p.section : 'teacher';
    const audience = (section === 'student' && p.audience && p.audience.class) ? {
      mode: p.audience.mode || 'class', session: p.audience.session || null,
      class: p.audience.class, section: p.audience.section || null,
      student_ids: Array.isArray(p.audience.student_ids) ? p.audience.student_ids.map(String) : [],
    } : {};
    if (section === 'student' && !audience.class) return { result: 'error', message: 'Pick a Class (and optionally Section) for who this post is for.' };
    const now = new Date().toISOString();
    const created = await supabaseRequest('forum_posts', 'post', {
      author_id: callerId, post_type: p.post_type || 'post', body: body || null,
      photo_urls: photoUrls, file_attachments: fileAttachments, tagged_user_ids: taggedIds,
      is_system: false, is_pinned: false, section, audience,
      last_activity_at: now, created_at: now,
    });
    if (created?.error) return { result: 'error', message: created.details || created.error };
    const post = created[0];

    // Broadcast to everyone for a Teacher-section post (plus a distinct
    // @mention notification for tagged users); a Student-section post only
    // notifies whoever can actually see it — Admin/VP/Cord plus the class
    // teacher(s) of the targeted class/section — never a school-wide blast
    // about one class's content. Fire-and-forget either way.
    const bodyPreview = body ? (body.length > 100 ? body.slice(0, 100) + '…' : body) : 'shared a photo';
    if (section === 'student') {
      const [moderatorIds, classTeacherRows] = await Promise.all([
        supabaseRequest(`app_users?select=user_id,role`).then(rows => (Array.isArray(rows) ? rows : []).filter(u => String(u.role || '').split(',').map(r => r.trim()).some(r => ['Admin', 'VP', 'Cord'].includes(r))).map(u => u.user_id)),
        supabaseRequest(`class_teacher_assignments?class=eq.${encodeURIComponent(audience.class)}&select=user_id,section`),
      ]);
      const relevantTeacherIds = (Array.isArray(classTeacherRows) ? classTeacherRows : [])
        .filter(a => !audience.section || !a.section || a.section === audience.section)
        .map(a => a.user_id);
      const recipients = [...new Set([...moderatorIds, ...relevantTeacherIds, ...taggedIds])].filter(id => id !== callerId);
      _forumNotify(recipients, {
        type: 'forum_post', title: `New Student Forum Post — ${audience.class}${audience.section ? '/' + audience.section : ''}`,
        message: bodyPreview, data: { post_id: post.id },
      });

      // Also notify the actual targeted students — resolved from the
      // audience (explicit student_ids for "students" mode, or every
      // student_id matching the class/class+section for the other two
      // modes) — using the same 'student:<id>' identity prefix
      // getStudentMessageThreads/direct_messages already rely on. Student-
      // side notification reading happens in the separate ccpc-students
      // app; this just writes the row with the same data.post_id a click-
      // through needs, in the same shared `notifications` table.
      let targetStudentIds = audience.student_ids || [];
      if (audience.mode !== 'students') {
        let path = `students_data?select=student_id&class=eq.${encodeURIComponent(audience.class)}`;
        if (audience.section) path += `&section=eq.${encodeURIComponent(audience.section)}`;
        const students = await _sbStudent(path);
        targetStudentIds = (Array.isArray(students) ? students : []).map(s => String(s.student_id));
      }
      if (targetStudentIds.length) {
        _forumNotify(targetStudentIds.map(id => 'student:' + id), {
          type: 'forum_post', title: `New Forum Post — ${audience.class}${audience.section ? '/' + audience.section : ''}`,
          message: bodyPreview, data: { post_id: post.id },
        });
      }
    } else {
      const allIds = await _forumAllUserIds();
      const others = allIds.filter(id => id !== callerId);
      _forumNotify(others.filter(id => !taggedIds.includes(id)), {
        type: 'forum_post', title: 'New Forum Post', message: bodyPreview, data: { post_id: post.id },
      });
      if (taggedIds.length) {
        _forumNotify(taggedIds, {
          type: 'forum_mention', title: 'You were tagged in a forum post',
          message: body ? (body.length > 100 ? body.slice(0, 100) + '…' : body) : 'tagged you in a photo post',
          data: { post_id: post.id },
        });
      }
    }
    return { result: 'success', post };
  },

  async editForumPost([callerId, postId, body]) {
    if (!callerId || !postId) return { result: 'error', message: 'Missing post id.' };
    const rows = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}&select=author_id,is_system`);
    const post = Array.isArray(rows) && rows[0];
    if (!post) return { result: 'error', message: 'Post not found.' };
    if (post.author_id !== callerId) return { result: 'error', message: 'Only the author can edit this post.' };
    const updated = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}`, 'patch', {
      body: String(body || '').trim() || null, edited_at: new Date().toISOString(),
    });
    if (updated?.error) return { result: 'error', message: updated.details || updated.error };
    return { result: 'success', post: updated[0] };
  },

  async deleteForumPost([callerId, postId]) {
    if (!callerId || !postId) return { result: 'error', message: 'Missing post id.' };
    const rows = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}&select=author_id,photo_urls,file_attachments`);
    const post = Array.isArray(rows) && rows[0];
    if (!post) return { result: 'error', message: 'Post not found.' };
    if (post.author_id !== callerId && !(await _isCordOrAdmin(callerId))) {
      return { result: 'error', message: 'Only the author (or an Admin) can delete this post.' };
    }
    const deleted = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}`, 'delete');
    if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    const paths = [...(post.photo_urls || []), ...(post.file_attachments || [])].map(u => (u.path || u)).filter(p => typeof p === 'string');
    if (paths.length) supabaseStorageRemove('forum', paths);
    return { result: 'success' };
  },

  // Admin/VP/Cord only — pins float to the top of the feed regardless of activity,
  // for durable announcements (school holiday notices etc).
  async pinForumPost([callerId, postId, pinned]) {
    if (!(await _isForumModerator(callerId))) return { result: 'error', message: 'Only an Admin, VP, or Cord can pin posts.' };
    const updated = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}`, 'patch', { is_pinned: !!pinned });
    if (updated?.error) return { result: 'error', message: updated.details || updated.error };
    return { result: 'success' };
  },

  // cursor = ISO timestamp of the last-seen post's created_at (or null for
  // page 1) — simple keyset pagination, newest first, pinned posts always
  // surface on page 1 above the fold regardless of recency.
  // sort: 'recent' (default, cursor-paginated on created_at) or 'popular'
  // (ordered by reaction_count/reply_count, offset-paginated instead — a
  // popularity ranking isn't a stable cursor key the way created_at is, so
  // switching sort modes switches pagination strategy too). Pinned posts
  // always come first regardless of sort. section='student' posts are
  // audience-restricted (see _forumCanSeeStudentPost) and filtered in JS
  // after the fetch since the visibility check needs the caller's own
  // class_teacher_assignments, which PostgREST can't join into one query.
  async getForumPosts([callerId, filters]) {
    const f = filters || {};
    const cutoff = new Date(Date.now() - 122 * 24 * 60 * 60 * 1000).toISOString(); // ~4 months
    const wantSection = f.section || null;
    const fetchLimit = wantSection === 'student' ? (f.limit || 20) * 3 : (f.limit || 20); // over-fetch since some rows get filtered out by visibility
    let path = `forum_posts?last_activity_at=gte.${cutoff}&select=*&limit=${fetchLimit}`;
    if (f.post_type) path += `&post_type=eq.${encodeURIComponent(f.post_type)}`;
    if (wantSection) path += `&section=eq.${encodeURIComponent(wantSection)}`;
    if (f.q) path += `&body=ilike.*${encodeURIComponent(String(f.q).replace(/[*]/g, ''))}*`;
    if (f.sort === 'popular') {
      path += `&order=is_pinned.desc,reaction_count.desc,reply_count.desc,created_at.desc&offset=${f.offset || 0}`;
    } else {
      path += `&order=is_pinned.desc,created_at.desc`;
      if (f.cursor) path += `&created_at=lt.${encodeURIComponent(f.cursor)}`;
    }
    const posts = await supabaseRequest(path);
    if (posts?.error) return { result: 'error', message: posts.details || posts.error };
    let list = Array.isArray(posts) ? posts : [];
    if (wantSection === 'student') {
      list = await _forumFilterStudentVisible(callerId, list);
      list = list.slice(0, f.limit || 20);
    }
    return { result: 'success', posts: list };
  },

  // Fetches a single post by id — used when a notification click needs to
  // jump straight to the post it's about, which might be many pages back in
  // the normal feed's pagination.
  async getForumPost([postId]) {
    if (!postId) return { result: 'error', message: 'Missing post id.' };
    const rows = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}&select=*`);
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const post = Array.isArray(rows) && rows[0];
    if (!post) return { result: 'error', message: 'This post no longer exists.' };
    return { result: 'success', post };
  },

  async getForumReplies([postId]) {
    if (!postId) return { result: 'error', message: 'Missing post id.' };
    const replies = await supabaseRequest(`forum_replies?post_id=eq.${encodeURIComponent(postId)}&select=*&order=created_at.asc`);
    if (replies?.error) return { result: 'error', message: replies.details || replies.error };
    return { result: 'success', replies: Array.isArray(replies) ? replies : [] };
  },

  async createForumReply([callerId, postId, parentReplyId, body, photoUrls, taggedUserIds]) {
    if (!callerId || !postId) return { result: 'error', message: 'Missing post id.' };
    const text = String(body || '').trim();
    const photos = Array.isArray(photoUrls) ? photoUrls.slice(0, 4) : [];
    if (!text && !photos.length) return { result: 'error', message: 'Write a reply first.' };
    const taggedIds = Array.isArray(taggedUserIds) ? [...new Set(taggedUserIds.filter(Boolean))] : [];
    const now = new Date().toISOString();
    const created = await supabaseRequest('forum_replies', 'post', {
      post_id: postId, parent_reply_id: parentReplyId || null, author_id: callerId,
      body: text, photo_urls: photos, tagged_user_ids: taggedIds, created_at: now,
    });
    if (created?.error) return { result: 'error', message: created.details || created.error };

    const postRows = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}&select=author_id,reply_count`);
    const post = Array.isArray(postRows) && postRows[0];
    await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}`, 'patch', {
      reply_count: ((post && post.reply_count) || 0) + 1, last_activity_at: now,
    });

    const notifyIds = new Set(taggedIds);
    if (post && post.author_id && post.author_id !== callerId) notifyIds.add(post.author_id);
    notifyIds.delete(callerId);
    if (notifyIds.size) {
      _forumNotify([...notifyIds], {
        type: 'forum_reply', title: 'New reply on a forum post',
        message: text ? (text.length > 100 ? text.slice(0, 100) + '…' : text) : 'replied with a photo',
        data: { post_id: postId },
      });
    }
    return { result: 'success', reply: created[0] };
  },

  async editForumReply([callerId, replyId, body]) {
    if (!callerId || !replyId) return { result: 'error', message: 'Missing reply id.' };
    const rows = await supabaseRequest(`forum_replies?id=eq.${encodeURIComponent(replyId)}&select=author_id`);
    const reply = Array.isArray(rows) && rows[0];
    if (!reply) return { result: 'error', message: 'Reply not found.' };
    if (reply.author_id !== callerId) return { result: 'error', message: 'Only the author can edit this reply.' };
    const updated = await supabaseRequest(`forum_replies?id=eq.${encodeURIComponent(replyId)}`, 'patch', {
      body: String(body || '').trim(), edited_at: new Date().toISOString(),
    });
    if (updated?.error) return { result: 'error', message: updated.details || updated.error };
    return { result: 'success', reply: updated[0] };
  },

  async deleteForumReply([callerId, replyId]) {
    if (!callerId || !replyId) return { result: 'error', message: 'Missing reply id.' };
    const rows = await supabaseRequest(`forum_replies?id=eq.${encodeURIComponent(replyId)}&select=author_id,post_id,photo_urls`);
    const reply = Array.isArray(rows) && rows[0];
    if (!reply) return { result: 'error', message: 'Reply not found.' };
    if (reply.author_id !== callerId && !(await _isCordOrAdmin(callerId))) {
      return { result: 'error', message: 'Only the author (or an Admin) can delete this reply.' };
    }
    const deleted = await supabaseRequest(`forum_replies?id=eq.${encodeURIComponent(replyId)}`, 'delete');
    if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    const postRows = await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(reply.post_id)}&select=reply_count`);
    const post = Array.isArray(postRows) && postRows[0];
    if (post) await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(reply.post_id)}`, 'patch', { reply_count: Math.max(0, (post.reply_count || 1) - 1) });
    const paths = (reply.photo_urls || []).map(u => (u.path || u)).filter(p => typeof p === 'string');
    if (paths.length) supabaseStorageRemove('forum', paths);
    return { result: 'success' };
  },

  // Toggle: reacting again with the same emoji removes it (matches the
  // unique(post_id,reply_id,user_id,emoji) constraint) — one click adds,
  // a second click of the same emoji retracts it.
  async toggleForumReaction([callerId, postId, replyId, emoji]) {
    if (!callerId || (!postId && !replyId)) return { result: 'error', message: 'Missing target.' };
    const targetCol = postId ? 'post_id' : 'reply_id';
    const targetId = postId || replyId;
    const existing = await supabaseRequest(`forum_reactions?${targetCol}=eq.${encodeURIComponent(targetId)}&user_id=eq.${encodeURIComponent(callerId)}&emoji=eq.${encodeURIComponent(emoji)}&select=id`);
    if (existing?.error) return { result: 'error', message: existing.details || existing.error };
    const table = postId ? 'forum_posts' : 'forum_replies';
    const countRows = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(targetId)}&select=${postId ? 'reaction_count' : 'id'}`);
    if (countRows?.error) return { result: 'error', message: countRows.details || countRows.error };
    const current = postId ? ((Array.isArray(countRows) && countRows[0] && countRows[0].reaction_count) || 0) : null;
    let removed = false;
    if (Array.isArray(existing) && existing.length) {
      const del = await supabaseRequest(`forum_reactions?id=eq.${encodeURIComponent(existing[0].id)}`, 'delete');
      if (del?.error) return { result: 'error', message: del.details || del.error };
      removed = true;
    } else {
      const ins = await supabaseRequest('forum_reactions', 'post', { post_id: postId || null, reply_id: replyId || null, user_id: callerId, emoji: emoji || '👍' });
      if (ins?.error) return { result: 'error', message: ins.details || ins.error };
    }
    if (postId) {
      await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(postId)}`, 'patch', {
        reaction_count: Math.max(0, current + (removed ? -1 : 1)), last_activity_at: new Date().toISOString(),
      });
    }
    return { result: 'success', removed };
  },

  // Client calls this at most once/day (localStorage-throttled) the first
  // time the Forum view mounts — actually deletes posts past the 4-month
  // inactivity cutoff and their Storage photos, reclaiming space. Expired
  // posts are already invisible via getForumPosts' activity filter before
  // this ever runs, so this is cleanup, not a correctness requirement.
  async cleanupExpiredForumPosts() {
    const postCutoff = new Date(Date.now() - 122 * 24 * 60 * 60 * 1000).toISOString(); // ~4 months
    const fileCutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();  // 1 month

    // Pass 1: whole posts past the 4-month inactivity cutoff — delete the
    // post (cascades to its replies/reactions) and every photo/file it held.
    const expired = await supabaseRequest(`forum_posts?last_activity_at=lt.${postCutoff}&select=id,photo_urls,file_attachments`);
    let removedPosts = 0;
    if (Array.isArray(expired) && expired.length) {
      const allPaths = expired.flatMap(p => [...(p.photo_urls || []), ...(p.file_attachments || [])].map(u => (u.path || u)).filter(x => typeof x === 'string'));
      if (allPaths.length) await supabaseStorageRemove('forum', allPaths);
      for (const p of expired) await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(p.id)}`, 'delete');
      removedPosts = expired.length;
    }

    // Pass 2: files attached to still-active posts, but the file itself is
    // past its own 1-month clock — strip just the file_attachments entry
    // and remove the object from Storage, leaving the rest of the post
    // (text, photos, replies) intact. Photos are exempt — they follow the
    // post's own 4-month activity clock, handled in Pass 1 above.
    const activePosts = await supabaseRequest(`forum_posts?last_activity_at=gte.${postCutoff}&select=id,file_attachments`);
    const withFiles = (Array.isArray(activePosts) ? activePosts : []).filter(p => Array.isArray(p.file_attachments) && p.file_attachments.length);
    let removedFiles = 0;
    for (const post of withFiles) {
      const keep = [], drop = [];
      for (const f of (post.file_attachments || [])) (new Date(f.uploaded_at).toISOString() < fileCutoff ? drop : keep).push(f);
      if (!drop.length) continue;
      const dropPaths = drop.map(f => f.path).filter(Boolean);
      if (dropPaths.length) await supabaseStorageRemove('forum', dropPaths);
      await supabaseRequest(`forum_posts?id=eq.${encodeURIComponent(post.id)}`, 'patch', { file_attachments: keep });
      removedFiles += drop.length;
    }

    return { result: 'success', removed: removedPosts, removedFiles };
  },

  // Fired client-side when a teacher uses Print/Export on a lesson plan
  // (that action never round-trips through the server otherwise, so this
  // is the one lesson-plan system-post hook that lives in the client rather
  // than inside saveLessonPlan/bulkImportLessonPlans).
  async logLessonPlanExport([callerId, planSummary]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const s = planSummary || {};
    _createSystemForumPost(callerId, `🖨️ Lesson plan exported/printed: ${_forumLessonPlanSummary(s)}`, { action: 'exported', lesson_plan_id: s.id || null });
    return { result: 'success' };
  },

  // ── LESSON CURRICULA ─────────────────────────────────────────────────────
  // The lecture-by-lecture breakdown of a chapter (class+version+subject+
  // chapter -> [{lecture_number, topic}]), used to power the Lecture picker
  // in the Lesson Plan form. Unlike lesson_plans (fork on any non-owner
  // edit), a curriculum row can be edited in place by ANY teacher while
  // is_editable=true — the whole point is collaborative refinement of a
  // shared syllabus breakdown. Only once it's marked not-editable (locked
  // by whoever set that) does a non-owner's edit fork into their own copy,
  // same mechanic as lesson_plans just gated on the flag instead of
  // ownership. Multiple curricula can exist for the same class+version+
  // subject+chapter (e.g. one locked "official" one plus teachers' own
  // variants) — the client shows a picker when more than one matches.

  async getLessonCurricula([callerId, filters]) {
    if (!callerId) return { error: 'Not signed in.' };
    const f = filters || {};
    let path = 'lesson_curricula?select=*';
    if (f.class_name) path += `&class_name=eq.${encodeURIComponent(f.class_name)}`;
    if (f.version) path += `&version=eq.${encodeURIComponent(f.version)}`;
    if (f.subject) path += `&subject=eq.${encodeURIComponent(f.subject)}`;
    if (f.chapter) path += `&chapter=eq.${encodeURIComponent(f.chapter)}`;
    path += '&order=created_at.asc';
    const rows = await supabaseRequest(path);
    if (rows?.error) return { error: rows.details || rows.error };
    return { result: 'success', curricula: Array.isArray(rows) ? rows : [] };
  },

  async saveLessonCurriculum([callerId, id, payload]) {
    if (!callerId) return { result: 'error', message: 'Not signed in.' };
    const p = payload || {};
    if (!p.class_name || !p.subject || !p.chapter) {
      return { result: 'error', message: 'Class, Subject, and Chapter are required.' };
    }
    const row = {
      class_name: p.class_name, subject: p.subject, version: p.version || null,
      chapter: p.chapter, lectures: p.lectures || [], is_editable: p.is_editable !== false,
      updated_at: new Date().toISOString(),
    };

    if (!id) {
      const created = await supabaseRequest('lesson_curricula', 'post', { ...row, created_by: callerId });
      if (created?.error) return { result: 'error', message: created.details || created.error };
      return { result: 'success', curriculum: created[0], forked: false };
    }

    const existingRows = await supabaseRequest(`lesson_curricula?id=eq.${encodeURIComponent(id)}&select=id,created_by,is_editable`);
    if (existingRows?.error) return { result: 'error', message: existingRows.details || existingRows.error };
    const existing = Array.isArray(existingRows) && existingRows[0];
    if (!existing) return { result: 'error', message: 'Curriculum entry not found.' };

    if (existing.is_editable || existing.created_by === callerId) {
      const updated = await supabaseRequest(`lesson_curricula?id=eq.${encodeURIComponent(id)}`, 'patch', row);
      if (updated?.error) return { result: 'error', message: updated.details || updated.error };
      return { result: 'success', curriculum: updated[0], forked: false };
    }

    // Locked by someone else — fork into a new row instead of editing
    // theirs. Starts not-editable-by-others (only the forker owns it) until
    // they choose to open it up.
    const forked = await supabaseRequest('lesson_curricula', 'post', {
      ...row, is_editable: false, created_by: callerId, forked_from_id: id,
    });
    if (forked?.error) return { result: 'error', message: forked.details || forked.error };
    return { result: 'success', curriculum: forked[0], forked: true };
  },

  async deleteLessonCurriculum([callerId, id]) {
    if (!callerId || !id) return { result: 'error', message: 'Missing id.' };
    const rows = await supabaseRequest(`lesson_curricula?id=eq.${encodeURIComponent(id)}&select=created_by`);
    if (rows?.error) return { result: 'error', message: rows.details || rows.error };
    const row = Array.isArray(rows) && rows[0];
    if (!row) return { result: 'error', message: 'Curriculum entry not found.' };
    if (row.created_by !== callerId && !(await _isCordOrAdmin(callerId))) {
      return { result: 'error', message: 'Only the author (or an Admin) can delete this.' };
    }
    const deleted = await supabaseRequest(`lesson_curricula?id=eq.${encodeURIComponent(id)}`, 'delete');
    if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    return { result: 'success' };
  },

  // ── LESSON PLAN FAVORITES ────────────────────────────────────────────────
  // Bookmarks a lesson plan or curriculum entry (someone else's shared item,
  // or the caller's own) into the caller's personal "quick access" list —
  // independent of ownership, so a teacher can build up a working set of
  // useful plans/breakdowns without forking or copying anything.

  async toggleLessonFavorite([callerId, itemType, itemId, favorited]) {
    if (!callerId || !itemType || !itemId) return { result: 'error', message: 'Missing parameters.' };
    if (favorited) {
      const created = await supabaseRequest('lesson_favorites?on_conflict=user_id,item_type,item_id', 'post', {
        user_id: callerId, item_type: itemType, item_id: itemId,
      });
      if (created?.error) return { result: 'error', message: created.details || created.error };
    } else {
      const deleted = await supabaseRequest(`lesson_favorites?user_id=eq.${encodeURIComponent(callerId)}&item_type=eq.${encodeURIComponent(itemType)}&item_id=eq.${encodeURIComponent(itemId)}`, 'delete');
      if (deleted?.error) return { result: 'error', message: deleted.details || deleted.error };
    }
    return { result: 'success' };
  },

  async getMyLessonFavorites([callerId]) {
    if (!callerId) return { error: 'Not signed in.' };
    const favRows = await supabaseRequest(`lesson_favorites?user_id=eq.${encodeURIComponent(callerId)}&select=item_type,item_id&order=created_at.desc`);
    if (favRows?.error) return { error: favRows.details || favRows.error };
    const favs = Array.isArray(favRows) ? favRows : [];
    const planIds = favs.filter(f => f.item_type === 'lesson_plan').map(f => f.item_id);
    const curriculumIds = favs.filter(f => f.item_type === 'curriculum').map(f => f.item_id);

    const [plans, curricula] = await Promise.all([
      planIds.length
        ? supabaseRequest(`lesson_plans?id=in.(${planIds.join(',')})&select=id,class_name,subject,version,chapter,lesson_number,topic,is_shared,created_by,updated_at`)
        : Promise.resolve([]),
      curriculumIds.length
        ? supabaseRequest(`lesson_curricula?id=in.(${curriculumIds.join(',')})&select=*`)
        : Promise.resolve([]),
    ]);
    if (plans?.error) return { error: plans.details || plans.error };
    if (curricula?.error) return { error: curricula.details || curricula.error };
    return { result: 'success', plans: Array.isArray(plans) ? plans : [], curricula: Array.isArray(curricula) ? curricula : [] };
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
