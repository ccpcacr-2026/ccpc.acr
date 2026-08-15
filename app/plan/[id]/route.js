import { supabaseRequest } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Public, login-free A4 lesson-plan viewer — this is what a QR code printed
// on a lesson plan points to, so any colleague (or the printed plan itself,
// scanned later) can pull the plan up on a phone without ever signing in.
// Only plans the author marked "Share" are exposed here; everything else
// (and any id that doesn't exist) gets the same "not available" page, so
// scanning never leaks whether a given id is a real private plan or not.

const LABELS = {
  en: {
    college: 'CHATTOGRAM CANTONMENT PUBLIC COLLEGE',
    subtitle: "LESSON PLAN — Combining Bloom's Taxonomy and the 5E Model",
    name: 'Name:', department: 'Department:', class: 'Class:', subject: 'Subject:',
    version: 'Version:', time: 'Time:', minutes: 'minutes',
    date: 'Date:', period: 'Period:',
    chapterLessons: 'Chapter & Lesson(s):', topic: 'Topic:', lessonWord: 'Lesson',
    learningOutcomes: 'Learning Outcomes — After this class the students will be able to…',
    generalMgmt: 'General Class Management', teachingAids: 'Teaching Aids:', method: 'Method:',
    lessonPhases: 'Lesson Phases', thPhase: 'Phase', thTeacher: "Teacher's Activity",
    thLearner: "Learner's Activity", thDuration: 'Duration', min: 'min',
    footer: 'Chattogram Cantonment Public College, Bayezid, Chattogram',
    notAvailTitle: 'Lesson plan not available',
    notAvailBody: "This link is either invalid or the plan hasn't been shared publicly.",
    phases: {
      Greetings: 'Greetings', Engagement: 'Engagement Phase', Exploration: 'Exploration Phase',
      'Explanation and Elaboration': 'Explanation and Elaboration (Lesson Presentation)',
      Evaluation: 'Evaluation', Summarization: 'Summarization', 'Assignment/Homework': 'Assignment/Homework',
      Closing: 'Declaration of next topic and conclusion of the class',
    },
  },
  bn: {
    college: 'চট্টগ্রাম ক্যান্টনমেন্ট পাবলিক কলেজ',
    subtitle: 'পাঠ পরিকল্পনা — ব্লুমস ট্যাক্সোনমি ও 5E মডেলের সমন্বয়ে',
    name: 'নাম:', department: 'বিভাগ:', class: 'শ্রেণি:', subject: 'বিষয়:',
    version: 'ভার্সন:', time: 'সময়:', minutes: 'মিনিট',
    date: 'তারিখ:', period: 'পিরিয়ড:',
    chapterLessons: 'অধ্যায় ও পাঠ:', topic: 'আলোচ্য বিষয়:', lessonWord: 'পাঠ',
    learningOutcomes: 'শেখার ফলাফল — এই পাঠ শেষে শিক্ষার্থীরা যা পারবে',
    generalMgmt: 'সাধারণ শ্রেণি ব্যবস্থাপনা', teachingAids: 'শিক্ষা উপকরণ:', method: 'পদ্ধতি:',
    lessonPhases: 'পাঠের ধাপসমূহ', thPhase: 'ধাপ', thTeacher: 'শিক্ষকের কার্যক্রম',
    thLearner: 'শিক্ষার্থীর কার্যক্রম', thDuration: 'সময়কাল', min: 'মিনিট',
    footer: 'চট্টগ্রাম ক্যান্টনমেন্ট পাবলিক কলেজ, বায়েজিদ, চট্টগ্রাম',
    notAvailTitle: 'পাঠ পরিকল্পনা পাওয়া যায়নি',
    notAvailBody: 'এই লিংকটি সঠিক নয় অথবা পাঠ পরিকল্পনাটি প্রকাশ্যে শেয়ার করা হয়নি।',
    phases: {
      Greetings: 'শুভেচ্ছা বিনিময়', Engagement: 'সম্পৃক্তকরণ পর্যায়', Exploration: 'অনুসন্ধান পর্যায়',
      'Explanation and Elaboration': 'ব্যাখ্যা ও বিস্তারণ (পাঠ উপস্থাপন)',
      Evaluation: 'মূল্যায়ন', Summarization: 'সারসংক্ষেপ', 'Assignment/Homework': 'এসাইনমেন্ট/বাড়ির কাজ',
      Closing: 'পরবর্তী পাঠ ঘোষণা ও ক্লাস সমাপ্তি',
    },
  },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function chapterNumberShort(chapter) {
  if (!chapter) return '';
  const digit = chapter.match(/\d+/);
  if (digit) return digit[0].padStart(2, '0');
  const en = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen'];
  const bn = ['প্রথম', 'দ্বিতীয়', 'তৃতীয়', 'চতুর্থ', 'পঞ্চম', 'ষষ্ঠ', 'সপ্তম', 'অষ্টম', 'নবম', 'দশম', 'একাদশ', 'দ্বাদশ', 'ত্রয়োদশ'];
  for (let i = 0; i < en.length; i++) if (chapter.includes(en[i])) return String(i + 1).padStart(2, '0');
  for (let i = 0; i < bn.length; i++) if (chapter.includes(bn[i])) return String(i + 1).padStart(2, '0');
  return '';
}

function autoLessonCode(plan) {
  const classShort = (plan.class_name || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 6) || '';
  const subjShort = (plan.subject || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || '';
  const ref = (plan.lesson_refs || [])[0] || {};
  const chNum = chapterNumberShort(ref.chapter || plan.chapter || '');
  const lessonNums = Array.isArray(ref.lesson_numbers) && ref.lesson_numbers.length ? ref.lesson_numbers.join(',') : (plan.lesson_number || '');
  let code = [classShort, subjShort].filter(Boolean).join('-');
  if (chNum) code += (code ? '-' : '') + 'CH' + chNum;
  if (lessonNums) code += (code ? '-' : '') + 'L' + lessonNums;
  return code;
}

function notFoundHtml(L) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(L.notAvailTitle)}</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f5;color:#333;text-align:center;padding:24px;}
    .box{max-width:360px;} h1{font-size:18px;margin-bottom:8px;} p{font-size:13px;color:#666;}</style></head>
    <body><div class="box"><h1>${esc(L.notAvailTitle)}</h1><p>${esc(L.notAvailBody)}</p></div></body></html>`;
}

export async function GET(request, { params }) {
  const { id } = await params;
  const rows = await supabaseRequest(`lesson_plans?id=eq.${encodeURIComponent(id)}&is_shared=eq.true&select=*`);
  const plan = Array.isArray(rows) && rows[0];

  if (!plan) {
    return new Response(notFoundHtml(LABELS.en), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const isBn = /bangla/i.test(plan.version || '');
  const L = isBn ? LABELS.bn : LABELS.en;

  let profile = null;
  if (plan.created_by) {
    const profRows = await supabaseRequest(`users_profile?teacher_id=eq.${encodeURIComponent(plan.created_by)}&select=full_name,school_college`);
    profile = Array.isArray(profRows) && profRows[0];
  }

  const chapterLine = (plan.lesson_refs || [])
    .map(r => r.chapter + (r.lesson_numbers && r.lesson_numbers.length ? ' (' + L.lessonWord + ' ' + r.lesson_numbers.join(', ') + ')' : ''))
    .join('; ');

  const lessonCode = (plan.lesson_code && plan.lesson_code.trim()) || autoLessonCode(plan);
  const weekday = plan.class_date
    ? new Date(plan.class_date + 'T00:00:00').toLocaleDateString(isBn ? 'bn-BD' : 'en-US', { weekday: 'long' })
    : '';

  const phaseRows = (plan.phases || []).map(p => `
    <tr>
      <td class="ph-name">${esc(L.phases[p.phase] || p.phase || '')}</td>
      <td>${esc(p.teacher_activity || '')}</td>
      <td>${esc(p.learner_activity || '')}</td>
      <td class="dur">${p.duration_minutes ? esc(p.duration_minutes) + ' ' + L.min : ''}</td>
    </tr>`).join('');

  const css = `
    @page { size: A4 portrait; margin: 14mm 16mm; }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:${isBn ? "'Noto Sans Bengali','Nirmala UI','Vrinda',Arial,sans-serif" : 'Arial,Helvetica,sans-serif'};font-size:9.5pt;color:#000;background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page{min-height:269mm;position:relative;background:#fff;padding:14mm 16mm;margin:10mm auto;max-width:210mm;box-shadow:0 2px 8px rgba(0,0,0,.2);}
    .code-box{position:absolute;top:10mm;right:16mm;border:1pt solid #000;padding:4pt 8pt;font-size:8pt;font-weight:700;text-align:center;min-width:70pt;background:#fff;}
    .code-box .lbl{font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;}
    .code-box .val{font-size:9pt;font-weight:900;margin-top:1pt;}
    .hdr{text-align:center;border-bottom:2pt solid #000;padding-bottom:6pt;margin-bottom:8pt;}
    .hdr .main{font-size:13pt;font-weight:900;letter-spacing:.03em;}
    .hdr .sub{font-size:9.5pt;font-weight:700;margin-top:3pt;}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:4pt 16pt;margin-bottom:8pt;font-size:9.5pt;}
    .meta .fi{display:flex;gap:4pt;}
    .meta .lbl{font-weight:700;white-space:nowrap;}
    .uv{border-bottom:1pt solid #000;display:inline-block;min-width:60pt;padding-bottom:1pt;flex:1;}
    .sec-title{font-size:9.5pt;font-weight:900;text-transform:uppercase;margin:8pt 0 3pt;border-bottom:1pt solid #999;padding-bottom:2pt;}
    .lo-box{font-size:9pt;line-height:1.5;border:1pt solid #000;padding:6pt 8pt;min-height:24pt;white-space:pre-wrap;}
    .gen-grid{display:grid;grid-template-columns:auto 1fr;gap:3pt 8pt;font-size:9pt;margin-top:2pt;}
    .gen-grid .lbl{font-weight:700;white-space:nowrap;}
    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.3pt;margin-top:4pt;}
    th{border:1pt solid #000;padding:4pt 5pt;font-weight:700;background:#eee;font-size:7.8pt;text-align:left;text-transform:uppercase;word-wrap:break-word;}
    td{border:1pt solid #000;padding:4pt 5pt;vertical-align:top;line-height:1.35;word-wrap:break-word;overflow-wrap:break-word;}
    th:nth-child(1),td.ph-name{width:11%;font-weight:700;}
    th:nth-child(2),th:nth-child(3){width:38%;}
    th:nth-child(4),td.dur{width:8%;text-align:center;white-space:nowrap;}
    .footer-note{margin-top:10pt;font-size:7.5pt;color:#555;text-align:center;}
    @media print{.code-box{position:absolute;}}
  `;

  const html = `<!DOCTYPE html><html lang="${isBn ? 'bn' : 'en'}"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${isBn ? 'পাঠ পরিকল্পনা' : 'Lesson Plan'} &mdash; ${esc(plan.topic || plan.subject || 'CCPC')}</title>
    <style>${css}</style></head><body>
    <div class="page">
      <div class="code-box"><div class="lbl">${isBn ? 'পাঠ কোড' : 'Lesson Code'}</div><div class="val">${esc(lessonCode)}</div></div>
      <div class="hdr">
        <div class="main">${esc(L.college)}</div>
        <div class="sub">${esc(L.subtitle)}</div>
      </div>
      <div class="meta">
        <div class="fi"><span class="lbl">${esc(L.name)}</span> <span class="uv">${esc((profile && profile.full_name) || '')}</span></div>
        <div class="fi"><span class="lbl">${esc(L.department)}</span> <span class="uv">${esc((profile && profile.school_college) || '')}</span></div>
        <div class="fi"><span class="lbl">${esc(L.class)}</span> <span class="uv">${esc(plan.class_name || '')}</span></div>
        <div class="fi"><span class="lbl">${esc(L.subject)}</span> <span class="uv">${esc(plan.subject || '')}</span></div>
        <div class="fi"><span class="lbl">${esc(L.date)}</span> <span class="uv">${esc(plan.class_date || '')}${weekday ? ' (' + esc(weekday) + ')' : ''}</span></div>
        <div class="fi"><span class="lbl">${esc(L.period)}</span> <span class="uv">${esc(plan.period || '')}</span></div>
        <div class="fi"><span class="lbl">${esc(L.version)}</span> <span class="uv">${esc(plan.version || '')}</span></div>
        <div class="fi"><span class="lbl">${esc(L.time)}</span> <span class="uv">${plan.time_minutes ? esc(plan.time_minutes) + ' ' + L.minutes : ''}</span></div>
      </div>
      <div class="fi" style="margin-bottom:6pt;"><span class="lbl">${esc(L.chapterLessons)}</span> <span class="uv">${esc(chapterLine)}</span></div>
      <div class="fi" style="margin-bottom:6pt;"><span class="lbl">${esc(L.topic)}</span> <span class="uv">${esc(plan.topic || '')}</span></div>

      <div class="sec-title">${esc(L.learningOutcomes)}</div>
      <div class="lo-box">${esc(plan.learning_outcomes || '')}</div>

      <div class="sec-title">${esc(L.generalMgmt)}</div>
      <div class="gen-grid">
        <div class="lbl">${esc(L.teachingAids)}</div><div>${esc(plan.teaching_aids || '')}</div>
        <div class="lbl">${esc(L.method)}</div><div>${esc(plan.method || '')}</div>
      </div>

      <div class="sec-title">${esc(L.lessonPhases)}</div>
      <table>
        <thead><tr><th>${esc(L.thPhase)}</th><th>${esc(L.thTeacher)}</th><th>${esc(L.thLearner)}</th><th>${esc(L.thDuration)}</th></tr></thead>
        <tbody>${phaseRows}</tbody>
      </table>

      <div class="footer-note">${esc(L.footer)}</div>
    </div>
    </body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
