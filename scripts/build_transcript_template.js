// Builds the "Academic Transcript — Half Yearly" result template and saves it.
// Re-run it any time to rebuild the template from scratch (it replaces the
// one with the same name).
const fs = require('fs');
const root = 'E:/important/vs code/CCPC_ACR/ccpc-teachers';
const env = Object.fromEntries(fs.readFileSync(root + '/.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Accept-Profile': 'exam', 'Content-Profile': 'exam', 'Content-Type': 'application/json', Prefer: 'return=representation' };
const req = async (p, m = 'GET', b) => {
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + p, { method: m, headers: H, ...(b ? { body: JSON.stringify(b) } : {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${p} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

// The two exams the transcript adds together: CT-1 gives the CT column,
// Half Yearly gives MCQ / CQ / Practical. Marks are summed, not averaged —
// each part already carries its own weight from Subject Setup.
const SOURCES = [
  { term_id: 1, exam_name: 'CT-1 2026', share: 0 },
  { term_id: 1, exam_name: 'Half Yearly 2026', share: 0 },
];
const CT = 0, HY = 1; // the order above; src.0 = CT-1, src.1 = Half Yearly

const t = (id, x, y, w, h, text, style) => ({ id, type: 'text', x, y, w, h, text, style: { size: 8.5, align: 'left', ...(style || {}) } });
const line = (id, x, y, w) => ({ id, type: 'line', x, y, w, h: 0.5, style: { border: 1 } });

// ── The marks table, column by column, exactly as the printed transcript ──
const marksItems = [
  { id: 'm1', label: 'Subjects', path: 'name', align: 'left' },
  { id: 'm2', label: 'Full Marks', path: 'sub.@.combined.full', decimals: 2 },
  { id: 'm3', label: 'CT Total', path: `sub.@.src.${CT}.partfull.CT`, decimals: 2, group: 'Half/Yearly Examination' },
  { id: 'm4', label: 'CT Obt.', path: `sub.@.src.${CT}.part.CT`, group: 'Half/Yearly Examination' },
  { id: 'm5', label: 'CT Conv.', path: `sub.@.src.${CT}.partconv.CT`, group: 'Half/Yearly Examination' },
  { id: 'm6', label: 'MCQ', path: `sub.@.src.${HY}.part.MCQ`, group: 'Half/Yearly Examination' },
  { id: 'm7', label: 'CQ', path: `sub.@.src.${HY}.part.CQ`, group: 'Half/Yearly Examination' },
  { id: 'm8', label: 'Prac', path: `sub.@.src.${HY}.part.Practical`, group: 'Half/Yearly Examination' },
  { id: 'm9', label: 'Total', path: `sub.@.src.${HY}.raw`, group: 'Half/Yearly Examination' },
  { id: 'm10', label: 'Conv.', path: `sub.@.src.${HY}.final`, decimals: 2, group: 'Half/Yearly Examination' },
  { id: 'm11', label: 'Total Marks', path: 'sub.@.combined.final', decimals: 2 },
  { id: 'm12', label: 'Highest Marks', path: 'sub.@.combined.highest', decimals: 2 },
  { id: 'm13', label: 'Letter Grade', path: 'sub.@.combined.grade' },
  { id: 'm14', label: 'Grade Point', path: 'sub.@.combined.gp', decimals: 2 },
];

const student = {
  page: 'A4', orient: 'portrait',
  blocks: [
    // ── heading ──
    t('h1', 12, 8, 186, 5, "My Lord! Increase me in Knowledge", { size: 8, align: 'center', italic: true }),
    t('h2', 12, 13, 186, 8, 'Chattogram Cantonment Public College', { size: 17, bold: true, align: 'center' }),
    t('h3', 12, 21, 186, 5, 'Academic Transcript', { size: 11, bold: true, align: 'center' }),
    t('h4', 12, 26, 186, 5, 'School Section (Secondary)', { size: 9, align: 'center' }),
    // ── the student, and their photo ──
    t('s1', 12, 34, 96, 4.5, 'Student Name : {student_name}'),
    t('s2', 12, 38.5, 96, 4.5, 'Student ID : {student_id}'),
    t('s3', 12, 43, 96, 4.5, 'Class Roll : {roll}'),
    t('s4', 12, 47.5, 96, 4.5, 'Previous Result : 0.00'),
    t('s5', 12, 52, 48, 4.5, 'Class : {class}'),
    t('s6', 60, 52, 48, 4.5, 'Group : {group}'),
    t('s7', 12, 56.5, 48, 4.5, 'Section : {section}'),
    t('s8', 60, 56.5, 48, 4.5, 'Shift : {shift}'),
    t('s9', 12, 61, 48, 4.5, 'Session : {session}'),
    t('s10', 60, 61, 48, 4.5, 'Version : {version}'),
    t('s11', 12, 65.5, 48, 4.5, 'Category : {student_category}'),
    t('s12', 60, 65.5, 48, 4.5, 'House : {house}'),
    { id: 'photo', type: 'photo', x: 112, y: 34, w: 26, h: 31, style: { border: 1 } },
    // ── grade key, top right ──
    { id: 'gkey', type: 'grades', x: 144, y: 34, w: 54, h: 34, style: { size: 7, border: 1 } },
    // ── the marks ──
    { id: 'marks', type: 'marksx', x: 12, y: 72, w: 186, h: 92, items: marksItems, subjects: 'all', style: { size: 7.2, border: 1 } },
    // ── totals ──
    t('tot1', 12, 166, 96, 5, 'Total Marks & Total GP', { bold: true }),
    t('tot2', 108, 166, 45, 5, '{total}', { bold: true, align: 'center' }),
    t('tot3', 153, 166, 45, 5, '{gp_total}', { bold: true, align: 'center' }),
    // ── the summary boxes ──
    { id: 'sum', type: 'table', x: 12, y: 174, w: 90, h: 24, header: false, style: { size: 8, border: 1 },
      rows: ['Grade Point Average | {gpa}', 'Letter Grade | {letter_grade}', 'Total Marks with Fraction | {total}', 'Remarks | {col.k10}'].join('\n') },
    { id: 'att', type: 'table', x: 104, y: 174, w: 94, h: 24, header: true, style: { size: 8, border: 1 },
      rows: ['Half Yearly Examination - 2026 | ', 'Present Days | {attendance_present}', 'Working Days | {attendance_days}', 'Present % | {attendance_percent}'].join('\n') },
    t('merit', 12, 200, 186, 5, 'Merit Position (All Section) : {position} out of {students_count}', { bold: true }),
    // ── remarks ──
    t('rem1', 12, 207, 186, 5, 'Special Remarks from Class Teacher :', { size: 8 }),
    { id: 'rembox', type: 'box', x: 12, y: 212, w: 186, h: 22, style: { border: 1 } },
    // ── signatures ──
    line('sg1l', 16, 252, 38), t('sg1', 16, 253, 38, 5, 'Class Teacher', { size: 8, align: 'center' }),
    line('sg2l', 62, 252, 38), t('sg2', 62, 253, 38, 5, 'Parents/Guardian', { size: 8, align: 'center' }),
    { id: 'sg3', type: 'signature', x: 108, y: 240, w: 38, h: 18, caption: 'Vice Principal', images: [], rules: [], def: '', style: { size: 8, align: 'center' } },
    { id: 'sg4', type: 'signature', x: 154, y: 240, w: 38, h: 18, caption: 'Principal', images: [], rules: [], def: '', style: { size: 8, align: 'center' } },
  ],
};

// The class sheet: the same marks, one row per student.
const klass = {
  page: 'A4', orient: 'landscape',
  blocks: [
    t('c1', 10, 8, 277, 7, 'Chattogram Cantonment Public College', { size: 14, bold: true, align: 'center' }),
    t('c2', 10, 15, 277, 6, 'Half Yearly Examination 2026 — {class_name}', { size: 10, align: 'center' }),
    { id: 'c3', type: 'tabulation', x: 10, y: 24, w: 277, h: 170, style: { size: 7, border: 1 } },
  ],
};

// The class sheet's columns: roll, name,each subject's total, then the summary.
const cols = [
  { id: 'k1', kind: 'value', path: 'result.position', label: 'Pos', fmt: {} },
  { id: 'k2', kind: 'value', path: 'student.roll', label: 'Roll', fmt: {} },
  { id: 'k3', kind: 'value', path: 'student.student_name', label: 'Name', fmt: { align: 'left' } },
  { id: 'k4', kind: 'block', label: 'Subjects', subjects: 'all', items: [
    { id: 'kb1', kind: 'value', path: 'sub.@.combined.final', label: 'Marks', fmt: { decimals: 2 } },
    { id: 'kb2', kind: 'value', path: 'sub.@.combined.grade', label: 'Grade', fmt: {} },
  ], fmt: {} },
  { id: 'k5', kind: 'value', path: 'result.total', label: 'Total', fmt: { bold: true, decimals: 2 } },
  { id: 'k6', kind: 'value', path: 'result.gp_total', label: 'Total GP', fmt: { decimals: 2 } },
  { id: 'k7', kind: 'value', path: 'result.gpa', label: 'GPA', fmt: { bold: true, decimals: 2 } },
  { id: 'k8', kind: 'value', path: 'result.letter_grade', label: 'Grade', fmt: {} },
  { id: 'k9', kind: 'value', path: 'result.pass', label: 'Result', fmt: {} },
  // Printed on the report card as Remarks; hidden from the class sheet.
  { id: 'k10', kind: 'virtual', label: 'Remarks', fmt: { visible: false }, vf: { mode: 'rules', rules: [
    { path: 'result.pass', op: '==', value: 'Fail', then: 'Must Improve' },
    { path: 'result.gpa', op: '>=', value: '5', then: 'Outstanding' },
    { path: 'result.gpa', op: '>=', value: '4', then: 'Very Good' },
    { path: 'result.gpa', op: '>=', value: '3.5', then: 'Good' },
    { path: 'result.gpa', op: '>=', value: '3', then: 'Fair' },
  ], else: 'Need Improvement' } },
];

(async () => {
  const patterns = await req('class_patterns?select=id,name,class_name,display_name,section,session');
  const school = ['Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const classes = patterns.filter(p => school.includes(p.class_name) && !p.section && !p.session).map(p => p.id);
  const config = {
    sources: SOURCES,
    method: 'sum',            // the two exams' marks add together
    out_of: '',               // each subject keeps its own full marks
    pass_rule: 'combined',
    attendance: { from: '2026-01-01', to: '2026-06-30' },
    gpa_pair_papers: true,    // Bangla 1st + 2nd count as one subject, same for English
    gpa_skip_empty: true,     // a subject with no marks (Arts & Crafts) is left out
    classes,
    cols,
    population: { filters: [], match: 'all', sort: [{ path: 'student.roll', dir: 'asc' }], limit: '' },
    layout: { student, class: klass },
  };
  const name = 'Academic Transcript — Half Yearly';
  const existing = await req(`result_templates?name=eq.${encodeURIComponent(name)}&select=id`);
  const row = { name, config, updated_at: new Date().toISOString() };
  const saved = existing.length
    ? await req(`result_templates?id=eq.${existing[0].id}`, 'PATCH', row)
    : await req('result_templates', 'POST', row);
  console.log('template saved:', saved[0].id, '| classes:', classes.length, '| report-card blocks:', student.blocks.length, '| marks columns:', marksItems.length);
})().catch(e => console.log('STOPPED:', e.message));
