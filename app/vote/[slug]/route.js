import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Public, login-free cover/option voting page — same idea as
// app/plan/[id]/route.js (a link anyone can open without signing in), but
// for a poll instead of a lesson plan. poll_slug in teacher_staff.
// cover_poll_votes lets POLLS below grow with more entries later without
// any new table or route.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbTeacherStaff(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'teacher_staff',
      'Content-Profile': 'teacher_staff',
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

const POLLS = {
  'giriprabha-2026-cover': {
    title: 'গিরিপ্রভা-২০২৬ প্রচ্ছদ ভোট',
    college: 'চট্টগ্রাম ক্যান্টনমেন্ট পাবলিক কলেজ',
    magazine: 'গিরিপ্রভা-২০২৬',
    subtitle: 'প্রচ্ছদ নির্বাচনী উন্মুক্ত ভোট',
    salute: 'আসসালামু আলাইকুম, শ্রদ্ধেয় শিক্ষক মন্ডলী।',
    letterParagraphs: [
      'আমাদের প্রতিষ্ঠানের বার্ষিক ম্যাগাজিন <span class="letter-mag">“গিরিপ্রভা-২০২৬”</span>-এর জন্য প্রাথমিকভাবে ৩টি প্রচ্ছদ চিত্র বাছাই করা হয়েছে।',
      'প্রতিষ্ঠানের ভাবমূর্তি ও সৃজনশীলতার সাথে মানানসই সেরা প্রচ্ছদটি চূড়ান্তভাবে নির্বাচনের উদ্দেশ্যে আপনাদের সবার মতামত আহ্বান করা হচ্ছে। নিচের ভোটিং অপশন থেকে আপনার পছন্দের প্রচ্ছদ চিত্রটিতে ভোট দিয়ে চূড়ান্ত সিদ্ধান্ত গ্রহণে সহায়তা করার জন্য বিনীত অনুরোধ রইল।',
    ],
    editorName: 'অধ্যাপক মোহাম্মদ নুরুল আলম',
    editorRole: 'সম্পাদক, গিরিপ্রভা-২০২৬',
    covers: [
      { id: 1, label: 'প্রচ্ছদ ১', img: '/polls/giriprabha-2026/cover-1.jpg', alt: 'প্রচ্ছদ বিকল্প ১ — স্মার্ট ক্যাম্পাস ও প্রযুক্তির প্রতীকী চিত্র' },
      { id: 2, label: 'প্রচ্ছদ ২', img: '/polls/giriprabha-2026/cover-2.jpg', alt: 'প্রচ্ছদ বিকল্প ২ — কলেজ ভবন, বাস ও শিক্ষার্থীদের চিত্র' },
      { id: 3, label: 'প্রচ্ছদ ৩', img: '/polls/giriprabha-2026/cover-3.jpg', alt: 'প্রচ্ছদ বিকল্প ৩ — ডিজিটাল ক্যাম্পাস কোলাজ চিত্র' },
    ],
  },
};

function notFoundHtml() {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>ভোট পাওয়া যায়নি</title>
    <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f4f5;color:#333;text-align:center;padding:24px;}
    .box{max-width:360px;} h1{font-size:18px;margin-bottom:8px;} p{font-size:13px;color:#666;}</style></head>
    <body><div class="box"><h1>এই ভোট লিংকটি পাওয়া যায়নি</h1><p>লিংকটি সঠিক কিনা যাচাই করুন, অথবা সংশ্লিষ্ট ব্যক্তির সাথে যোগাযোগ করুন।</p></div></body></html>`;
}

function formatTs(ts) {
  try {
    return new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
  } catch (e) { return ''; }
}

function renderPage(poll, slug, votes) {
  const total = votes.length;
  const tally = id => votes.filter(v => v.choice === id).length;

  const coversHtml = poll.covers.map(c => {
    const count = tally(c.id);
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <div class="cover-cell">
        <div class="cover-frame-wrap">
          <button type="button" class="cover-select" data-cover="${c.id}" aria-pressed="false" aria-label="${esc(c.label)} নির্বাচন করুন">
            <img src="${c.img}" alt="${esc(c.alt)}" loading="lazy">
            <span class="cover-dim"></span>
            <span class="cover-check"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </button>
          <button type="button" class="zoom-btn" data-zoom="${c.img}" data-alt="${esc(c.alt)}" aria-label="বড় করে দেখুন" title="বড় করে দেখুন">
            <svg viewBox="0 0 24 24" width="14" height="14"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2.2"/><line x1="15" y1="15" x2="20" y2="20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="cover-meta">
          <span class="cover-label">${esc(c.label)} <span class="selected-tag" hidden>&#10003; নির্বাচিত</span></span>
          <span class="cover-bar-track"><span class="cover-bar-fill" style="width:${pct}%"></span></span>
          <span class="cover-count">${count} ভোট &middot; ${pct}%</span>
        </div>
      </div>`;
  }).join('');

  const rollHtml = votes.length
    ? votes.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(v => {
        const label = (poll.covers.find(c => c.id === v.choice) || {}).label || '';
        return `<li class="roll-item"><span class="roll-name">${esc(v.voter_name)}</span><span class="roll-choice">${esc(label)}</span><span class="roll-time">${esc(formatTs(v.created_at))}</span></li>`;
      }).join('')
    : '<li class="roll-empty">এখনও কোনো ভোট জমা পড়েনি — প্রথম মতামতটি আপনারই হোক।</li>';

  const votesForClient = JSON.stringify(votes.map(v => ({ name: v.voter_name, choice: v.choice }))).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(poll.title)}</title>
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tiro+Bangla:ital@0;1&family=Hind+Siliguri:wght@400;500;600;700&display=swap">
<style>
  :root{
    --bg:#f6f1e3; --surface:#fffdf7; --surface-2:#eee3c4; --ink:#1c2a22; --ink-muted:#5c6d61;
    --border:#ddcf9f; --accent:#a8791d; --accent-strong:#8a6316; --accent-soft:#f0dfb0;
    --forest:#1f4d3d; --brick:#a23b2e; --good:#2f7d5a; --shadow:0 24px 48px -28px rgba(28,42,34,.5);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#0d1a15; --surface:#122320; --surface-2:#1a2f27; --ink:#f1ead9; --ink-muted:#9cb3a5;
      --border:#2a4438; --accent:#dfae5c; --accent-strong:#f0c476; --accent-soft:#3a2f16;
      --forest:#8fc7a8; --brick:#e58873; --good:#5cd9a0; --shadow:0 24px 48px -20px rgba(0,0,0,.65);
    }
  }
  :root[data-theme="dark"]{
    --bg:#0d1a15; --surface:#122320; --surface-2:#1a2f27; --ink:#f1ead9; --ink-muted:#9cb3a5;
    --border:#2a4438; --accent:#dfae5c; --accent-strong:#f0c476; --accent-soft:#3a2f16;
    --forest:#8fc7a8; --brick:#e58873; --good:#5cd9a0; --shadow:0 24px 48px -20px rgba(0,0,0,.65);
  }
  *{box-sizing:border-box;}
  body{margin:0; background:var(--bg); color:var(--ink); font-family:'Hind Siliguri','Noto Sans Bengali',sans-serif; line-height:1.8; -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums;}
  .wrap{max-width:960px; margin:0 auto; padding:2.5rem 1.25rem 4rem;}
  .serif{font-family:'Tiro Bangla','Noto Serif Bengali',serif;}
  h1,h2{text-wrap:balance; margin:0;}
  button{font:inherit; color:inherit;}
  :focus-visible{outline:2px solid var(--accent); outline-offset:3px; border-radius:4px;}

  .hero{text-align:center; padding:1rem 0 2.25rem; position:relative;}
  .hero-glow{position:absolute; inset:-40px 0 auto 0; height:220px; margin:0 auto; max-width:520px; background:radial-gradient(closest-side, var(--accent-soft), transparent 72%); filter:blur(6px); opacity:.9; pointer-events:none;}
  .hero > *{position:relative; z-index:1;}
  .eyebrow{display:inline-block; font-size:.72rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--forest); margin-bottom:.9rem;}
  .hero-title{font-size:clamp(2.1rem,6vw,3.1rem); font-weight:700;}
  .hero-sub{margin-top:.5rem; font-size:1.05rem; color:var(--ink-muted); font-weight:500;}
  .peaks{width:200px; height:auto; margin:1.4rem auto 0; display:block;}
  .peaks circle{fill:var(--accent-soft);}
  .peaks path{stroke:var(--accent);}
  .hero-stat{display:inline-flex; align-items:center; gap:.5rem; margin-top:1.5rem; background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:.5rem 1.1rem; font-size:.85rem; font-weight:600; color:var(--forest); box-shadow:var(--shadow);}
  .hero-stat b{font-size:1rem; color:var(--accent-strong);}

  .letter-card{position:relative; background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:2.1rem 2rem; margin:0 0 2.25rem; box-shadow:var(--shadow); overflow:hidden;}
  .letter-card::before{content:""; position:absolute; inset:0 0 auto 0; height:5px; background:linear-gradient(90deg, var(--forest), var(--accent));}
  .letter-salute{font-family:'Tiro Bangla','Noto Serif Bengali',serif; font-size:1.2rem; font-weight:700; margin-bottom:1rem;}
  .letter-body p{margin:0 0 1rem; max-width:66ch; font-size:1rem;}
  .letter-body p:last-child{margin-bottom:0;}
  .letter-mag{color:var(--accent-strong); font-weight:700;}
  .signature{margin-top:1.5rem; padding-top:1.1rem; border-top:1px dashed var(--border);}
  .signature .thanks{display:block; margin-bottom:.6rem; color:var(--ink-muted);}
  .signature .sig-name{display:block; font-family:'Tiro Bangla','Noto Serif Bengali',serif; font-style:italic; font-size:1.15rem; font-weight:700; color:var(--forest);}
  .signature .sig-role{display:block; font-size:.82rem; color:var(--ink-muted); margin-top:.15rem;}

  .section-head{margin:0 0 .35rem; display:flex; align-items:baseline; gap:.6rem; flex-wrap:wrap;}
  .section-head h2{font-family:'Tiro Bangla','Noto Serif Bengali',serif; font-size:1.4rem; font-weight:700;}
  .section-head .count-chip{font-size:.78rem; font-weight:600; color:var(--ink-muted);}
  .section-hint{margin:0 0 1.3rem; color:var(--ink-muted); font-size:.9rem;}

  .ballot-card{background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:2rem; margin-bottom:2rem; box-shadow:var(--shadow);}
  .field-label{display:block; font-weight:700; font-size:.92rem; margin-bottom:.5rem;}
  .field-label .req{color:var(--brick);}
  .text-input{width:100%; padding:.85rem 1rem; border-radius:12px; border:1.5px solid var(--border); background:var(--bg); color:var(--ink); font-size:1rem; font-family:inherit; margin-bottom:1.6rem;}
  .text-input:focus{border-color:var(--accent); outline:none;}

  .covers-grid{display:grid; grid-template-columns:repeat(3,1fr); gap:1.1rem; margin-bottom:1.7rem;}
  @media (max-width:700px){ .covers-grid{grid-template-columns:1fr;} }
  .cover-cell{display:flex; flex-direction:column; gap:.6rem;}
  .cover-frame-wrap{position:relative; border-radius:18px; overflow:hidden; box-shadow:var(--shadow); transition:box-shadow .15s ease, transform .15s ease;}
  .cover-frame-wrap.selected{box-shadow:0 0 0 3px var(--surface), 0 0 0 6px var(--accent), 0 14px 30px -14px rgba(168,121,29,.55); transform:translateY(-3px);}
  .cover-select{display:block; width:100%; padding:0; margin:0; border:0; border-radius:18px; background:var(--surface-2); cursor:pointer; overflow:hidden; line-height:0; position:relative;}
  .cover-select img{display:block; width:100%; aspect-ratio:3/4; object-fit:cover;}
  .cover-select:hover{transform:translateY(-2px);}
  .cover-select.locked{cursor:default;}
  .cover-select.locked:hover{transform:none;}
  .cover-dim{position:absolute; inset:0; background:linear-gradient(180deg, rgba(168,121,29,.16), rgba(168,121,29,.3)); opacity:0; transition:opacity .15s ease; pointer-events:none;}
  .cover-frame-wrap.selected .cover-dim{opacity:1;}
  .cover-check{position:absolute; top:.55rem; left:.55rem; width:36px; height:36px; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 3px var(--surface), 0 4px 12px rgba(0,0,0,.4); opacity:0; transform:scale(.4); transition:opacity .15s ease, transform .15s ease;}
  .cover-frame-wrap.selected .cover-check{opacity:1; transform:scale(1);}
  .zoom-btn{position:absolute; bottom:.6rem; right:.6rem; width:32px; height:32px; border-radius:50%; background:rgba(15,25,20,.55); color:#fff; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:2;}
  .zoom-btn:hover{background:rgba(15,25,20,.8);}
  .cover-meta{display:flex; flex-direction:column; gap:.35rem;}
  .cover-label{font-weight:700; font-size:.95rem; display:flex; align-items:center; gap:.5rem; flex-wrap:wrap;}
  .selected-tag{font-size:.68rem; font-weight:700; color:var(--accent-strong); background:var(--accent-soft); padding:.18rem .55rem; border-radius:999px; letter-spacing:.02em;}
  .cover-bar-track{height:7px; border-radius:999px; background:var(--surface-2); overflow:hidden;}
  .cover-bar-fill{display:block; height:100%; background:linear-gradient(90deg, var(--forest), var(--accent)); border-radius:999px; width:0; transition:width .5s ease;}
  .cover-count{font-size:.78rem; color:var(--ink-muted);}

  .form-error{color:var(--brick); font-weight:600; font-size:.88rem; margin:-.6rem 0 1rem;}
  .submit-btn{display:block; width:100%; padding:1rem; border:none; border-radius:14px; cursor:pointer; background:var(--forest); color:#fbf7ea; font-weight:700; font-size:1rem;}
  .submit-btn:hover{background:var(--accent-strong);}
  .submit-btn:disabled{opacity:.6; cursor:default;}

  .voted-note{text-align:center; padding:1.2rem .5rem;}
  .voted-badge{display:inline-flex; align-items:center; justify-content:center; width:46px; height:46px; border-radius:50%; background:var(--good); color:#fff; margin-bottom:.9rem;}
  .voted-note p{margin:0 0 .8rem; font-size:1.02rem;}
  .link-btn{background:none; border:none; color:var(--accent-strong); font-weight:700; text-decoration:underline; cursor:pointer; padding:0; font-size:.88rem;}

  .roll-card{background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:1.8rem 2rem; margin-bottom:2rem; box-shadow:var(--shadow);}
  .roll-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; max-height:340px; overflow-y:auto;}
  .roll-item{display:flex; align-items:center; justify-content:space-between; gap:.8rem; padding:.7rem 0; border-bottom:1px solid var(--border); font-size:.92rem; flex-wrap:wrap;}
  .roll-item:last-child{border-bottom:none;}
  .roll-name{font-weight:700; flex:1 1 auto; min-width:0; overflow-wrap:anywhere;}
  .roll-choice{color:var(--forest); font-weight:600; font-size:.82rem; background:var(--surface-2); padding:.2rem .6rem; border-radius:999px;}
  .roll-time{color:var(--ink-muted); font-size:.78rem; white-space:nowrap;}
  .roll-empty{padding:.6rem 0; color:var(--ink-muted); font-size:.9rem;}

  .footer{text-align:center; color:var(--ink-muted); font-size:.8rem; margin-top:2.5rem;}

  .lightbox{position:fixed; inset:0; background:rgba(10,16,13,.86); display:flex; align-items:center; justify-content:center; padding:2rem; z-index:50;}
  .lightbox[hidden]{display:none;}
  .lightbox img{max-width:92vw; max-height:88vh; border-radius:10px; box-shadow:0 30px 60px rgba(0,0,0,.5);}
  .lightbox-close{position:absolute; top:1.2rem; right:1.2rem; width:40px; height:40px; border-radius:50%; border:none; background:rgba(255,255,255,.14); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer;}
  .lightbox-close:hover{background:rgba(255,255,255,.26);}

  @media (prefers-reduced-motion: no-preference){
    .hero{animation:rise .6s ease both;} .letter-card{animation:rise .6s .08s ease both;}
    .ballot-card{animation:rise .6s .16s ease both;} .roll-card{animation:rise .6s .22s ease both;}
  }
  @keyframes rise{from{opacity:0; transform:translateY(10px);} to{opacity:1; transform:translateY(0);}}
</style>
</head>
<body>
<div class="wrap">
  <section class="hero">
    <div class="hero-glow" aria-hidden="true"></div>
    <span class="eyebrow">${esc(poll.college)}</span>
    <h1 class="hero-title serif">${esc(poll.magazine)}</h1>
    <p class="hero-sub">${esc(poll.subtitle)}</p>
    <svg class="peaks" viewBox="0 0 240 90" aria-hidden="true">
      <circle cx="120" cy="44" r="28"/>
      <path d="M10 78 L72 26 L102 54 L140 16 L180 54 L230 78 Z" fill="none" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="hero-stat">মোট ভোট পড়েছে &nbsp;<b id="total-stat">${total}</b>&nbsp; জনের</div>
  </section>

  <section class="letter-card">
    <p class="letter-salute">${esc(poll.salute)}</p>
    <div class="letter-body">${poll.letterParagraphs.map(p => `<p>${p}</p>`).join('')}</div>
    <div class="signature">
      <span class="thanks">ধন্যবাদ,</span>
      <span class="sig-name">${esc(poll.editorName)}</span>
      <span class="sig-role">${esc(poll.editorRole)}</span>
    </div>
  </section>

  <section class="ballot-card">
    <div class="section-head"><h2 class="serif">প্রচ্ছদ নির্বাচন করুন</h2></div>
    <p class="section-hint">যেকোনো ছবির উপর ক্লিক করে আপনার পছন্দ বেছে নিন — ছবির কোণের বোতামে চাপ দিলে বড় করে দেখা যাবে।</p>
    <div id="ballot-form">
      <label class="field-label" for="voter-name">আপনার নাম <span class="req">*</span></label>
      <input type="text" id="voter-name" class="text-input" placeholder="আপনার পূর্ণ নাম লিখুন" autocomplete="name">
      <div class="covers-grid">${coversHtml}</div>
      <p id="form-error" class="form-error" hidden></p>
      <button type="button" id="submit-vote" class="submit-btn">ভোট জমা দিন</button>
    </div>
    <div id="voted-note" class="voted-note" hidden>
      <span class="voted-badge"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 13l4 4L19 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <p id="voted-text"></p>
      <button type="button" id="not-you-btn" class="link-btn">এটি আপনি নন? আবার ভোট দিন</button>
    </div>
  </section>

  <section class="roll-card">
    <div class="section-head"><h2 class="serif">ভোটদাতাদের তালিকা</h2><span class="count-chip">(মোট ${total} জন)</span></div>
    <ul class="roll-list">${rollHtml}</ul>
  </section>

  <p class="footer">${esc(poll.college)} &middot; ${esc(poll.title)}</p>
</div>

<div class="lightbox" id="lightbox" hidden>
  <button type="button" class="lightbox-close" id="lightbox-close" aria-label="বন্ধ করুন"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
  <img id="lightbox-img" src="" alt="">
</div>

<script>
(function(){
  "use strict";
  var SLUG = ${JSON.stringify(slug)};
  var LS_KEY = "cover_poll_name_" + SLUG;
  var COVER_LABELS = ${JSON.stringify(poll.covers.map(c => ({ id: c.id, label: c.label })))};
  var VOTES = ${votesForClient};
  var selected = null;

  function normName(s){ return String(s||"").trim().toLowerCase().replace(/\\s+/g," "); }
  function labelFor(id){ for (var i=0;i<COVER_LABELS.length;i++) if (COVER_LABELS[i].id===id) return COVER_LABELS[i].label; return ""; }
  function findByName(name){
    var n = normName(name);
    if (!n) return null;
    for (var i=VOTES.length-1;i>=0;i--) if (normName(VOTES[i].name)===n) return VOTES[i];
    return null;
  }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }

  function showError(msg){ var el = document.getElementById("form-error"); el.textContent = msg; el.hidden = false; }

  function showVotedState(name, choice){
    document.getElementById("ballot-form").hidden = true;
    document.getElementById("voted-note").hidden = false;
    document.getElementById("voted-text").innerHTML = "ধন্যবাদ, <strong>" + esc(name) + "</strong>! আপনি <strong>" + esc(labelFor(choice)) + "</strong>-এ ভোট দিয়েছেন।";
  }

  function checkLocalVote(){
    var localName;
    try { localName = localStorage.getItem(LS_KEY) || ""; } catch(e){ localName = ""; }
    if (!localName) return;
    var v = findByName(localName);
    if (v) showVotedState(v.name, v.choice);
  }

  document.querySelectorAll(".cover-select").forEach(function(btn){
    btn.addEventListener("click", function(){
      if (btn.classList.contains("locked")) return;
      selected = Number(btn.getAttribute("data-cover"));
      document.querySelectorAll(".cover-cell").forEach(function(cell){
        var b = cell.querySelector(".cover-select");
        var wrap = cell.querySelector(".cover-frame-wrap");
        var tag = cell.querySelector(".selected-tag");
        var isSel = Number(b.getAttribute("data-cover")) === selected;
        b.setAttribute("aria-pressed", String(isSel));
        if (wrap) wrap.classList.toggle("selected", isSel);
        if (tag) tag.hidden = !isSel;
      });
    });
  });

  document.querySelectorAll(".zoom-btn").forEach(function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      document.getElementById("lightbox-img").src = btn.getAttribute("data-zoom");
      document.getElementById("lightbox-img").alt = btn.getAttribute("data-alt") || "";
      document.getElementById("lightbox").hidden = false;
    });
  });
  function closeLightbox(){ document.getElementById("lightbox").hidden = true; }
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox").addEventListener("click", function(e){ if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeLightbox(); });

  document.getElementById("not-you-btn").addEventListener("click", function(){
    try { localStorage.removeItem(LS_KEY); } catch(e){}
    document.getElementById("voted-note").hidden = true;
    document.getElementById("ballot-form").hidden = false;
  });

  document.getElementById("submit-vote").addEventListener("click", async function(){
    var nameInput = document.getElementById("voter-name");
    var name = nameInput.value.trim();
    document.getElementById("form-error").hidden = true;

    if (!name){ showError("অনুগ্রহ করে আপনার নাম লিখুন।"); return; }
    if (!selected){ showError("অনুগ্রহ করে একটি প্রচ্ছদ নির্বাচন করুন।"); return; }
    var dup = findByName(name);
    if (dup){ showError("এই নামে ইতিমধ্যে ভোট জমা দেওয়া হয়েছে (" + labelFor(dup.choice) + ")।"); return; }

    var btn = document.getElementById("submit-vote");
    btn.disabled = true;
    btn.textContent = "জমা হচ্ছে…";

    try {
      var res = await fetch(location.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, choice: selected }),
      });
      var data = await res.json();
      if (data && data.result === "success"){
        try { localStorage.setItem(LS_KEY, name); } catch(e){}
        location.reload();
        return;
      }
      btn.disabled = false;
      btn.textContent = "ভোট জমা দিন";
      showError((data && data.message) || "ভোট জমা দেওয়া যায়নি। আবার চেষ্টা করুন।");
    } catch(e){
      btn.disabled = false;
      btn.textContent = "ভোট জমা দিন";
      showError("নেটওয়ার্ক সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    }
  });

  checkLocalVote();
})();
</script>
</body>
</html>`;
}

export async function GET(request, { params }) {
  const { slug } = await params;
  const poll = POLLS[slug];
  if (!poll) {
    return new Response(notFoundHtml(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const rows = await sbTeacherStaff(`cover_poll_votes?poll_slug=eq.${encodeURIComponent(slug)}&select=voter_name,choice,created_at&order=created_at.desc`);
  const votes = Array.isArray(rows) ? rows : [];
  return new Response(renderPage(poll, slug, votes), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request, { params }) {
  const { slug } = await params;
  const poll = POLLS[slug];
  if (!poll) return NextResponse.json({ result: 'error', message: 'এই ভোট পাওয়া যায়নি।' }, { status: 404 });

  let body;
  try { body = await request.json(); } catch (e) {
    return NextResponse.json({ result: 'error', message: 'অনুরোধটি সঠিক নয়।' }, { status: 400 });
  }

  const name = String(body.name || '').trim().slice(0, 120);
  const choice = Number(body.choice);

  if (!name) return NextResponse.json({ result: 'error', message: 'অনুগ্রহ করে আপনার নাম লিখুন।' }, { status: 400 });
  if (!poll.covers.some(c => c.id === choice)) {
    return NextResponse.json({ result: 'error', message: 'অনুগ্রহ করে একটি সঠিক প্রচ্ছদ নির্বাচন করুন।' }, { status: 400 });
  }

  const inserted = await sbTeacherStaff('cover_poll_votes', 'POST', { poll_slug: slug, voter_name: name, choice });
  if (inserted && inserted.error) {
    const isDup = /duplicate key|23505/i.test(inserted.error);
    if (isDup) return NextResponse.json({ result: 'duplicate', message: 'এই নামে ইতিমধ্যে ভোট জমা দেওয়া হয়েছে।' }, { status: 409 });
    return NextResponse.json({ result: 'error', message: 'ভোট জমা দেওয়া যায়নি। আবার চেষ্টা করুন।' }, { status: 500 });
  }

  return NextResponse.json({ result: 'success' });
}
