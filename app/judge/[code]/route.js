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

// Same band-name resolution as the admin bundle's gfMyBandNameServer
// (student-admin/route.js) — ported here since this file deliberately
// shares no code with that one (separate trust boundary).
function bandNameServer(eligibilityJson, value) {
  let elig = {};
  try { elig = JSON.parse(eligibilityJson || '{}') || {}; } catch (e) {}
  if (elig.class_mode !== 'band' || !Array.isArray(elig.bands) || !value) return null;
  const bandValues = b => Array.isArray(b) ? b : (Array.isArray(b.classes) ? b.classes : []);
  const band = elig.bands.find(b => bandValues(b).includes(value));
  if (!band) return null;
  const name = Array.isArray(band) ? '' : String(band.name || '').trim();
  return name || bandValues(band).join('/');
}
// A judge's scope_value now holds a JSON array ("Group A"+"Group B"+
// "Group C" all at once, e.g.) rather than one single string — stored in
// the same text column either way. Falls back to treating a bare, non-JSON
// string as a one-item list, so a judge saved before this change (a plain
// value, not yet JSON) still matches exactly as it did before.
function scopeValuesOf(judge) {
  if (!judge.scope_value) return [];
  try {
    const parsed = JSON.parse(judge.scope_value);
    return Array.isArray(parsed) ? parsed : [judge.scope_value];
  } catch (e) { return [judge.scope_value]; }
}
// Whether a team falls within this judge's own assigned slice — same
// dimension vocabulary and matching semantics as a reviewer rule's own
// groupFormTeamMatchesRule (student-admin/route.js), just reading the
// judge's own scope_dimension/scope_value instead of a rules table, and
// matching against ANY of the judge's selected values rather than one.
// Enforced here (what the roster shows) AND again in POST save_score
// below (a judge can't score a team outside their scope even by
// guessing its team_id).
function judgeScopeMatches(team, form, judge, leaderProfile) {
  const dim = judge.scope_dimension || 'all';
  if (dim === 'all') return true;
  const values = scopeValuesOf(judge);
  if (!values.length) return false;
  if (dim === 'class') return values.includes(String(leaderProfile?.class || ''));
  if (dim === 'house') return values.includes(String(leaderProfile?.house || ''));
  if (dim === 'group') {
    // Prefer the team's OWN already-captured "Group" answer (the
    // class_group field type stamps this once, at submission time, from
    // gfMyBandName — see ccpc-students/_gfClassGroupFieldHtml) over
    // re-deriving it live from the leader's CURRENT class against the
    // CURRENT eligibility bands. Bands can be edited by the admin after
    // teams have already submitted (a class added to or dropped from a
    // band), which would otherwise silently un-scope an already-approved
    // team from every judge even though its own Group answer — the same
    // value shown everywhere else on this page and in the admin roster —
    // never changed. Only falls back to the live computation when there's
    // no captured value to go on (no class_group field on this form, or an
    // older team predating it).
    let fields = [];
    try { fields = JSON.parse(form?.fields_json || '[]') || []; } catch (e) {}
    const groupFieldDef = fields.find(f => f && f.type === 'class_group');
    const captured = groupFieldDef ? (team.group_data || {})[groupFieldDef.data_key] : null;
    if (captured) return values.includes(captured);
    let elig = {};
    try { elig = JSON.parse(form?.eligibility_json || '{}') || {}; } catch (e) {}
    const groupField = elig.group_field || 'class';
    return values.includes(bandNameServer(form?.eligibility_json, leaderProfile?.[groupField]));
  }
  // 'category' merges every field actually NAMED "Category" (this form has
  // two — one per eligibility Group, each shown by its own show_if), same
  // first-match-wins fallback as answerByName already applies everywhere
  // else a project's category is read — a plain 'answer:<data_key>' scope
  // would only ever match teams routed to ONE specific variant.
  if (dim === 'category') {
    let fields = [];
    try { fields = JSON.parse(form?.fields_json || '[]') || []; } catch (e) {}
    return values.includes(answerByName(fields, team.group_data, /^category$/i));
  }
  if (dim.startsWith('answer:')) {
    const key = dim.slice('answer:'.length);
    return values.includes(String((team.group_data || {})[key] ?? ''));
  }
  return false;
}
// A rubric's filter is compound — House AND Category AND Group together
// (any dimension left empty is unconstrained), same shape and logic as the
// Judges Sheet print's own "Filter teams in this print" panel — not just
// one dimension at a time, so "Category 1 AND Group A" is one rubric's
// actual condition, not something achievable only by picking one or the
// other. At least one dimension must have a value, or this rubric matches
// nothing (an empty filter was never finished being set up).
function teamMatchesRubricFilter(teamFacts, rubric) {
  const f = rubric.filters || {};
  const house = Array.isArray(f.house) ? f.house : [];
  const category = Array.isArray(f.category) ? f.category : [];
  const group = Array.isArray(f.group) ? f.group : [];
  if (!house.length && !category.length && !group.length) return false;
  if (house.length && !house.includes(teamFacts.house)) return false;
  if (category.length && !category.includes(teamFacts.category)) return false;
  if (group.length && !group.includes(teamFacts.group)) return false;
  return true;
}
// Which rubric (named score-column set) applies for this judge scoring
// this team. A rubric assigned directly to this judge always wins — an
// admin who hand-picked a judge for a rubric meant that to stick, not be
// overridden by whichever teams that judge happens to be scoped to see.
// Otherwise a rubric whose filter matches this team's own house/category/
// group/answer value applies — the SAME rubric then, regardless of which
// judge is scoring, since it's tied to the team's own attributes. Falls
// back to the form's plain default rubric (judging_criteria_json) when
// neither matches.
function resolveRubric(judgeId, teamFacts, rubricSets, defaultCriteria) {
  const judgeRubric = rubricSets.find(r => r.assign_type === 'judges' && Array.isArray(r.judge_ids) && r.judge_ids.map(String).includes(String(judgeId)));
  if (judgeRubric) return judgeRubric;
  const filterRubric = rubricSets.find(r => r.assign_type === 'filter' && teamMatchesRubricFilter(teamFacts, r));
  if (filterRubric) return filterRubric;
  return { id: 'default', name: 'Default', criteria: defaultCriteria };
}
function scopeLabel(judge) {
  const dim = judge.scope_dimension || 'all';
  if (dim === 'all') return '';
  const values = scopeValuesOf(judge);
  const dimLabel = dim === 'class' ? 'Class' : dim === 'house' ? 'House' : dim === 'group' ? 'Group' : dim === 'category' ? 'Category' : dim.startsWith('answer:') ? dim.slice(7) : dim;
  return `${dimLabel}: ${values.join(', ')}`;
}

async function loadRosterAndScores(judge) {
  const [formRows, teamRows, judgeScoreRows] = await Promise.all([
    sb(`group_forms?id=eq.${encodeURIComponent(judge.group_form_id)}&select=id,title,header,sub_header,fields_json,eligibility_json,judging_criteria_json,judging_rubric_sets_json,judges_sort_json,judges_link_fields_json,archived`),
    sb(`group_form_teams?group_form_id=eq.${encodeURIComponent(judge.group_form_id)}&status=neq.disbanded&review_status=eq.approved&select=id,leader_student_id,group_data,reference_number&order=created_at.asc,id.asc`),
    sb(`group_form_judge_scores?judge_id=eq.${encodeURIComponent(judge.id)}&select=team_id,scores_json`),
  ]);
  const form = Array.isArray(formRows) && formRows[0];
  if (!form) return null;

  const allTeams = Array.isArray(teamRows) ? teamRows : [];
  const memberRows = allTeams.length
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

  const teams = allTeams.filter(t => {
    const teamMembers = membersByTeam[t.id] || [];
    const leader = teamMembers.find(m => m.role === 'leader') || teamMembers[0] || null;
    return judgeScopeMatches(t, form, judge, leader && leader.profile);
  });

  let fields = [];
  try { fields = JSON.parse(form.fields_json || '[]') || []; } catch (e) {}
  let defaultCriteria = [];
  try { defaultCriteria = JSON.parse(form.judging_criteria_json || '[]') || []; } catch (e) {}
  let rubricSets = [];
  try { rubricSets = JSON.parse(form.judging_rubric_sets_json || '[]') || []; } catch (e) {}

  const scoresByTeam = {};
  (Array.isArray(judgeScoreRows) ? judgeScoreRows : []).forEach(r => {
    try { scoresByTeam[r.team_id] = JSON.parse(r.scores_json || '{}') || {}; } catch (e) { scoresByTeam[r.team_id] = {}; }
  });

  const rubricsUsed = {}; // rubric_id -> {id, name, criteria} actually seen among this judge's teams
  const teamInfos = teams.map(t => {
    const teamMembers = membersByTeam[t.id] || [];
    const leader = teamMembers.find(m => m.role === 'leader') || teamMembers[0] || null;
    const house = (leader && leader.profile && leader.profile.house) || '';
    const title = answerByName(fields, t.group_data, /project|poster|title/i) || 'Untitled Project';
    const descriptionFull = answerByName(fields, t.group_data, /detail|description/i);
    const description = capWords(descriptionFull, 20);
    const category = answerByName(fields, t.group_data, /^category$/i) || '';
    const group = (t.group_data || {}).group || '';
    const rubric = resolveRubric(judge.id, { house, category, group, group_data: t.group_data }, rubricSets, defaultCriteria);
    rubricsUsed[rubric.id] = { id: rubric.id, name: rubric.name, criteria: rubric.criteria };
    return {
      team_id: t.id,
      reference_number: t.reference_number || ('#' + t.id),
      house,
      category,
      group,
      title,
      description,
      description_full: descriptionFull,
      rubric_id: rubric.id,
      criteria: rubric.criteria,
      members: teamMembers.map(m => ({
        name: (m.profile && m.profile.student_name) || m.student_id,
        student_id: m.student_id,
        class: (m.profile && m.profile.class) || '',
        section: (m.profile && m.profile.section) || '',
        roll: (m.profile && m.profile.roll) || '',
        role: m.role === 'leader' ? 'Leader' : 'Member',
        class_section_roll: m.profile ? [m.profile.class, m.profile.section].filter(Boolean).join('-') + (m.profile.roll ? '-' + m.profile.roll : '') : '',
      })),
      scores: scoresByTeam[t.id] || {},
    };
  });

  let sortConfig = { levels: [], locked: false };
  try {
    const parsed = JSON.parse(form.judges_sort_json || '{}') || {};
    sortConfig = { levels: Array.isArray(parsed.levels) ? parsed.levels : [], locked: !!parsed.locked };
  } catch (e) {}

  // Which non-score info fields show on this page — an empty/unset list
  // (the common case, and every pre-existing form) means "show everything",
  // same backward-compat shape as sortConfig above.
  const LINK_FIELD_KEYS = ['reference_number', 'house', 'category', 'group', 'members', 'title', 'description'];
  let linkFields = []; try { linkFields = JSON.parse(form.judges_link_fields_json || '[]') || []; } catch (e) {}
  const visibleFields = {};
  LINK_FIELD_KEYS.forEach(k => { visibleFields[k] = !linkFields.length || linkFields.includes(k); });

  return {
    formTitle: form.title,
    formHeader: form.header || form.title,
    formSubHeader: form.sub_header || '',
    archived: !!form.archived,
    criteria: defaultCriteria,
    rubrics: Object.values(rubricsUsed),
    teams: teamInfos,
    scopeLabel: scopeLabel(judge),
    sortConfig,
    visibleFields,
  };
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
  .team-tags{font-size:.7rem; font-weight:700; color:var(--ink-muted);}
  .team-rubric{font-size:.68rem; font-weight:800; color:var(--accent-ink); background:rgba(36,84,232,.12); padding:.15rem .5rem; border-radius:999px;}
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

  .view-toggle{display:flex; align-items:center; gap:.5rem; margin-top:1rem; flex-wrap:wrap;}
  .view-btn{border:1px solid var(--border); background:var(--surface); color:var(--ink-muted); font-weight:700; font-size:.78rem; padding:.4rem .85rem; border-radius:999px; cursor:pointer;}
  .view-btn.active{background:var(--accent); color:#fff; border-color:var(--accent);}
  .edit-lock-btn{border:1.5px solid var(--warn); background:transparent; color:var(--warn); font-weight:800; font-size:.78rem; padding:.4rem .85rem; border-radius:999px; cursor:pointer;}
  .edit-lock-btn.unlocked{border-color:var(--good); background:var(--good); color:#fff;}
  .edit-lock-btn:disabled{opacity:.5; cursor:default;}

  .toolbar{display:flex; align-items:center; gap:.5rem; margin-top:.9rem; flex-wrap:wrap;}
  .toolbar-btn{display:flex; align-items:center; gap:.4rem; border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-weight:800; font-size:.8rem; padding:.45rem .9rem; border-radius:999px; cursor:pointer;}
  .toolbar-btn.open{border-color:var(--accent); color:var(--accent-ink);}
  .toolbar-btn:disabled{opacity:.5; cursor:default;}
  .toolbar-badge{display:inline-flex; align-items:center; justify-content:center; min-width:1.15rem; height:1.15rem; padding:0 .3rem; border-radius:999px; background:var(--accent); color:#fff; font-size:.68rem; font-weight:800;}
  .toolbar-badge.hidden{display:none;}
  .print-btn{border:1.5px solid var(--accent); background:transparent; color:var(--accent-ink); font-weight:800; font-size:.8rem; padding:.42rem .9rem; border-radius:999px; cursor:pointer; margin-left:auto;}

  .sort-levels{display:flex; flex-direction:column; gap:.5rem;}
  .sort-level-row{display:flex; align-items:center; gap:.4rem; flex-wrap:wrap;}
  .sort-level-row .sort-level-n{font-size:.72rem; font-weight:800; color:var(--ink-muted); width:1.1rem;}
  .sort-select{border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-weight:700; font-size:.8rem; padding:.42rem .6rem; border-radius:10px;}
  .sort-dir-btn{border:1.5px solid var(--border); background:var(--surface); color:var(--ink-muted); font-weight:700; font-size:.8rem; padding:.42rem .7rem; border-radius:10px; cursor:pointer;}
  .sort-remove-btn{border:none; background:none; color:#d8453a; font-weight:800; font-size:.9rem; padding:.2rem .4rem; cursor:pointer;}
  .sort-remove-btn:disabled{opacity:.3; cursor:default;}
  .sort-add-row{margin-top:.6rem;}
  .sort-add-select{border:1.5px solid var(--border); background:var(--surface); color:var(--ink); font-weight:700; font-size:.78rem; padding:.4rem .6rem; border-radius:10px;}
  .sort-locked-note{margin:.6rem 0 0; font-size:.76rem; font-weight:700; color:var(--ink-muted);}
  .sort-locked-note.hidden{display:none;}

  .filter-panel{margin-top:.6rem; padding:.9rem 1rem; border:1.5px solid var(--border); border-radius:14px; background:var(--surface);}
  .filter-panel.hidden{display:none;}
  .filter-dim{margin-bottom:.8rem;}
  .filter-dim:last-of-type{margin-bottom:0;}
  .filter-dim-label{display:block; font-size:.7rem; font-weight:800; color:var(--ink-muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;}
  .filter-chip-group{display:flex; flex-wrap:wrap; gap:.45rem;}
  .filter-chip{border:1.5px solid var(--border); background:var(--bg); color:var(--ink-muted); font-weight:700; font-size:.78rem; padding:.4rem .8rem; border-radius:999px; cursor:pointer;}
  .filter-chip.active{background:var(--accent); color:#fff; border-color:var(--accent); font-weight:800;}
  .clear-filters-btn{display:block; border:none; background:none; color:#d8453a; font-weight:800; font-size:.76rem; padding:.6rem 0 0; cursor:pointer;}
  .clear-filters-btn.hidden{display:none;}
  .result-count{margin-top:.6rem; font-size:.78rem; font-weight:700; color:var(--ink-muted);}
  .result-count b{color:var(--ink);}
  .save-all-btn{border:none; background:var(--good); color:#fff; font-weight:700; font-size:.78rem; padding:.45rem 1rem; border-radius:999px; cursor:pointer; margin-left:auto;}
  .save-all-btn:disabled{opacity:.5; cursor:default;}
  .save-all-btn.hidden{display:none;}
  .save-all-status{font-size:.76rem; font-weight:700; color:var(--ink-muted); white-space:nowrap;}

  #sheet-host.hidden, #teams-host.hidden{display:none;}
  .sheet-wrap{overflow-x:auto; margin-top:.9rem; border:1px solid var(--border); border-radius:14px; background:var(--surface); box-shadow:var(--shadow);}
  .rubric-list{margin-top:.5rem; font-size:.78rem; font-weight:700; color:var(--ink-muted);}
  .rubric-list b{color:var(--ink);}
  table.sheet{border-collapse:collapse; width:100%; font-size:.78rem;}
  table.sheet th, table.sheet td{border-bottom:1px solid var(--border); border-right:1px solid var(--border); padding:.32rem .4rem; text-align:left; white-space:nowrap;}
  table.sheet th:last-child, table.sheet td:last-child{border-right:none;}
  table.sheet thead th{position:sticky; top:0; background:var(--bg); color:var(--ink-muted); font-size:.64rem; font-weight:800; text-transform:uppercase; letter-spacing:.03em; z-index:1;}
  table.sheet th.crit-th{max-width:4.4rem;}
  table.sheet th.crit-th .crit-th-label{display:inline-block; max-width:4.4rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;}
  table.sheet td.sheet-team{min-width:170px; max-width:220px; white-space:normal;}
  table.sheet td.sheet-team .sheet-ref{font-weight:800; color:var(--accent-ink); margin-right:.4rem;}
  table.sheet td.sheet-team .sheet-tags{color:var(--ink-muted); font-size:.74rem; margin-right:.4rem;}
  table.sheet td.sheet-team .sheet-members{color:var(--ink-muted); font-size:.74rem; margin-top:.15rem;}
  table.sheet td.sheet-sl{text-align:center; color:var(--ink-muted); font-weight:700;}
  table.sheet input.sheet-input{width:3rem; padding:.25rem .3rem; border-radius:7px; border:1.5px solid var(--border); background:var(--bg); color:var(--ink); font-weight:700; font-size:.8rem; text-align:center;}
  table.sheet input.sheet-input:focus{border-color:var(--accent); outline:none;}
  table.sheet td.sheet-total{font-weight:800; text-align:center;}
  table.sheet td.sheet-status{text-align:center; font-size:.75rem; font-weight:800; width:1.6rem;}
  table.sheet td.sheet-status.ok{color:var(--good);}
  table.sheet td.sheet-status.err{color:#d8453a;}
  table.sheet tbody tr.dirty td.sheet-status{color:var(--warn);}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <span class="eyebrow">Judging</span>
    <h1>${esc(data.formTitle)}</h1>
    <div class="judge-line">Signed in as <strong>${esc(judge.name)}</strong>${data.scopeLabel ? ` · Scope: <strong>${esc(data.scopeLabel)}</strong>` : ''}</div>
    ${data.rubrics.length > 1
      ? `<div class="rubric-list"><b>Rubrics:</b> ${data.rubrics.map(r => esc(r.name)).join(', ')}</div>`
      : `<div class="crit-strip">${criteriaHtml}</div>`}
    ${data.archived ? `<div class="archived-banner">${esc(ARCHIVED_MESSAGE)}</div>` : ''}
    ${data.teams.length ? `<div class="view-toggle">
      <button type="button" id="edit-lock-btn" class="edit-lock-btn locked"${data.archived ? ' disabled' : ''}>🔒 Enable Edit</button>
      <button type="button" id="view-cards-btn" class="view-btn">Cards</button>
      <button type="button" id="view-sheet-btn" class="view-btn active">Sheet (Excel-style)</button>
      <button type="button" id="save-all-btn" class="save-all-btn hidden"${data.archived ? ' disabled' : ''}>Save All</button>
      <span id="save-all-status" class="save-all-status"></span>
    </div>
    <div class="toolbar">
      <button type="button" id="filter-toggle-btn" class="toolbar-btn">Filter <span id="filter-badge" class="toolbar-badge hidden">0</span></button>
      <button type="button" id="sort-toggle-btn" class="toolbar-btn">Sort <span id="sort-badge" class="toolbar-badge hidden">0</span></button>
      <button type="button" id="download-excel-btn" class="toolbar-btn" title="Download the currently filtered teams as an Excel file to fill offline">⬇ Excel</button>
      <button type="button" id="upload-excel-btn" class="toolbar-btn"${data.archived ? ' disabled' : ''} title="Upload a filled Excel file — values land in the Sheet view for you to review, then Save All">⬆ Excel</button>
      <button type="button" id="download-project-csv-btn" class="toolbar-btn" title="Download project details as a CSV — one row per team member, with leader/member identity, project title and full details">⬇ Project CSV</button>
      <input type="file" id="upload-excel-input" accept=".xlsx,.xls" style="display:none">
      <button type="button" id="print-sheet-btn" class="print-btn">🖨 Print</button>
    </div>
    <div id="filter-panel" class="filter-panel hidden">
      <div id="filter-chips" class="filter-chips"></div>
      <button type="button" id="clear-filters-btn" class="clear-filters-btn hidden">✕ Clear all filters</button>
    </div>
    <div id="sort-panel" class="filter-panel hidden">
      <div id="sort-levels" class="sort-levels"></div>
      <div id="sort-add-row" class="sort-add-row"></div>
      <p id="sort-locked-note" class="sort-locked-note hidden">🔒 Sort order is set by admin and can't be changed here.</p>
    </div>
    <div id="result-count" class="result-count"></div>
    <div id="excel-status" class="result-count"></div>` : ''}
  </div>
  <div id="teams-host" class="hidden">${data.teams.length ? '' : '<div class="empty">No teams to judge yet.</div>'}</div>
  <div id="sheet-host"></div>
</div>

<script>
(function(){
  "use strict";
  var TEAMS = ${teamsForClient};
  var CRITERIA = ${criteriaForClient};
  var ARCHIVED = ${data.archived ? 'true' : 'false'};
  var JUDGE_NAME = ${JSON.stringify(judge.name)};
  var FORM_TITLE = ${JSON.stringify(data.formTitle)};
  var FORM_HEADER = ${JSON.stringify(data.formHeader)};
  var FORM_SUBHEADER = ${JSON.stringify(data.formSubHeader)};
  var RUBRICS = ${JSON.stringify(data.rubrics)};
  var MULTI_RUBRIC = RUBRICS.length > 1;
  var SORT_CONFIG = ${JSON.stringify(data.sortConfig)};
  var VISIBLE_FIELDS = ${JSON.stringify(data.visibleFields)};
  var rubricNameById = {};
  RUBRICS.forEach(function(r){ rubricNameById[r.id] = r.name; });
  var host = document.getElementById('teams-host');

  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }

  var TEAMS_BY_ID = {};
  TEAMS.forEach(function(t){ TEAMS_BY_ID[t.team_id] = t; });

  // ── Filter + sort over the already-loaded TEAMS (client-side only — no
  // refetch) ───────────────────────────────────────────────────────────────
  var filterState = { house: [], category: [], group: [] };
  var SORT_FIELDS = {
    reference_number: { label: 'Reference No.', get: function(t){ return t.reference_number || ''; }, type: 'text' },
    title: { label: 'Project Title', get: function(t){ return t.title || ''; }, type: 'text' },
    house: { label: 'House', get: function(t){ return t.house || ''; }, type: 'text' },
    category: { label: 'Category', get: function(t){ return t.category || ''; }, type: 'text' },
    group: { label: 'Group', get: function(t){ return t.group || ''; }, type: 'text' },
    total: { label: 'My Total', get: function(t){ var v = teamTotal(t); return v == null ? -Infinity : v; }, type: 'number' },
  };
  // Multiple sort levels, in priority order — each {field, dir}, ties on
  // the first level broken by the second, and so on. Seeded from the
  // admin's own default (SORT_CONFIG, set from the roster's "Judges Sort"
  // panel); if the admin locked it, SORT_LOCKED disables the whole panel
  // instead of just hiding it, so a judge can still SEE what order is
  // being applied without being able to touch it.
  var SORT_LOCKED = !!SORT_CONFIG.locked;
  var sortLevels = (SORT_CONFIG.levels || []).filter(function(l){ return l && SORT_FIELDS[l.field]; });
  if (!sortLevels.length) sortLevels = [{ field: 'reference_number', dir: 'asc' }];
  function distinctValues(key){
    var seen = {}, out = [];
    TEAMS.forEach(function(t){ var v = t[key]; if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }
  function teamMatchesFilter(t){
    if (filterState.house.length && filterState.house.indexOf(t.house) === -1) return false;
    if (filterState.category.length && filterState.category.indexOf(t.category) === -1) return false;
    if (filterState.group.length && filterState.group.indexOf(t.group) === -1) return false;
    return true;
  }
  function activeFilterSummary(){
    var parts = [];
    [['house','House'],['category','Category'],['group','Group']].forEach(function(p){
      if (filterState[p[0]].length) parts.push(p[1] + ': ' + filterState[p[0]].join('/'));
    });
    return parts.join(' · ');
  }
  function activeSortSummary(){
    return sortLevels.map(function(l){
      var def = SORT_FIELDS[l.field] || SORT_FIELDS.reference_number;
      return def.label + ' (' + (l.dir === 'desc' ? 'Z→A' : 'A→Z') + ')';
    }).join(' → ');
  }
  function visibleTeams(){
    var list = TEAMS.filter(teamMatchesFilter);
    list.sort(function(a, b){
      for (var i = 0; i < sortLevels.length; i++){
        var def = SORT_FIELDS[sortLevels[i].field] || SORT_FIELDS.reference_number;
        var va = def.get(a), vb = def.get(b), cmp;
        if (def.type === 'number') cmp = (Number(va) || 0) - (Number(vb) || 0);
        else cmp = String(va).localeCompare(String(vb));
        if (sortLevels[i].dir === 'desc') cmp = -cmp;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    return list;
  }
  // Reads whatever's currently typed into EVERY score input on the page
  // (both views, since both can exist in the DOM at once) back into
  // TEAMS[].scores — called before any filter/sort/rebuild so a judge's
  // not-yet-saved typing is never lost just because the view re-rendered
  // around it.
  function syncScoresFromDOM(){
    document.querySelectorAll('input.score-input, input.sheet-input').forEach(function(inp){
      var team = TEAMS_BY_ID[Number(inp.getAttribute('data-team'))];
      if (!team) return;
      var key = inp.getAttribute('data-crit');
      if (inp.value === '') { delete team.scores[key]; return; }
      var v = Number(inp.value);
      if (!isNaN(v)) team.scores[key] = v;
    });
  }

  function teamTotal(team){
    var sum = 0, any = false;
    (team.criteria || CRITERIA).forEach(function(c){
      var v = Number(team.scores[c.key]);
      if (!isNaN(v)) { sum += v; any = true; }
    });
    return any ? sum : null;
  }

  // Shared by the card view's own Save button and the Sheet view's Save
  // All loop — one team's worth of scores, one POST, same contract either
  // way (the server only ever sees "save this team's scores", never a
  // bulk shape) so nothing on the backend needed to change for Sheet view
  // to exist.
  async function saveTeamScores(teamId, scores){
    try {
      var res = await fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, scores: scores }),
      });
      var data = await res.json();
      if (data && data.result === 'success') return { ok: true };
      return { ok: false, message: (data && data.message) || 'Could not save.' };
    } catch(e){
      return { ok: false, message: 'Network error — try again.' };
    }
  }
  function readScoresFromInputs(inputs){
    var scores = {}, bad = false;
    inputs.forEach(function(inp){
      if (inp.value === '') return;
      var v = Number(inp.value);
      if (isNaN(v) || v < 0 || v > Number(inp.max)) bad = true;
      scores[inp.getAttribute('data-crit')] = v;
    });
    return { scores: scores, bad: bad };
  }

  function renderTeam(team, idx){
    var card = document.createElement('div');
    card.className = 'team-card';
    var membersHtml = team.members.map(function(m){
      return '<div class="team-member">' + esc(m.name) + (m.class_section_roll ? ' <span class="csr">(' + esc(m.class_section_roll) + ')</span>' : '') + '</div>';
    }).join('');
    var teamCriteria = team.criteria || CRITERIA;
    var fieldsHtml = teamCriteria.map(function(c){
      var existing = team.scores[c.key];
      return '<div class="score-field"><label>' + esc(c.label) + ' (out of ' + esc(c.max) + ')</label>' +
        '<input type="number" class="score-input" min="0" max="' + esc(c.max) + '" step="1" data-team="' + team.team_id + '" data-crit="' + esc(c.key) + '" value="' + (existing != null ? esc(existing) : '') + '" readonly' + (ARCHIVED ? ' disabled' : '') + '></div>';
    }).join('');
    var tagParts = [];
    if (VISIBLE_FIELDS.house && team.house) tagParts.push(team.house);
    if (VISIBLE_FIELDS.category && team.category) tagParts.push(team.category);
    if (VISIBLE_FIELDS.group && team.group) tagParts.push(team.group);
    var tagsHtml = tagParts.length ? '<span class="team-tags">' + esc(tagParts.join(' · ')) + '</span>' : '';
    card.innerHTML =
      '<div class="team-top"><span class="team-sl">#' + (idx + 1) + '</span>' +
        (VISIBLE_FIELDS.reference_number ? '<span class="team-ref">' + esc(team.reference_number) + '</span>' : '') +
        tagsHtml +
        (MULTI_RUBRIC ? '<span class="team-rubric">' + esc(rubricNameById[team.rubric_id] || 'Default') + '</span>' : '') + '</div>' +
      (VISIBLE_FIELDS.members ? '<div class="team-members">' + membersHtml + '</div>' : '') +
      (VISIBLE_FIELDS.title ? '<div class="team-title">' + esc(team.title) + '</div>' : '') +
      (VISIBLE_FIELDS.description && team.description ? '<div class="team-desc">' + esc(team.description) + '</div>' : '') +
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
      var r = readScoresFromInputs(inputs);
      if (r.bad) { statusEl.textContent = 'One or more scores are out of range.'; statusEl.className = 'save-status err'; return; }
      saveBtn.disabled = true;
      statusEl.textContent = 'Saving…'; statusEl.className = 'save-status';
      var res = await saveTeamScores(team.team_id, r.scores);
      statusEl.textContent = res.ok ? 'Saved ✓' : res.message;
      statusEl.className = res.ok ? 'save-status ok' : 'save-status err';
      saveBtn.disabled = !!ARCHIVED;
    });

    return card;
  }

  function rebuildCards(list){
    host.innerHTML = '';
    if (!list.length) { host.innerHTML = '<div class="empty">No teams match this filter.</div>'; return; }
    list.forEach(function(team, idx){ host.appendChild(renderTeam(team, idx)); });
  }

  // ── Sheet (Excel-style) view ─────────────────────────────────────────────
  // Same data, laid out as one row per team / one column per criterion so
  // a judge typing scores for many teams can tab straight across instead
  // of scrolling and tapping Save on a card at a time. Nothing saves until
  // "Save All" is clicked — same reasoning a real spreadsheet doesn't save
  // itself after every keystroke — then every row with a value actually
  // typed into it gets its own POST (same saveTeamScores as the card view),
  // one at a time so the status line can report real progress.
  var sheetHost = document.getElementById('sheet-host');
  var cardsBtn = document.getElementById('view-cards-btn');
  var sheetBtn = document.getElementById('view-sheet-btn');
  var saveAllBtn = document.getElementById('save-all-btn');
  var saveAllStatus = document.getElementById('save-all-status');

  // Every score input starts read-only (set directly in the markup above,
  // for both Cards and Sheet) so scrolling, tapping around, or arrow-
  // keying across the Sheet view can't accidentally overwrite a value —
  // typing requires deliberately unlocking first. Toggling re-scans
  // live (not a fixed list captured once) so it still works correctly
  // after the Sheet view's own lazy build runs.
  var editLockBtn = document.getElementById('edit-lock-btn');
  var editEnabled = false;
  function applyEditLock(){
    document.querySelectorAll('input.score-input, input.sheet-input').forEach(function(inp){ inp.readOnly = !editEnabled; });
    if (!editLockBtn) return;
    editLockBtn.textContent = editEnabled ? '🔓 Lock Editing' : '🔒 Enable Edit';
    editLockBtn.classList.toggle('unlocked', editEnabled);
  }
  if (editLockBtn) editLockBtn.addEventListener('click', function(){ editEnabled = !editEnabled; applyEditLock(); });

  // One team's info cell, built from whichever non-score fields the admin
  // left on (VISIBLE_FIELDS) — shared between the live Sheet view and the
  // judge's own Print button so both stay in sync automatically.
  function teamInfoCellHtml(team){
    var tagParts = [];
    if (VISIBLE_FIELDS.house && team.house) tagParts.push(team.house);
    if (VISIBLE_FIELDS.category && team.category) tagParts.push(team.category);
    if (VISIBLE_FIELDS.group && team.group) tagParts.push(team.group);
    var html = '';
    if (VISIBLE_FIELDS.reference_number) html += '<span class="sheet-ref">' + esc(team.reference_number) + '</span>';
    if (tagParts.length) html += '<span class="sheet-tags">' + esc(tagParts.join(' · ')) + '</span>';
    if (VISIBLE_FIELDS.title) html += esc(team.title);
    if (VISIBLE_FIELDS.members) {
      var membersLine = team.members.map(function(m){ return m.name; }).join(', ');
      if (membersLine) html += '<div class="sheet-members">' + esc(membersLine) + '</div>';
    }
    if (VISIBLE_FIELDS.description && team.description) html += '<div class="sheet-members">' + esc(team.description) + '</div>';
    return html;
  }

  // Grouped by resolved rubric, one table per distinct rubric among the
  // currently visible teams — a single uniform table can't work once
  // different teams can have different score columns (filter-assigned
  // rubrics vary by the TEAM, not the judge, so the same judge can see
  // more than one). The overwhelmingly common case (one rubric for this
  // whole judge) still renders as exactly one table, unchanged.
  function groupByRubric(list){
    var order = [], byId = {};
    list.forEach(function(team){
      var id = team.rubric_id || 'default';
      if (!byId[id]) { byId[id] = { id: id, criteria: team.criteria || CRITERIA, teams: [] }; order.push(id); }
      byId[id].teams.push(team);
    });
    return order.map(function(id){ return byId[id]; });
  }
  function rebuildSheet(list){
    if (!sheetHost) return;
    sheetHost.innerHTML = '';
    if (!list.length) { sheetHost.innerHTML = '<div class="empty">No teams match this filter.</div>'; return; }
    var groups = groupByRubric(list);
    groups.forEach(function(grp){
      var wrap = document.createElement('div');
      wrap.className = 'sheet-wrap';
      var theadCells = '<th>SL</th><th>Team</th>' + grp.criteria.map(function(c){ return '<th class="crit-th" title="' + esc(c.label) + '"><span class="crit-th-label">' + esc(c.short || c.label) + '</span><br>/' + esc(c.max) + '</th>'; }).join('') + '<th>Total</th><th></th>';
      var rows = grp.teams.map(function(team, idx){
        var cells = grp.criteria.map(function(c, colIdx){
          var existing = team.scores[c.key];
          return '<td><input type="number" class="sheet-input" min="0" max="' + esc(c.max) + '" step="1" data-team="' + team.team_id + '" data-crit="' + esc(c.key) + '" data-row="' + idx + '" data-col="' + colIdx + '" value="' + (existing != null ? esc(existing) : '') + '" readonly' + (ARCHIVED ? ' disabled' : '') + '></td>';
        }).join('');
        return '<tr data-team-row="' + team.team_id + '">' +
          '<td class="sheet-sl">' + (idx + 1) + '</td>' +
          '<td class="sheet-team">' + teamInfoCellHtml(team) + '</td>' +
          cells +
          '<td class="sheet-total">—</td>' +
          '<td class="sheet-status"></td>' +
        '</tr>';
      }).join('');
      wrap.innerHTML = '<table class="sheet"><thead><tr>' + theadCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
      sheetHost.appendChild(wrap);
    });

    function recomputeRow(tr){
      var inputs = tr.querySelectorAll('input[data-crit]');
      var sum = 0, any = false;
      inputs.forEach(function(inp){
        var v = Number(inp.value);
        if (inp.value !== '' && !isNaN(v)) { sum += v; any = true; }
      });
      tr.querySelector('.sheet-total').textContent = any ? sum : '—';
      tr.classList.add('dirty');
    }
    sheetHost.querySelectorAll('input.sheet-input').forEach(function(inp){
      inp.addEventListener('input', function(){ recomputeRow(inp.closest('tr')); });
    });

    // Excel-style arrow-key navigation: Left/Right/Up/Down move to the
    // adjacent cell instead of their native effect (a number input's own
    // cursor move, or the browser's spin-button value nudge on Up/Down) —
    // same as how a real spreadsheet treats arrow keys as cell-to-cell
    // movement, not in-cell text editing. Moving the cursor within a
    // cell's digits isn't supported this way (small 0-25 scores, not
    // worth the extra mode a real spreadsheet has) — arrives, selects the
    // whole value, ready to type over. Scoped to the input's OWN table
    // (.sheet-wrap), not the whole sheet — with more than one rubric group
    // now possible, row/col numbering restarts at 0 in each group's own
    // table, so a sheet-wide lookup could jump into the wrong group.
    function focusCell(scope, row, col){
      var target = scope.querySelector('input[data-row="' + row + '"][data-col="' + col + '"]');
      if (!target) return false;
      target.focus();
      target.select();
      return true;
    }
    sheetHost.querySelectorAll('input.sheet-input').forEach(function(inp){
      inp.addEventListener('keydown', function(e){
        var scope = inp.closest('.sheet-wrap');
        var row = Number(inp.getAttribute('data-row')), col = Number(inp.getAttribute('data-col'));
        if (e.key === 'ArrowLeft') { if (focusCell(scope, row, col - 1)) e.preventDefault(); }
        else if (e.key === 'ArrowRight') { if (focusCell(scope, row, col + 1)) e.preventDefault(); }
        else if (e.key === 'ArrowUp') { if (focusCell(scope, row - 1, col)) e.preventDefault(); }
        else if (e.key === 'ArrowDown') { if (focusCell(scope, row + 1, col)) e.preventDefault(); }
      });
    });
    // Pre-filled rows (already-saved scores) should show their real total
    // immediately, not just once the judge touches an input — but doing
    // this must not mark a row "dirty" (recomputeRow does, for the input
    // listener's case), since nothing here actually changed yet.
    sheetHost.querySelectorAll('tr[data-team-row]').forEach(function(tr){
      recomputeRow(tr);
      tr.classList.remove('dirty');
    });
  }

  function setView(view){
    var showSheet = view === 'sheet';
    sheetHost.classList.toggle('hidden', !showSheet);
    host.classList.toggle('hidden', showSheet);
    sheetBtn.classList.toggle('active', showSheet);
    cardsBtn.classList.toggle('active', !showSheet);
    if (saveAllBtn) saveAllBtn.classList.toggle('hidden', !showSheet);
    if (saveAllStatus) saveAllStatus.textContent = '';
  }
  if (cardsBtn) cardsBtn.addEventListener('click', function(){ setView('cards'); });
  if (sheetBtn) sheetBtn.addEventListener('click', function(){ setView('sheet'); });

  if (saveAllBtn) saveAllBtn.addEventListener('click', async function(){
    var rows = Array.prototype.filter.call(sheetHost.querySelectorAll('tr[data-team-row]'), function(tr){ return tr.classList.contains('dirty'); });
    if (!rows.length) { saveAllStatus.textContent = 'Nothing changed to save.'; return; }
    saveAllBtn.disabled = true;
    var okCount = 0, errCount = 0;
    for (var i = 0; i < rows.length; i++){
      var tr = rows[i];
      saveAllStatus.textContent = 'Saving ' + (i + 1) + ' of ' + rows.length + '…';
      var teamId = Number(tr.getAttribute('data-team-row'));
      var inputs = tr.querySelectorAll('input[data-crit]');
      var r = readScoresFromInputs(inputs);
      var statusCell = tr.querySelector('.sheet-status');
      if (r.bad) { statusCell.textContent = '!'; statusCell.className = 'sheet-status err'; errCount++; continue; }
      var res = await saveTeamScores(teamId, r.scores);
      if (res.ok) { statusCell.textContent = '✓'; statusCell.className = 'sheet-status ok'; tr.classList.remove('dirty'); okCount++; }
      else { statusCell.textContent = '!'; statusCell.className = 'sheet-status err'; statusCell.title = res.message; errCount++; }
    }
    saveAllStatus.textContent = 'Saved ' + okCount + (errCount ? ', ' + errCount + ' failed' : '') + '.';
    saveAllBtn.disabled = !!ARCHIVED;
  });

  // ── Filter chips, sort controls, rerender, print ────────────────────────
  var filterToggleBtn = document.getElementById('filter-toggle-btn');
  var filterBadge = document.getElementById('filter-badge');
  var filterPanel = document.getElementById('filter-panel');
  var filterChipsHost = document.getElementById('filter-chips');
  var clearFiltersBtn = document.getElementById('clear-filters-btn');
  var resultCountEl = document.getElementById('result-count');
  var sortToggleBtn = document.getElementById('sort-toggle-btn');
  var sortBadge = document.getElementById('sort-badge');
  var sortPanel = document.getElementById('sort-panel');
  var sortLevelsHost = document.getElementById('sort-levels');
  var sortAddRowHost = document.getElementById('sort-add-row');
  var sortLockedNote = document.getElementById('sort-locked-note');
  var printBtn = document.getElementById('print-sheet-btn');

  function activeFilterCount(){
    return filterState.house.length + filterState.category.length + filterState.group.length;
  }
  if (filterToggleBtn) filterToggleBtn.addEventListener('click', function(){
    var opening = filterPanel.classList.contains('hidden');
    filterPanel.classList.toggle('hidden', !opening);
    filterToggleBtn.classList.toggle('open', opening);
  });
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', function(){
    filterState.house = []; filterState.category = []; filterState.group = [];
    syncScoresFromDOM();
    rerender();
  });

  // Each dimension gets its own clearly labeled row of chips (House,
  // Category, Group), so it's obvious which group a chip belongs to
  // rather than one undifferentiated row of buttons — same structure as
  // the admin panel's own Filters section, just scoped to this one
  // judge's own assigned teams.
  function renderFilterChips(){
    if (!filterChipsHost) return;
    var dims = [
      { key: 'house', label: 'House', values: distinctValues('house') },
      { key: 'category', label: 'Category', values: distinctValues('category') },
      { key: 'group', label: 'Group', values: distinctValues('group') },
    ].filter(function(d){ return d.values.length; });
    filterChipsHost.innerHTML = dims.length ? dims.map(function(d){
      return '<div class="filter-dim"><span class="filter-dim-label">' + esc(d.label) + '</span><div class="filter-chip-group">' +
        d.values.map(function(v){
          var active = filterState[d.key].indexOf(v) !== -1;
          return '<button type="button" class="filter-chip' + (active ? ' active' : '') + '" data-dim="' + d.key + '" data-val="' + esc(v) + '">' + esc(v) + '</button>';
        }).join('') + '</div></div>';
    }).join('') : '<p style="font-size:.8rem;color:var(--ink-muted);margin:0">No House/Category/Group values found among your teams.</p>';
    filterChipsHost.querySelectorAll('.filter-chip').forEach(function(btn){
      btn.addEventListener('click', function(){
        var dim = btn.getAttribute('data-dim'), val = btn.getAttribute('data-val');
        var list = filterState[dim], i = list.indexOf(val);
        if (i >= 0) list.splice(i, 1); else list.push(val);
        syncScoresFromDOM();
        rerender();
      });
    });
    var count = activeFilterCount();
    if (filterBadge) { filterBadge.textContent = count; filterBadge.classList.toggle('hidden', !count); }
    if (clearFiltersBtn) clearFiltersBtn.classList.toggle('hidden', !count);
  }
  if (sortToggleBtn) sortToggleBtn.addEventListener('click', function(){
    var opening = sortPanel.classList.contains('hidden');
    sortPanel.classList.toggle('hidden', !opening);
    sortToggleBtn.classList.toggle('open', opening);
  });

  // Multi-level sort builder — same "add a level, pick field + direction,
  // remove/reorder" shape as the admin's own roster sort panel, just
  // scoped to this one judge's teams. Locked by the admin (SORT_LOCKED):
  // the levels still render so the judge can see the order being applied,
  // but every control inside is disabled and the "+ Add level" row is
  // hidden entirely.
  function renderSortPanel(){
    if (!sortLevelsHost) return;
    var used = {};
    sortLevels.forEach(function(l){ used[l.field] = true; });
    sortLevelsHost.innerHTML = sortLevels.map(function(lvl, i){
      var fieldOpts = Object.keys(SORT_FIELDS).map(function(k){
        var disabled = used[k] && k !== lvl.field;
        return '<option value="' + k + '"' + (k === lvl.field ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + esc(SORT_FIELDS[k].label) + '</option>';
      }).join('');
      return '<div class="sort-level-row" data-idx="' + i + '">' +
        '<span class="sort-level-n">' + (i + 1) + '.</span>' +
        '<select class="sort-select sort-field-select" data-idx="' + i + '"' + (SORT_LOCKED ? ' disabled' : '') + '>' + fieldOpts + '</select>' +
        '<button type="button" class="sort-dir-btn sort-dir-toggle" data-idx="' + i + '"' + (SORT_LOCKED ? ' disabled' : '') + '>' + (lvl.dir === 'desc' ? '↓ Desc' : '↑ Asc') + '</button>' +
        '<button type="button" class="sort-remove-btn" data-idx="' + i + '" title="Remove this sort level"' + (SORT_LOCKED || sortLevels.length <= 1 ? ' disabled' : '') + '>✕</button>' +
        '</div>';
    }).join('');
    var unused = Object.keys(SORT_FIELDS).filter(function(k){ return !used[k]; });
    sortAddRowHost.innerHTML = (!SORT_LOCKED && unused.length)
      ? '<select id="sort-add-select" class="sort-add-select"><option value="">+ Add sort level…</option>' + unused.map(function(k){ return '<option value="' + k + '">' + esc(SORT_FIELDS[k].label) + '</option>'; }).join('') + '</select>'
      : '';
    sortLevelsHost.querySelectorAll('.sort-field-select').forEach(function(sel){
      sel.addEventListener('change', function(){
        sortLevels[Number(sel.getAttribute('data-idx'))].field = sel.value;
        syncScoresFromDOM();
        renderSortPanel();
        rerender();
      });
    });
    sortLevelsHost.querySelectorAll('.sort-dir-toggle').forEach(function(btn){
      btn.addEventListener('click', function(){
        var lvl = sortLevels[Number(btn.getAttribute('data-idx'))];
        lvl.dir = lvl.dir === 'desc' ? 'asc' : 'desc';
        syncScoresFromDOM();
        renderSortPanel();
        rerender();
      });
    });
    sortLevelsHost.querySelectorAll('.sort-remove-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        if (sortLevels.length <= 1) return;
        sortLevels.splice(Number(btn.getAttribute('data-idx')), 1);
        syncScoresFromDOM();
        renderSortPanel();
        rerender();
      });
    });
    var addSelect = document.getElementById('sort-add-select');
    if (addSelect) addSelect.addEventListener('change', function(){
      if (!addSelect.value) return;
      sortLevels.push({ field: addSelect.value, dir: 'asc' });
      syncScoresFromDOM();
      renderSortPanel();
      rerender();
    });
    if (sortBadge) { sortBadge.textContent = sortLevels.length; sortBadge.classList.toggle('hidden', sortLevels.length <= 1); }
    if (sortLockedNote) sortLockedNote.classList.toggle('hidden', !SORT_LOCKED);
  }

  function rerender(){
    var list = visibleTeams();
    renderFilterChips();
    renderSortPanel();
    rebuildCards(list);
    rebuildSheet(list);
    applyEditLock();
    if (resultCountEl) {
      resultCountEl.innerHTML = activeFilterCount()
        ? 'Showing <b>' + list.length + '</b> of ' + TEAMS.length + ' teams'
        : '<b>' + TEAMS.length + '</b> team' + (TEAMS.length === 1 ? '' : 's') + ' total';
    }
  }

  // Prints exactly the currently filtered + sorted set, in that same
  // order, with THIS judge's own scores and a Total column — the judge's
  // name goes at the very top of the printed page, not just in the page
  // header, since this is the one copy that leaves the screen.
  function printSheet(){
    syncScoresFromDOM();
    var list = visibleTeams();
    if (!list.length) { alert('No teams match the current filter.'); return; }
    var win = window.open('', '_blank');
    if (!win) { alert('Please allow popups to print.'); return; }
    var printGroups = groupByRubric(list);
    var rubricNames = printGroups.map(function(grp){ return rubricNameById[grp.id] || 'Default'; });
    var tablesHtml = printGroups.map(function(grp){
      var headCells = '<th>SL</th><th>Team</th>' +
        grp.criteria.map(function(c){ return '<th title="' + esc(c.label) + '">' + esc(c.short || c.label) + '<br>/' + esc(c.max) + '</th>'; }).join('') + '<th>Total</th>';
      var rows = grp.teams.map(function(team, idx){
        var cells = grp.criteria.map(function(c){
          var v = team.scores[c.key];
          return '<td>' + (v != null ? esc(v) : '—') + '</td>';
        }).join('');
        var total = teamTotal(team);
        return '<tr><td>' + (idx + 1) + '</td><td>' + teamInfoCellHtml(team) + '</td>' + cells + '<td><b>' + (total == null ? '—' : total) + '</b></td></tr>';
      }).join('');
      return '<table><thead><tr>' + headCells + '</tr></thead><tbody>' + rows + '</tbody></table>';
    }).join('');
    var filterLine = activeFilterSummary();
    var logoUrl = location.origin + '/logo.jpg';
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(JUDGE_NAME) + ' — Score Sheet</title><style>' +
      '@page{size:A4 landscape;margin:12mm;} body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111827;}' +
      '.letterhead{display:flex;align-items:center;gap:10px;border-bottom:2px solid #1e293b;padding-bottom:8px;margin-bottom:10px;}' +
      '.letterhead img{height:42px;width:42px;object-fit:contain;flex-shrink:0;}' +
      '.inst-name{font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.02em;}' +
      '.inst-addr{font-size:10px;color:#4b5563;}' +
      'h1{font-size:17px;margin:4px 0 0;} .sub{font-size:11px;color:#4b5563;margin:2px 0 0;}' +
      '.judge-row{font-size:12px;margin:6px 0 0;} .meta{font-size:10px;color:#6b7280;margin:3px 0 10px;}' +
      'table{width:100%;border-collapse:collapse;font-size:11pt;margin-bottom:14px;} th,td{border:1px solid #94a3b8;padding:6px 8px;text-align:left;vertical-align:middle;}' +
      'th{background:#1e293b;color:#fff;text-transform:uppercase;font-size:9pt;letter-spacing:.03em;} th:first-child,td:first-child{width:28px;text-align:center;}' +
      'tr,td{page-break-inside:avoid;}' +
      '.sheet-ref{font-weight:800;color:#1e3a8a;margin-right:6px;} .sheet-tags{color:#6b7280;margin-right:6px;} .sheet-members{color:#6b7280;font-size:9pt;margin-top:3px;}</style></head><body>' +
      '<div class="letterhead"><img src="' + logoUrl + '" alt=""><div><div class="inst-name">Chattogram Cantonment Public College</div><div class="inst-addr">Bayezid, Chattogram</div></div></div>' +
      '<h1>' + esc(FORM_HEADER) + '</h1>' +
      (FORM_SUBHEADER ? '<p class="sub">' + esc(FORM_SUBHEADER) + '</p>' : '') +
      '<p class="judge-row">Judge: <b>' + esc(JUDGE_NAME) + '</b></p>' +
      (rubricNames.length > 1 ? '<p class="meta"><b>Rubrics:</b> ' + rubricNames.map(esc).join(', ') + '</p>' : '') +
      '<p class="meta">Printed ' + new Date().toLocaleString() + (filterLine ? ' · Filter: ' + esc(filterLine) : '') + ' · Sort: ' + esc(activeSortSummary()) + '</p>' +
      tablesHtml +
      '</body></html>';
    win.document.open(); win.document.write(html); win.document.close();
    setTimeout(function(){ try { win.focus(); win.print(); } catch(e){} }, 300);
  }
  if (printBtn) printBtn.addEventListener('click', printSheet);

  // ── Excel download/upload — work offline, bring scores back in ──────────
  // SheetJS is loaded from a CDN only when actually needed (same lazy-load
  // idiom the admin bundle already uses for its own Excel import/export),
  // so a judge who never touches this keeps the page's small initial
  // payload. Column header is "<label> (out of <max>)" — the same text the
  // Cards view already shows next to each input — so it round-trips without
  // needing a separate hidden key column per criterion; "Team ID" is the
  // one column that MUST survive the round trip since it's how an uploaded
  // row is matched back to a team.
  function ensureXLSX(){
    if (window.XLSX) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      sc.onload = function(){ resolve(); };
      sc.onerror = function(){ reject(new Error('Could not load the Excel reader — check your connection and retry.')); };
      document.head.appendChild(sc);
    });
  }
  function critColumnLabel(c){ return c.label + ' (out of ' + c.max + ')'; }
  var downloadExcelBtn = document.getElementById('download-excel-btn');
  var uploadExcelBtn = document.getElementById('upload-excel-btn');
  var uploadExcelInput = document.getElementById('upload-excel-input');
  var excelStatusEl = document.getElementById('excel-status');
  if (downloadExcelBtn) downloadExcelBtn.addEventListener('click', function(){
    syncScoresFromDOM();
    var list = visibleTeams();
    if (!list.length) { alert('No teams match the current filter.'); return; }
    downloadExcelBtn.disabled = true;
    var origText = downloadExcelBtn.textContent;
    downloadExcelBtn.textContent = 'Preparing…';
    ensureXLSX().then(function(){
      var rows = list.map(function(team, idx){
        var row = { 'SL': idx + 1, 'Team ID': team.team_id, 'Reference No.': team.reference_number, 'Project Title': team.title };
        (team.criteria || CRITERIA).forEach(function(c){
          row[critColumnLabel(c)] = team.scores[c.key] != null ? team.scores[c.key] : '';
        });
        row['Total'] = teamTotal(team) == null ? '' : teamTotal(team);
        return row;
      });
      var ws = XLSX.utils.json_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Scores');
      XLSX.writeFile(wb, (JUDGE_NAME || 'judge').replace(/[^a-z0-9]+/gi, '_') + '_scores.xlsx');
    }).catch(function(err){
      alert(err.message || 'Could not prepare the download.');
    }).then(function(){
      downloadExcelBtn.disabled = false;
      downloadExcelBtn.textContent = origText;
    });
  });
  // Project details CSV — a plain-text export separate from the scoring
  // Excel above, one row per TEAM MEMBER (not per team) so leader and every
  // other member get the exact same identity columns, with the project's
  // own title/details repeated on each of that team's rows. Built with
  // plain string-joining rather than SheetJS since a CSV needs no library.
  function csvCell(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  var downloadProjectCsvBtn = document.getElementById('download-project-csv-btn');
  if (downloadProjectCsvBtn) downloadProjectCsvBtn.addEventListener('click', function(){
    var list = visibleTeams();
    if (!list.length) { alert('No teams match the current filter.'); return; }
    var headers = ['SL', 'Reference No.', 'Role', 'Member Name', 'Student ID', 'Roll', 'Class', 'Section', 'Project Title', 'Details'];
    var rows = [headers];
    list.forEach(function(team, idx){
      var members = team.members && team.members.length ? team.members : [{ name: '', student_id: '', roll: '', class: '', section: '', role: '' }];
      members.forEach(function(m){
        rows.push([idx + 1, team.reference_number, m.role, m.name, m.student_id, m.roll, m.class, m.section, team.title, team.description_full || team.description]);
      });
    });
    var csv = rows.map(function(r){ return r.map(csvCell).join(','); }).join('\\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = (JUDGE_NAME || 'judge').replace(/[^a-z0-9]+/gi, '_') + '_project_details.csv';
    a.click();
  });
  if (uploadExcelBtn && uploadExcelInput) uploadExcelBtn.addEventListener('click', function(){ uploadExcelInput.click(); });
  if (uploadExcelInput) uploadExcelInput.addEventListener('change', function(e){
    var file = e.target.files[0];
    uploadExcelInput.value = ''; // allow re-selecting the same file again later
    if (!file) return;
    if (excelStatusEl) excelStatusEl.textContent = 'Reading ' + file.name + '…';
    var reader = new FileReader();
    reader.onload = function(evt){
      ensureXLSX().then(function(){
        var wb = XLSX.read(evt.target.result, { type: 'array' });
        var allRows = [];
        wb.SheetNames.forEach(function(name){
          allRows = allRows.concat(XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }));
        });
        var matchedTeams = 0, unknownRows = 0, updatedScores = 0, badValues = 0;
        var touchedIds = {};
        allRows.forEach(function(row){
          var teamId = Number(row['Team ID']);
          var team = TEAMS_BY_ID[teamId];
          if (!team) { unknownRows++; return; }
          matchedTeams++;
          (team.criteria || CRITERIA).forEach(function(c){
            var colKey = critColumnLabel(c);
            if (!(colKey in row)) return;
            var raw = row[colKey];
            if (raw === '' || raw == null) return;
            var v = Number(raw);
            if (isNaN(v) || v < 0 || v > c.max) { badValues++; return; }
            team.scores[c.key] = v;
            updatedScores++;
            touchedIds[team.team_id] = true;
          });
        });
        rerender();
        setView('sheet');
        Object.keys(touchedIds).forEach(function(id){
          var tr = sheetHost.querySelector('tr[data-team-row="' + id + '"]');
          if (tr) tr.classList.add('dirty');
        });
        if (excelStatusEl) {
          excelStatusEl.innerHTML = '<b>' + updatedScores + '</b> score' + (updatedScores === 1 ? '' : 's') + ' updated across <b>' + matchedTeams + '</b> team' + (matchedTeams === 1 ? '' : 's') +
            (unknownRows ? ', ' + unknownRows + ' row(s) skipped (unknown Team ID)' : '') +
            (badValues ? ', ' + badValues + ' value(s) out of range ignored' : '') +
            '. Review the highlighted rows, then tap Save All.';
        }
      }).catch(function(err){
        if (excelStatusEl) excelStatusEl.textContent = err.message || 'Could not read this file.';
      });
    };
    reader.readAsArrayBuffer(file);
  });

  // Sheet (Excel-style) is the default a judge lands on — faster for
  // scoring many teams in one sitting than tapping through cards one at a
  // time. Cards stays one click away for whoever still wants it on a
  // phone. Guarded: the toggle/view elements only exist when there's at
  // least one team to show.
  if (TEAMS.length) {
    rerender();
    if (sheetBtn) setView('sheet');
  }
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

  const formRows = await sb(`group_forms?id=eq.${encodeURIComponent(judge.group_form_id)}&select=archived,judging_criteria_json,judging_rubric_sets_json,eligibility_json,fields_json`);
  const form = Array.isArray(formRows) && formRows[0];
  if (!form) return NextResponse.json({ result: 'error', message: 'Judge link not found.' }, { status: 404 });
  if (form.archived) return NextResponse.json({ result: 'error', message: ARCHIVED_MESSAGE });

  // The team must actually belong to THIS judge's own form — closes off a
  // judge guessing another form's team_id even though access_code itself
  // only ever resolves one group_form_id.
  const teamRows = await sb(`group_form_teams?id=eq.${encodeURIComponent(team_id)}&group_form_id=eq.${encodeURIComponent(judge.group_form_id)}&select=id,group_data,review_status`);
  if (!Array.isArray(teamRows) || !teamRows.length) return NextResponse.json({ result: 'error', message: 'Invalid team.' }, { status: 400 });
  const team = teamRows[0];

  // Judges only ever see/score approved teams — the page's own roster
  // already excludes anything not approved, but a judge could otherwise
  // still post a team_id for one that's pending/rejected directly.
  if (team.review_status !== 'approved') {
    return NextResponse.json({ result: 'error', message: 'This team has not been approved yet.' }, { status: 403 });
  }

  // Leader profile is needed either way now (scope check below, and rubric
  // resolution — a filter-assigned rubric can key off house, same as scope
  // can) — fetched once up front rather than only conditionally.
  const leaderRows = await sb(`group_form_team_members?team_id=eq.${encodeURIComponent(team_id)}&role=eq.leader&select=student_id`);
  const leaderId = Array.isArray(leaderRows) && leaderRows[0] ? leaderRows[0].student_id : null;
  const leaderProfRows = leaderId ? await sb(`students_data?student_id=eq.${encodeURIComponent(leaderId)}&select=class,house`) : [];
  const leaderProfile = (Array.isArray(leaderProfRows) && leaderProfRows[0]) || null;

  // And the team must fall within THIS judge's own assigned slice, not
  // just anywhere on the right form — a judge scoped to e.g. House Jupiter
  // never gets to score a team outside it, even by posting its team_id
  // directly (the page itself never renders it, but the API must refuse it
  // too, since the page is just a convenience, not the real gate).
  if ((judge.scope_dimension || 'all') !== 'all' && !judgeScopeMatches(team, form, judge, leaderProfile)) {
    return NextResponse.json({ result: 'error', message: 'This team is outside your assigned scope.' }, { status: 403 });
  }

  let defaultCriteria = [];
  try { defaultCriteria = JSON.parse(form.judging_criteria_json || '[]') || []; } catch (e) {}
  let rubricSets = [];
  try { rubricSets = JSON.parse(form.judging_rubric_sets_json || '[]') || []; } catch (e) {}
  let fields = [];
  try { fields = JSON.parse(form.fields_json || '[]') || []; } catch (e) {}
  const teamFacts = {
    house: (leaderProfile && leaderProfile.house) || '',
    category: answerByName(fields, team.group_data, /^category$/i) || '',
    group: (team.group_data || {}).group || '',
    group_data: team.group_data,
  };
  const rubric = resolveRubric(judge.id, teamFacts, rubricSets, defaultCriteria);
  const criteria = rubric.criteria || [];
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
