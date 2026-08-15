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

// pageSize: 'A4' (210×297mm, default) or 'Legal' (215.9×355.6mm), picked via
// ?size=legal. Kept in lockstep with _lpPageDims in _src/app.js.
function pageDims(pageSize) {
  const isLegal = pageSize === 'Legal';
  const pageHeightMm = isLegal ? 355.6 : 297;
  const pageWidthMm = isLegal ? 215.9 : 210;
  return { cssName: isLegal ? 'legal' : 'A4', pageWidthMm, pageHeightMm, contentHeightMm: pageHeightMm - 26 };
}

// Shrinks oversized paragraphs before falling back to scaling the whole page
// — see _lpAutoFitScript in _src/app.js for the full rationale; identical
// logic duplicated here since this route has no access to that client bundle.
function autoFitScript(contentHeightMm) {
  return `<script>(function(){
    function fit(){
      var page = document.querySelector('.page');
      if (!page) return;
      var probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;height:${contentHeightMm}mm;width:0;';
      document.body.appendChild(probe);
      var budget = probe.offsetHeight;
      document.body.removeChild(probe);
      var candidates = Array.prototype.slice.call(page.querySelectorAll('td,.lo-box'));
      var MIN_PX = 8.7, tries = 0;
      function contentHeight(){ return page.scrollHeight; }
      while (contentHeight() > budget && tries < 80) {
        tries++;
        var target = null, targetScrollH = 0, targetSize = 0;
        candidates.forEach(function(el){
          var size = parseFloat(window.getComputedStyle(el).fontSize);
          if (size > MIN_PX && el.scrollHeight > targetScrollH) { target = el; targetScrollH = el.scrollHeight; targetSize = size; }
        });
        if (target) { target.style.fontSize = (targetSize - 0.5) + 'px'; continue; }
        break;
      }
      if (contentHeight() > budget) {
        var ratio = Math.max(budget / contentHeight(), 0.5);
        page.style.transformOrigin = 'top left';
        page.style.transform = 'scale(' + ratio + ')';
        page.style.width = (100 / ratio) + '%';
      }
    }
    if (document.readyState === 'complete') fit(); else window.addEventListener('load', fit);
  })();</script>`;
}

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const dims = pageDims(searchParams.get('size') === 'legal' ? 'Legal' : 'A4');
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

  // Greetings/Closing are the same procedural bookend every lesson — printed
  // output only needs the actual lecture content, not the classroom-
  // management formalities.
  const phaseRows = (plan.phases || [])
    .filter(p => p.phase !== 'Greetings' && p.phase !== 'Closing')
    .map(p => `
    <tr>
      <td class="ph-name">${esc(L.phases[p.phase] || p.phase || '')}</td>
      <td>${esc(p.teacher_activity || '')}</td>
      <td>${esc(p.learner_activity || '')}</td>
      <td class="dur">${p.duration_minutes ? esc(p.duration_minutes) + ' ' + L.min : ''}</td>
    </tr>`).join('');

  const bodyFont = isBn ? "'Noto Sans Bengali','Nirmala UI','Vrinda',Georgia,serif" : "Georgia,'Times New Roman',serif";
  const uiFont = isBn ? "'Noto Sans Bengali','Nirmala UI','Vrinda',Arial,sans-serif" : "Arial,Helvetica,sans-serif";

  // Deep, saturated colors on purpose — light/pastel tones wash out to near-
  // nothing on a black-and-white printer, whereas dark solid fills with
  // white text stay high-contrast in grayscale too. Kept in lockstep with
  // the internal app's print builder (_lpPrintCss in _src/app.js) so a plan
  // looks identical whether opened from the app or scanned from its QR code.
  const css = `
    @page { size: ${dims.cssName} portrait; margin: 13mm 15mm; }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:${uiFont};font-size:9.3pt;line-height:1.4;color:#111;background:#e8edf5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .page{min-height:${dims.contentHeightMm}mm;max-height:${dims.contentHeightMm}mm;overflow:hidden;position:relative;background:#fff;padding:13mm 15mm;margin:10mm auto;max-width:${dims.pageWidthMm}mm;box-shadow:0 3px 14px rgba(11,37,69,.18);border-radius:4pt;}

    .hdr{background:#0b2545;color:#fff;display:flex;align-items:stretch;gap:10pt;padding:6pt 10pt;border-radius:3pt;margin-bottom:9pt;}
    .hdr-text{flex:1;display:flex;flex-direction:column;justify-content:center;text-align:center;}
    .hdr .main{font-family:${bodyFont};font-size:14.5pt;font-weight:700;letter-spacing:.02em;}
    .hdr .sub{font-family:${uiFont};font-size:8.8pt;font-weight:700;margin-top:3pt;color:#cfe0ff;letter-spacing:.03em;}
    .hdr-logo{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:44pt;}
    .hdr-logo img{height:100%;width:auto;max-width:100%;display:block;background:#fff;border-radius:2pt;padding:2pt;object-fit:contain;}

    .meta{display:flex;align-items:stretch;gap:10pt;margin-bottom:9pt;font-size:9pt;background:#f2f6fc;border:1pt solid #cddaf0;border-radius:3pt;padding:7pt 10pt;max-width:100%;}
    .meta-grid{flex:1;min-width:0;display:grid;grid-template-columns:1fr 1fr 1fr;gap:5pt 14pt;}
    .meta .fi{display:flex;gap:4pt;align-items:baseline;min-width:0;}
    .meta .lbl{font-weight:700;white-space:nowrap;color:#0b2545;font-size:7.6pt;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;}
    .fi.wide{grid-column:1/-1;}
    .uv{border-bottom:1pt solid #9fb3d1;display:inline-block;min-width:0;padding-bottom:1pt;flex:1;font-weight:600;color:#0b2545;overflow-wrap:break-word;}
    .code-box{flex-shrink:0;background:#7c2d12;color:#fff;border-radius:3pt;padding:6pt 12pt;text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center;min-width:78pt;}
    .code-box .lbl{font-size:6.3pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#fbd5c6;}
    .code-box .val{font-family:${uiFont};font-size:10pt;font-weight:900;margin-top:1pt;letter-spacing:.01em;}

    .sec-title{font-family:${uiFont};font-size:9.3pt;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:#0b2545;margin:11pt 0 4pt;padding-left:7pt;border-left:4pt solid #065f46;}
    .lo-box{font-size:9pt;line-height:1.55;border:1pt solid #cddaf0;border-left:4pt solid #065f46;border-radius:0 3pt 3pt 0;padding:7pt 9pt;min-height:24pt;white-space:pre-wrap;background:#fbfdff;}
    .gen-grid{display:grid;grid-template-columns:auto 1fr;gap:4pt 10pt;font-size:9pt;margin-top:3pt;}
    .gen-grid .lbl{font-weight:700;white-space:nowrap;color:#0b2545;}

    table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.2pt;margin-top:5pt;}
    th{border:1pt solid #0b2545;padding:5pt 6pt;font-weight:700;background:#0b2545;color:#fff;font-size:7.6pt;text-align:left;text-transform:uppercase;letter-spacing:.03em;word-wrap:break-word;}
    td{border:1pt solid #b9c8e2;padding:5pt 6pt;vertical-align:top;line-height:1.4;word-wrap:break-word;overflow-wrap:break-word;}
    tbody tr:nth-child(even) td{background:#f2f6fc;}
    th:nth-child(1),td.ph-name{width:12%;}
    th:nth-child(2),th:nth-child(3){width:37%;}
    th:nth-child(4),td.dur{width:8%;}
    td.ph-name{font-weight:700;color:#7c2d12;}
    td.dur{text-align:center;white-space:nowrap;font-weight:700;color:#065f46;}

    .footer-note{margin-top:12pt;padding-top:5pt;border-top:1.5pt solid #0b2545;font-size:7.3pt;font-weight:700;color:#0b2545;text-align:center;letter-spacing:.03em;}
  `;

  const html = `<!DOCTYPE html><html lang="${isBn ? 'bn' : 'en'}"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${isBn ? 'পাঠ পরিকল্পনা' : 'Lesson Plan'} &mdash; ${esc(plan.topic || plan.subject || 'CCPC')}</title>
    <style>${css}</style></head><body>
    <div class="page">
      <div class="hdr">
        <div class="hdr-logo"><img src="/logo.jpg" alt="College Logo"></div>
        <div class="hdr-text">
          <div class="main">${esc(L.college)}</div>
          <div class="sub">${esc(L.subtitle)}</div>
        </div>
        <div class="hdr-logo"></div>
      </div>
      <div class="meta">
        <div class="meta-grid">
          <div class="fi"><span class="lbl">${esc(L.name)}</span> <span class="uv">${esc((profile && profile.full_name) || '')}</span></div>
          <div class="fi"><span class="lbl">${esc(L.department)}</span> <span class="uv">${esc((profile && profile.school_college) || '')}</span></div>
          <div class="fi"><span class="lbl">${esc(L.class)}</span> <span class="uv">${esc(plan.class_name || '')}</span></div>
          <div class="fi"><span class="lbl">${esc(L.subject)}</span> <span class="uv">${esc(plan.subject || '')}</span></div>
          <div class="fi"><span class="lbl">${esc(L.date)}</span> <span class="uv">${esc(plan.class_date || '')}${weekday ? ' (' + esc(weekday) + ')' : ''}</span></div>
          <div class="fi"><span class="lbl">${esc(L.period)}</span> <span class="uv">${esc(plan.period || '')}</span></div>
          <div class="fi"><span class="lbl">${esc(L.version)}</span> <span class="uv">${esc(plan.version || '')}</span></div>
          <div class="fi"><span class="lbl">${esc(L.time)}</span> <span class="uv">${plan.time_minutes ? esc(plan.time_minutes) + ' ' + L.minutes : ''}</span></div>
          <div class="fi wide"><span class="lbl">${esc(L.chapterLessons)}</span> <span class="uv">${esc(chapterLine)}</span></div>
          <div class="fi wide"><span class="lbl">${esc(L.topic)}</span> <span class="uv">${esc(plan.topic || '')}</span></div>
        </div>
        <div class="code-box"><div class="lbl">${isBn ? 'পাঠ কোড' : 'Lesson Code'}</div><div class="val">${esc(lessonCode)}</div></div>
      </div>

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
    ${autoFitScript(dims.contentHeightMm)}
    </body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
