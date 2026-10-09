import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Public, login-free judge scoring page — same shape as app/vote/[slug]/
// route.js and app/plan/[id]/route.js (GET renders, POST writes, the
// dynamic segment IS the access check), but for a Group Form's digital
// judging. A judge is never a staff account; access_code is their whole
// identity, re-validated fresh against student.group_form_judges on every
// single request (never cached, never trusted from a prior response) —
// stronger than vote/[slug]'s hardcoded slug map, since this one is a real
// DB-backed secret checked per-call, and every query below is additionally
// scoped by that judge's own group_form_id, never just "is the code valid".
// Deliberately does NOT import _src/app.js or public/app.js — a judge's
// phone never downloads the admin bundle, and nothing admin-only is
// reachable from this page even in principle.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sb(path, method = 'GET', body = null, extra = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'student',
      'Content-Profile': 'student',
      ...extra,
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

const ARCHIVED_MESSAGE = 'This event has been archived — scoring is closed.';

function notFoundHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Judge link not found</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f5;color:#333;text-align:center;padding:24px;}
    .box{max-width:360px;} h1{font-size:18px;margin-bottom:8px;} p{font-size:13px;color:#666;}</style></head>
    <body><div class="box"><h1>Judge link not found</h1><p>This link is invalid, disabled, or has been removed. Please check with the event organizer.</p></div></body></html>`;
}

async function loadJudge(code) {
  const rows = await sb(`group_form_judges?access_code=eq.${encodeURIComponent(code)}&is_enabled=eq.true&select=*`);
  if (rows?.error || !Array.isArray(rows) || !rows.length) return null;
  return rows[0];
}

// First field (in fields_json order) whose NAME matches `pattern` and whose
// answer in group_data is non-empty — same first-match-wins idiom as the
// admin bundle's own _gfAnswerByName, duplicated here since this route has
// no access to that client file.
function answerByName(fields, groupData, pattern) {
  for (const f of fields) {
    if (!f || !f.data_key || !pattern.test(f.name || '')) continue;
    const v = (groupData || {})[f.data_key];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

function capWords(s, n) {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= n) return words.join(' ');
  return words.slice(0, n).join(' ') + '…';
}

async function loadRosterAndScores(judge) {
  const [formRows, teamRows, judgeScoreRows] = await Promise.all([
    sb(`group_forms?id=eq.${encodeURIComponent(judge.group_form_id)}&select=id,title,fields_json,judging_criteria_json,archived`),
    sb(`group_form_teams?group_form_id=eq.${encodeURIComponent(judge.group_form_id)}&status=neq.disbanded&select=id,leader_student_id,group_data,reference_number&order=created_at.asc`),
    sb(`group_form_judge_scores?judge_id=eq.${encodeURIComponent(judge.id)}&select=team_id,scores_json`),
  ]);
  const form = Array.isArray(formRows) && formRows[0];
  if (!form) return null;

  const teams = Array.isArray(teamRows) ? teamRows : [];
  const memberRows = teams.length
    ? await sb(`group_form_team_members?group_form_id=eq.${encodeURIComponent(judge.group_form_id)}&select=team_id,student_id,role&order=role.asc`)
    : [];
  const members = Array.isArray(memberRows) ? memberRows : [];
  const studentIds = [...new Set(members.map(m => m.student_id))];
  let profileById = {};
  if (studentIds.length) {
    const profRows = await sb(`students_data?student_id=in.(${studentIds.map(encodeURIComponent).join(',')})&select=student_id,student_name,class,section,roll,house`);
    (Array.isArray(profRows) ? profRows : []).forEach(p => { profileById[p.student_id] = p; });
  }
  const membersByTeam = {};
  members.forEach(m => { (membersByTeam[m.team_id] = membersByTeam[m.team_id] || []).push({ ...m, profile: profileById[m.student_id] || null }); });

  let fields = [];
  try { fields = JSON.parse(form.fields_json || '[]') || []; } catch (e) {}
  let criteria = [];
  try { criteria = JSON.parse(form.judging_criteria_json || '[]') || []; } catch (e) {}

  const scoresByTeam = {};
  (Array.isArray(judgeScoreRows) ? judgeScoreRows : []).forEach(r => {
    try { scoresByTeam[r.team_id] = JSON.parse(r.scores_json || '{}') || {}; } catch (e) { scoresByTeam[r.team_id] = {}; }
  });

  const teamInfos = teams.map(t => {
    const teamMembers = membersByTeam[t.id] || [];
    const leader = teamMembers.find(m => m.role === 'leader') || teamMembers[0] || null;
    const house = (leader && leader.profile && leader.profile.house) || '';
    const title = answerByName(fields, t.group_data, /project|poster|title/i) || 'Untitled Project';
    const description = capWords(answerByName(fields, t.group_data, /detail|description/i), 20);
    return {
      team_id: t.id,
      reference_number: t.reference_number || ('#' + t.id),
      house,
      title,
      description,
      members: teamMembers.map(m => ({
        name: (m.profile && m.profile.student_name) || m.student_id,
        class_section_roll: m.profile ? [m.profile.class, m.profile.section].filter(Boolean).join('-') + (m.profile.roll ? '-' + m.profile.roll : '') : '',
      })),
      scores: scoresByTeam[t.id] || {},
    };
  });

  return { formTitle: form.title, archived: !!form.archived, criteria, teams: teamInfos };
}

function renderPage(judge, data) {
  const criteriaHtml = data.criteria.map(c => `<span class="crit-chip">${esc(c.label)} <b>/${esc(c.max)}</b></span>`).join('');
  const teamsForClient = JSON.stringify(data.teams).replace(/</g, '\\u003c');
  const criteriaForClient = JSON.stringify(data.criteria).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Judging — ${esc(data.formTitle)}</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Inter:wght@400;500;600;700&display=swap">
<style>
  :root{ --bg:#f3f5f9; --surface:#ffffff; --ink:#1b2430; --ink-muted:#667085; --border:#e1e6ee;
    --accent:#2454e8; --accent-ink:#13306e; --good:#1f9d63; --warn:#b4650a; --shadow:0 10px 28px -16px rgba(20,32,60,.22); }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){ --bg:#0f1420; --surface:#161d2b; --ink:#eef1f7; --ink-muted:#99a2b5;
      --border:#283245; --accent:#6a90ff; --accent-ink:#cddaff; --good:#49d690; --warn:#e2a355; --shadow:0 10px 28px -16px rgba(0,0,0,.55); }
  }
  :root[data-theme="dark"]{ --bg:#0f1420; --surface:#161d2b; --ink:#eef1f7; --ink-muted:#99a2b5;
    --border:#283245; --accent:#6a90ff; --accent-ink:#cddaff; --good:#49d690; --warn:#e2a355; --shadow:0 10px 28px -16px rgba(0,0,0,.55); }
  *{box-sizing:border-box;}
  body{margin:0; background:var(--bg); color:var(--ink); font-family:'Inter',Arial,sans-serif; line-height:1.5; -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums;}
  .wrap{max-width:640px; margin:0 auto; padding:1.1rem 1rem 3rem;}
  h1,h2{text-wrap:balance; margin:0;}
  .hdr{padding:.4rem 0 1rem;}
  .hdr .eyebrow{font-size:.68rem; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--accent);}
  .hdr h1{font-family:'Manrope',sans-serif; font-size:1.4rem; font-weight:800; margin-top:.25rem;}
  .hdr .judge-line{margin-top:.3rem; font-size:.88rem; color:var(--ink-muted); font-weight:500;}
  .crit-strip{display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.8rem;}
  .crit-chip{font-size:.72rem; font-weight:600; background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:.25rem .65rem; color:var(--ink-muted);}
  .crit-chip b{color:var(--accent-ink);}
  .archived-banner{margin-top:.9rem; padding:.7rem .9rem; border-radius:12px; background:rgba(180,101,10,.12); border:1px solid var(--warn); color:var(--warn); font-size:.82rem; font-weight:700;}

  .team-card{background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:1.1rem 1.1rem 1.2rem; margin-bottom:1rem; box-shadow:var(--shadow);}
  .team-top{display:flex; align-items:baseline; justify-content:space-between; gap:.6rem; margin-bottom:.35rem;}
  .team-sl{font-size:.72rem; font-weight:700; color:var(--ink-muted);}
  .team-ref{font-size:.7rem; font-weight:800; letter-spacing:.03em; background:var(--accent); color:#fff; border-radius:999px; padding:.15rem .55rem;}
  .team-house{font-size:.7rem; font-weight:700; color:var(--ink-muted);}
  .team-members{margin:.5rem 0; display:flex; flex-direction:column; gap:.15rem;}
  .team-member{font-size:.86rem; font-weight:600;}
  .team-member .csr{color:var(--ink-muted); font-weight:500; font-size:.8rem;}
  .team-title{font-family:'Manrope',sans-serif; font-weight:800; font-size:1.02rem; margin-top:.5rem;}
  .team-desc{font-size:.83rem; color:var(--ink-muted); margin-top:.2rem;}

  .score-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:.6rem; margin-top:.9rem;}
  .score-field label{display:block; font-size:.7rem; font-weight:700; color:var(--ink-muted); margin-bottom:.3rem;}
  .score-field input{width:100%; padding:.6rem .7rem; border-radius:10px; border:1.5px solid var(--border); background:var(--bg); color:var(--ink); font-size:1rem; font-weight:700; font-family:inherit;}
  .score-field input:focus{border-color:var(--accent); outline:none;}

  .team-foot{display:flex; align-items:center; justify-content:space-between; gap:.6rem; margin-top:.9rem; padding-top:.75rem; border-top:1px dashed var(--border);}
  .team-total{font-size:.85rem; font-weight:700; color:var(--ink-muted);}
  .team-total b{color:var(--ink); font-size:1rem;}
  .save-btn{border:none; border-radius:999px; padding:.55rem 1.2rem; font-weight:700; font-size:.85rem; cursor:pointer; background:var(--accent); color:#fff;}
  .save-btn:disabled{opacity:.6; cursor:default;}
  .save-status{font-size:.78rem; font-weight:700; margin-top:.4rem; min-height:1.1em;}
  .save-status.ok{color:var(--good);}
  .save-status.err{color:#d8453a;}

  .empty{text-align:center; padding:2.5rem 1rem; color:var(--ink-muted); font-size:.9rem;}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <span class="eyebrow">Judging</span>
    <h1>${esc(data.formTitle)}</h1>
    <div class="judge-line">Signed in as <strong>${esc(judge.name)}</strong></div>
    <div class="crit-strip">${criteriaHtml}</div>
    ${data.archived ? `<div class="archived-banner">${esc(ARCHIVED_MESSAGE)}</div>` : ''}
  </div>
  <div id="teams-host">${data.teams.length ? '' : '<div class="empty">No teams to judge yet.</div>'}</div>
</div>

<script>
(function(){
  "use strict";
  var TEAMS = ${teamsForClient};
  var CRITERIA = ${criteriaForClient};
  var ARCHIVED = ${data.archived ? 'true' : 'false'};
  var host = document.getElementById('teams-host');

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }

  function teamTotal(team){
    var sum = 0, any = false;
    CRITERIA.forEach(function(c){
      var v = Number(team.scores[c.key]);
      if (!isNaN(v)) { sum += v; any = true; }
    });
    return any ? sum : null;
  }

  function renderTeam(team, idx){
    var card = document.createElement('div');
    card.className = 'team-card';
    var membersHtml = team.members.map(function(m){
      return '<div class="team-member">' + esc(m.name) + (m.class_section_roll ? ' <span class="csr">(' + esc(m.class_section_roll) + ')</span>' : '') + '</div>';
    }).join('');
    var fieldsHtml = CRITERIA.map(function(c){
      var existing = team.scores[c.key];
      return '<div class="score-field"><label>' + esc(c.label) + ' (out of ' + esc(c.max) + ')</label>' +
        '<input type="number" min="0" max="' + esc(c.max) + '" step="1" data-crit="' + esc(c.key) + '" value="' + (existing != null ? esc(existing) : '') + '"></div>';
    }).join('');
    card.innerHTML =
      '<div class="team-top"><span class="team-sl">#' + (idx + 1) + '</span><span class="team-ref">' + esc(team.reference_number) + '</span>' +
        (team.house ? '<span class="team-house">' + esc(team.house) + '</span>' : '') + '</div>' +
      '<div class="team-members">' + membersHtml + '</div>' +
      '<div class="team-title">' + esc(team.title) + '</div>' +
      (team.description ? '<div class="team-desc">' + esc(team.description) + '</div>' : '') +
      '<div class="score-grid">' + fieldsHtml + '</div>' +
      '<div class="team-foot"><span class="team-total">Total: <b class="total-val">' + (teamTotal(team) == null ? '—' : teamTotal(team)) + '</b></span>' +
        '<button type="button" class="save-btn"' + (ARCHIVED ? ' disabled' : '') + '>Save</button></div>' +
      '<div class="save-status"></div>';

    var totalEl = card.querySelector('.total-val');
    var statusEl = card.querySelector('.save-status');
    var saveBtn = card.querySelector('.save-btn');
    var inputs = card.querySelectorAll('input[data-crit]');

    function recompute(){
      var sum = 0, any = false;
      inputs.forEach(function(inp){
        var v = Number(inp.value);
        if (inp.value !== '' && !isNaN(v)) { sum += v; any = true; }
      });
      totalEl.textContent = any ? sum : '—';
    }
    inputs.forEach(function(inp){ inp.addEventListener('input', recompute); });

    saveBtn.addEventListener('click', async function(){
      var scores = {};
      var bad = false;
      inputs.forEach(function(inp){
        if (inp.value === '') return;
        var v = Number(inp.value);
        if (isNaN(v) || v < 0 || v > Number(inp.max)) bad = true;
        scores[inp.getAttribute('data-crit')] = v;
      });
      if (bad) { statusEl.textContent = 'One or more scores are out of range.'; statusEl.className = 'save-status err'; return; }
      saveBtn.disabled = true;
      statusEl.textContent = 'Saving…'; statusEl.className = 'save-status';
      try {
        var res = await fetch(location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_id: team.team_id, scores: scores }),
        });
        var data = await res.json();
        if (data && data.result === 'success'){
          statusEl.textContent = 'Saved ✓'; statusEl.className = 'save-status ok';
        } else {
          statusEl.textContent = (data && data.message) || 'Could not save.'; statusEl.className = 'save-status err';
        }
      } catch(e){
        statusEl.textContent = 'Network error — try again.'; statusEl.className = 'save-status err';
      }
      saveBtn.disabled = !!ARCHIVED ? true : false;
    });

    return card;
  }

  TEAMS.forEach(function(team, idx){ host.appendChild(renderTeam(team, idx)); });
})();
</script>
</body>
</html>`;
}

export async function GET(request, { params }) {
  const { code } = await params;
  const judge = await loadJudge(code);
  if (!judge) return new Response(notFoundHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const data = await loadRosterAndScores(judge);
  if (!data) return new Response(notFoundHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return new Response(renderPage(judge, data), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function POST(request, { params }) {
  const { code } = await params;
  const judge = await loadJudge(code);
  if (!judge) return NextResponse.json({ result: 'error', message: 'Judge link not found.' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch (e) {
    return NextResponse.json({ result: 'error', message: 'Invalid request.' }, { status: 400 });
  }
  const team_id = Number(body.team_id);
  const scores = body.scores && typeof body.scores === 'object' && !Array.isArray(body.scores) ? body.scores : null;
  if (!team_id || !scores) return NextResponse.json({ result: 'error', message: 'team_id and scores required.' }, { status: 400 });

  const formRows = await sb(`group_forms?id=eq.${encodeURIComponent(judge.group_form_id)}&select=archived,judging_criteria_json`);
  const form = Array.isArray(formRows) && formRows[0];
  if (!form) return NextResponse.json({ result: 'error', message: 'Judge link not found.' }, { status: 404 });
  if (form.archived) return NextResponse.json({ result: 'error', message: ARCHIVED_MESSAGE });

  // The team must actually belong to THIS judge's own form — closes off a
  // judge guessing another form's team_id even though access_code itself
  // only ever resolves one group_form_id.
  const teamRows = await sb(`group_form_teams?id=eq.${encodeURIComponent(team_id)}&group_form_id=eq.${encodeURIComponent(judge.group_form_id)}&select=id`);
  if (!Array.isArray(teamRows) || !teamRows.length) return NextResponse.json({ result: 'error', message: 'Invalid team.' }, { status: 400 });

  let criteria = [];
  try { criteria = JSON.parse(form.judging_criteria_json || '[]') || []; } catch (e) {}
  const byKey = {};
  criteria.forEach(c => { byKey[c.key] = c; });

  const sanitized = {};
  for (const key of Object.keys(scores)) {
    const c = byKey[key];
    if (!c) return NextResponse.json({ result: 'error', message: 'Unknown criterion.' }, { status: 400 });
    const v = Number(scores[key]);
    if (!Number.isFinite(v) || v < 0 || v > Number(c.max)) {
      return NextResponse.json({ result: 'error', message: `"${c.label}" must be between 0 and ${c.max}.` }, { status: 400 });
    }
    sanitized[key] = v;
  }

  const r = await sb('group_form_judge_scores?on_conflict=judge_id,team_id', 'POST', {
    group_form_id: judge.group_form_id,
    judge_id: judge.id,
    team_id,
    scores_json: JSON.stringify(sanitized),
    updated_at: new Date().toISOString(),
  }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  if (r?.error) return NextResponse.json({ result: 'error', message: 'Could not save: ' + r.error }, { status: 500 });

  return NextResponse.json({ result: 'success' });
}
