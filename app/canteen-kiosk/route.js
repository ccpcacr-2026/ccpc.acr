export const dynamic = 'force-dynamic';

// Public, login-free canteen Kiosk screen — ported from the standalone
// ccpc-canteen app's app/kiosk/page.js into this repo so it runs on the
// same infrastructure as the Teacher/Student portals instead of a fourth
// separately-hosted app. Only the Kiosk is ported here; Kitchen/Admin/
// Control stay in ccpc-canteen for now (separate, later phases).
//
// The physical kiosk has NO touchscreen or mouse. Everything arrives as
// USB-HID keyboard input through three independent channels, all ported
// 1:1 from the original React component, with zero simplification:
//
//   1. A hidden, always-focused <input> ("hidCapture") that buffers typed
//      characters. Enter with a non-empty buffer = a card/ID scan; a BARE
//      Enter with an empty buffer = the physical "Confirm" button. The
//      buffer is cleared BEFORE acting (not after) so a reader/keypad's
//      next emission can never concatenate onto this one. This mirrors
//      this repo's own existing idiom for barcode-scanner manual entry
//      (_admCandScanManualLookup in _src/app.js): one focused input,
//      onkeydown+Enter, clear-then-refocus.
//   2. A window-level keydown listener for the 16 wired shortcut buttons
//      (digits 1-9/0 -> menu slot, Arrow Left/Right -> page, C -> cancel,
//      H/K -> delivery method), gated by a 100ms inter-keystroke debounce
//      — a card reader "types" a UID in a fast burst (~1-30ms/char); no
//      one can press a physical button that fast, so anything arriving
//      faster than this debounce is swallowed as scan text, not a
//      shortcut. This channel has no precedent elsewhere in this repo and
//      is ported verbatim.
//   3. A WebSocket client to ws://localhost:8787 (a local Python bridge,
//      nfc-bridge/bridge.py, unaffected by this port — it always targets
//      the physical kiosk machine's own localhost) for PC/SC-only card
//      readers that can't emulate a keyboard.
//
// Layout is deliberately NOT responsive — fixed full-viewport, no scroll,
// hardcoded rail width, a fixed 5-left/5-right/10-per-page menu slot split
// matching a legacy desktop app's own slot numbering. This is a single
// physical kiosk display, not a general-purpose page.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbStudent(path, method = 'GET', body = null) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'student',
      'Content-Profile': 'student',
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

const css = `
  :root {
    --ink:#12131a; --paper:#f5f6fb; --surface:#ffffff; --line:#e7e9f5; --muted:#6b7089;
    --night:#0d0e14;
    --accent:#ff5a36; --accent-2:#ff8a3d; --accent-soft:#ffe4da; --accent-glow:rgba(255,90,54,0.35);
    --violet:#7c5cfa; --violet-soft:#ede7ff;
    --ok:#12cb8c; --ok-soft:#dffbef; --danger:#ff3b5c; --danger-soft:#ffe1e6;
    --shadow-sm:0 1px 2px rgba(18,19,26,0.06); --shadow-lg:0 16px 40px rgba(18,19,26,0.14);
    --font-display:'Baloo Da 2',sans-serif; --font-body:'Manrope',sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink:#f2f3fa; --paper:#0d0e14; --surface:#171926; --line:#262a3b; --muted:#9ca1b8;
      --accent-soft:#3a1f16; --accent-glow:rgba(255,90,54,0.45); --violet-soft:#251c42;
      --ok-soft:#0e3527; --danger-soft:#3a121c;
      --shadow-sm:0 1px 2px rgba(0,0,0,0.3); --shadow-lg:0 16px 40px rgba(0,0,0,0.5);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--paper); color: var(--ink); font-family: var(--font-body), -apple-system, "Segoe UI", Arial, sans-serif; font-variant-numeric: tabular-nums; }
  button { font-family: inherit; cursor: pointer; }
  input { font-family: inherit; }
  @media (prefers-reduced-motion: no-preference) { .pulse { animation: pulse 1.8s ease-in-out infinite; } }
  @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.85; } }

  .hid-capture { position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; border: none; padding: 0; }

  .idle-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 22% 20%, rgba(255,90,54,0.30), transparent 45%), radial-gradient(circle at 82% 78%, rgba(124,92,250,0.30), transparent 45%), var(--night); }
  .idle-card { text-align: center; color: #fff; }
  .bridge-badge { position: fixed; bottom: 20px; right: 20px; display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); backdrop-filter: blur(6px); }
  .bridge-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .bridge-text { color: rgba(255,255,255,0.75); font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
  .card-icon { font-size: 76px; margin-bottom: 16px; filter: drop-shadow(0 0 24px rgba(255,90,54,0.6)); }
  .idle-title { font-family: var(--font-display); font-size: 34px; font-weight: 700; margin: 0; }
  .idle-sub { color: var(--accent-2); margin-top: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; }
  .status-line { margin: 10px 20px; font-weight: 700; font-size: 14px; text-align: center; }
  .manual-form { margin-top: 40px; display: flex; gap: 8px; justify-content: center; }
  .manual-input { padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); color: #fff; font-size: 14px; width: 220px; backdrop-filter: blur(6px); }
  .manual-btn { padding: 12px 20px; border-radius: 12px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-weight: 800; font-size: 13px; box-shadow: 0 8px 20px var(--accent-glow); }

  .order-wrap { height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--paper); }
  .top-bar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 14px 24px; background: var(--surface); border-bottom: 1px solid var(--line); box-shadow: var(--shadow-sm); }
  .brand { font-family: var(--font-display); font-weight: 600; font-size: 19px; margin: 0; background: linear-gradient(135deg, var(--accent), var(--violet)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .student-tag { text-align: center; }
  .header-right { display: flex; align-items: center; justify-content: flex-end; gap: 16px; }
  .header-name { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: 0; }
  .header-meta { color: var(--muted); font-size: 11px; margin: 2px 0 0; font-weight: 600; }
  .clock { color: var(--muted); font-size: 12px; font-weight: 700; margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

  .meter-wrap { display: flex; align-items: center; gap: 8px; }
  .meter-ring { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .meter-pct { width: 30px; height: 30px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; }
  .meter-text { display: flex; flex-direction: column; line-height: 1.1; }
  .meter-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 800; }
  .meter-value { font-size: 15px; font-weight: 800; }

  .paging-bar { display: flex; align-items: center; justify-content: space-between; padding: 8px 24px; background: var(--violet-soft); border-bottom: 1px solid var(--line); }
  .paging-btn { font-size: 12px; font-weight: 800; color: var(--violet); display: flex; align-items: center; gap: 6px; background: none; border: none; padding: 4px 8px; border-radius: 8px; font: inherit; }
  .paging-btn:disabled { opacity: 0.4; }
  .paging-label { font-size: 12px; font-weight: 800; color: var(--muted); }

  .main-area { flex: 1; display: flex; min-height: 0; padding: 16px 20px; gap: 16px; }
  .rail { width: 300px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .rail-items { flex: 1; display: flex; flex-direction: column; justify-content: space-between; min-height: 0; }
  .rail-slot { display: flex; align-items: center; gap: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 14px 18px; cursor: pointer; font: inherit; box-shadow: var(--shadow-sm); width: 100%; text-align: left; position: relative; }
  .rail-slot.align-right { flex-direction: row-reverse; text-align: right; }
  .rail-slot-empty { border: 1px dashed var(--line); border-radius: 16px; height: 88px; opacity: 0.35; }
  .thumb { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; flex-shrink: 0; background: var(--paper); }
  .thumb-fallback { width: 56px; height: 56px; border-radius: 12px; background: var(--paper); display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0; }
  .rail-slot-info { flex: 1; min-width: 0; }
  .rail-slot-name { font-family: var(--font-display); font-weight: 600; font-size: 17px; color: var(--ink); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rail-slot-price { color: var(--accent); font-weight: 800; font-size: 15px; margin: 3px 0 0; }
  .rail-slot-qty { position: absolute; top: 8px; right: 8px; background: linear-gradient(135deg, var(--ok), #0ea876); color: #fff; font-weight: 900; font-size: 13px; border-radius: 999px; min-width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; padding: 0 7px; box-shadow: 0 4px 10px rgba(18,203,140,0.4); }
  .rail-slot.align-right .rail-slot-qty { right: auto; left: 8px; }

  .keycap { font-family: "Courier New", monospace; font-weight: 900; font-size: 12px; border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; min-width: 22px; text-align: center; flex-shrink: 0; box-shadow: inset 0 -2px 0 rgba(0,0,0,0.06); display: inline-block; background: var(--surface); color: var(--ink); }
  .keycap-danger { background: var(--danger-soft); color: var(--danger); }
  .keycap-accent { background: var(--accent); color: #fff; }

  .edge-cancel-btn { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 16px 10px; border-radius: 14px; border: 1px solid var(--danger-soft); background: var(--surface); color: var(--danger); font-weight: 800; font-size: 14px; }
  .edge-confirm-btn { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 16px 10px; border-radius: 14px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-weight: 800; font-size: 14px; box-shadow: 0 10px 24px var(--accent-glow); }
  .edge-confirm-btn:disabled, .edge-cancel-btn:disabled { opacity: 0.5; }

  .memo-wrap { flex: 1; display: flex; justify-content: center; min-height: 0; }
  .memo-card { width: 100%; max-width: 420px; background: var(--surface); border-top: 4px solid var(--accent); border-radius: 20px; padding: 16px; display: flex; flex-direction: column; min-height: 0; box-shadow: var(--shadow-lg); }
  .memo-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .memo-head-title { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: 0; }
  .balance-pill { background: var(--ok-soft); color: var(--ok); font-weight: 800; font-size: 13px; margin: 0; padding: 5px 12px; border-radius: 999px; }

  .receipt { background: var(--paper); border: 1px dashed var(--line); border-radius: 12px; padding: 12px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .receipt-brand { display: flex; align-items: center; gap: 8px; }
  .receipt-brand-text { font-family: var(--font-display); font-weight: 700; font-size: 15px; }
  .receipt-student { border-top: 1px dashed var(--line); margin-top: 8px; padding-top: 6px; }
  .receipt-student-name { font-weight: 800; font-size: 13px; margin: 0; }
  .receipt-student-meta { color: var(--muted); font-size: 11px; font-weight: 600; margin: 2px 0 0; }
  .receipt-divider { border-top: 1px dashed var(--line); margin: 8px 0; }
  .receipt-items { flex: 1; overflow-y: auto; min-height: 0; }
  .receipt-empty { color: var(--muted); font-size: 12px; font-weight: 600; text-align: center; padding: 20px 0; }
  .fav-block { text-align: center; }
  .fav-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 800; margin: 0 0 8px; }
  .fav-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
  .fav-chip { font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
  .receipt-row { border-bottom: 1px solid var(--line); padding: 6px 0; }
  .receipt-row-top { display: flex; justify-content: space-between; gap: 8px; }
  .receipt-row-name { font-family: var(--font-display); font-weight: 600; font-size: 13px; }
  .receipt-row-amount { font-weight: 700; font-size: 13px; }
  .receipt-row-ctrl { display: flex; align-items: center; justify-content: space-between; margin-top: 2px; }
  .receipt-row-unit { color: var(--muted); font-size: 11px; }
  .stepper { display: flex; gap: 6px; }
  .stepper-btn { width: 22px; height: 22px; border-radius: 999px; border: none; background: var(--surface); box-shadow: var(--shadow-sm); font-weight: 900; font-size: 13px; line-height: 1; }

  .total-row { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 4px; font-weight: 800; font-size: 14px; }
  .total-value { font-size: 22px; color: var(--accent); }
  .delivery-row { display: flex; gap: 8px; }
  .delivery-btn { flex: 1; padding: 10px 0; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); font-weight: 800; font-size: 13px; }
  .delivery-btn.active { border: none; background: linear-gradient(135deg, var(--violet), #6647e0); color: #fff; box-shadow: 0 8px 18px rgba(124,92,250,0.4); }
`;

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>CCPC Smart Canteen</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+Da+2:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
</head><body>

<div id="idleScreen" class="idle-wrap">
  <input id="hidCapture" class="hid-capture" aria-hidden="true" tabindex="-1" autocomplete="off">
  <div class="bridge-badge" title="PC/SC card readers (like the ACR122U) need the local bridge.py script running on this machine. HID/keyboard-emulation readers don't need it.">
    <span id="bridgeDot" class="bridge-dot" style="background:var(--danger)"></span>
    <span id="bridgeText" class="bridge-text">Card Reader Bridge Not Connected</span>
  </div>
  <div class="idle-card">
    <div class="pulse card-icon">&#128179;</div>
    <h1 class="idle-title">Tap your Smart Card</h1>
    <p class="idle-sub">&#9889; CCPC Smart Canteen</p>
    <p id="idleStatus" class="status-line" style="display:none"></p>
    <form id="manualForm" class="manual-form">
      <input id="manualInput" class="manual-input" placeholder="Or enter Student ID" autocomplete="off">
      <button id="manualBtn" type="submit" class="manual-btn">Go</button>
    </form>
  </div>
</div>

<div id="orderScreen" class="order-wrap" style="display:none">
  <div class="top-bar">
    <p class="brand"><span style="-webkit-text-fill-color:initial">&#127859;</span> CCPC Canteen</p>
    <div class="student-tag">
      <p id="headerName" class="header-name"></p>
      <p id="headerMeta" class="header-meta"></p>
    </div>
    <div class="header-right">
      <div id="meterWrap"></div>
      <p id="clock" class="clock"></p>
    </div>
  </div>
  <div id="pagingBar" class="paging-bar" style="display:none">
    <button id="prevPageBtn" type="button" class="paging-btn"><span class="keycap">&larr;</span> Previous</button>
    <span id="pagingLabel" class="paging-label"></span>
    <button id="nextPageBtn" type="button" class="paging-btn">Next <span class="keycap">&rarr;</span></button>
  </div>
  <p id="orderStatus" class="status-line" style="display:none"></p>
  <div class="main-area">
    <div class="rail">
      <div id="leftRail" class="rail-items"></div>
      <button id="cancelBtn" type="button" class="edge-cancel-btn"><span class="keycap keycap-danger">C</span><span>Cancel</span></button>
    </div>
    <div class="memo-wrap">
      <div class="memo-card">
        <div class="memo-head">
          <p class="memo-head-title">Live Voucher</p>
          <p id="balancePill" class="balance-pill"></p>
        </div>
        <div class="receipt">
          <div class="receipt-brand"><span style="font-size:22px">&#127859;</span><span class="receipt-brand-text">CCPC Canteen</span></div>
          <div class="receipt-student">
            <p id="receiptStudentName" class="receipt-student-name"></p>
            <p id="receiptStudentMeta" class="receipt-student-meta"></p>
          </div>
          <div class="receipt-divider"></div>
          <div id="receiptItems" class="receipt-items"></div>
        </div>
        <div class="total-row"><span>Total</span><span id="totalValue" class="total-value"></span></div>
        <p id="balanceWarning" class="status-line" style="display:none;color:var(--danger);margin:0 0 10px">Insufficient balance.</p>
        <div class="delivery-row">
          <button id="handBtn" type="button" class="delivery-btn"><span class="keycap">H</span> &#9995; Hand</button>
          <button id="classBtn" type="button" class="delivery-btn"><span class="keycap">K</span> &#127979; Class</button>
        </div>
      </div>
    </div>
    <div class="rail">
      <div id="rightRail" class="rail-items"></div>
      <button id="confirmBtn" type="button" class="edge-confirm-btn"><span class="keycap keycap-accent">Enter</span><span>Confirm Order</span></button>
    </div>
  </div>
</div>

<script>
(function () {
  var NFC_BRIDGE_URL = 'ws://localhost:8787';
  var IDLE_RESET_MS = 45000;
  var PAGE_SIZE = 10;
  var SHORTCUT_DEBOUNCE_MS = 100;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    student: null, foods: [], cart: {}, page: 0,
    deliveryOption: 'hand', status: { text: '', tone: 'muted' }, busy: false, bridgeConnected: false,
  };

  var idleTimerId = null;
  var hidInput = document.getElementById('hidCapture');
  var idleScreen = document.getElementById('idleScreen');
  var orderScreen = document.getElementById('orderScreen');

  // ---- fetch the menu once on load (same as the original's mount effect) ----
  fetch('/api/canteen-kiosk/menu').then(function (r) { return r.json(); }).then(function (d) {
    if (d.success) { state.foods = d.foods; renderOrderDynamic(); }
  }).catch(function () {
    state.status = { text: 'Could not load the menu.', tone: 'danger' };
    renderIdle();
  });

  function toneColor(t) {
    if (t === 'danger') return 'var(--danger)';
    if (t === 'ok') return 'var(--ok)';
    return 'var(--muted)';
  }

  // ---- Channel 1: hidden always-focused capture input ----------------------
  // One persistent DOM node shared across both screens (simpler and at least
  // as robust as the original's per-screen remount, since there's never a
  // focus gap while switching idle<->order here).
  hidInput.focus();
  function refocusHid() { setTimeout(function () { hidInput.focus(); }, 50); }
  window.addEventListener('click', refocusHid);
  hidInput.addEventListener('blur', refocusHid);
  hidInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var uid = hidInput.value.trim();
    hidInput.value = ''; // clear BEFORE acting -- see file header comment
    if (uid) {
      verifyCard(uid);
    } else if (state.student) {
      confirmOrder();
    }
  });

  // ---- Channel 2: 16-button shortcut debounce -------------------------------
  function isShortcutKey(key) {
    return /^[0-9]$/.test(key) || key === 'ArrowLeft' || key === 'ArrowRight'
      || key === 'c' || key === 'C' || key === 'h' || key === 'H' || key === 'k' || key === 'K';
  }
  (function () {
    var lastTime = 0;
    var timer = null;
    window.addEventListener('keydown', function (e) {
      if (!isShortcutKey(e.key)) return;
      var now = performance.now();
      var delta = now - lastTime;
      lastTime = now;
      if (timer) { clearTimeout(timer); timer = null; }
      if (delta < SHORTCUT_DEBOUNCE_MS) return; // part of a fast HID burst, not a deliberate press
      var key = e.key;
      timer = setTimeout(function () {
        timer = null;
        hidInput.value = ''; // drop the stray char it typed
        dispatchShortcut(key);
      }, SHORTCUT_DEBOUNCE_MS);
    });
  })();

  function dispatchShortcut(key) {
    if (!state.student) return;
    if (key === 'ArrowLeft') { goPrevPage(); return; }
    if (key === 'ArrowRight') { goNextPage(); return; }
    if (key === 'c' || key === 'C') { resetToIdle(); return; }
    if (key === 'h' || key === 'H') { state.deliveryOption = 'hand'; resetIdleTimer(); renderOrderDynamic(); return; }
    if (key === 'k' || key === 'K') { state.deliveryOption = 'class'; resetIdleTimer(); renderOrderDynamic(); return; }
    var num = Number(key);
    var idx = num === 0 ? 9 : num - 1;
    var pageItems = currentPageItems();
    var food = pageItems[idx];
    if (food) addToCart(food);
  }

  // ---- Channel 3: WebSocket bridge for PC/SC-only readers -------------------
  (function () {
    var ws, cancelled = false;
    function connect() {
      try {
        ws = new WebSocket(NFC_BRIDGE_URL);
        ws.onopen = function () { state.bridgeConnected = true; renderIdle(); };
        ws.onmessage = function (ev) {
          try {
            var data = JSON.parse(ev.data);
            if (data.uid) verifyCard(data.uid);
          } catch (e) {}
        };
        ws.onclose = function () { state.bridgeConnected = false; renderIdle(); if (!cancelled) setTimeout(connect, 3000); };
        ws.onerror = function () {};
      } catch (e) {
        state.bridgeConnected = false;
        renderIdle();
      }
    }
    connect();
    window.addEventListener('beforeunload', function () { cancelled = true; if (ws) ws.close(); });
  })();

  // ---- idle timer / reset ----------------------------------------------------
  function resetIdleTimer() {
    if (idleTimerId) clearTimeout(idleTimerId);
    idleTimerId = setTimeout(resetToIdle, IDLE_RESET_MS);
  }
  function resetToIdle() {
    state.student = null;
    state.cart = {};
    state.page = 0;
    state.deliveryOption = 'hand';
    state.status = { text: '', tone: 'muted' };
    hidInput.value = '';
    document.getElementById('manualInput').value = '';
    if (idleTimerId) clearTimeout(idleTimerId);
    render();
  }

  // ---- verify card / place order ---------------------------------------------
  function verifyCard(uid) {
    state.busy = true;
    state.status = { text: 'Checking card…', tone: 'muted' };
    render();
    fetch('/api/canteen-kiosk/verify-card', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: uid }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      state.busy = false;
      if (!data.success) {
        state.status = { text: data.message || 'Card not recognized.', tone: 'danger' };
        render();
        setTimeout(function () { state.status = { text: '', tone: 'muted' }; render(); }, 4000);
        return;
      }
      state.student = data.student;
      state.page = 0;
      state.status = { text: '', tone: 'muted' };
      resetIdleTimer();
      render();
    }).catch(function () {
      state.busy = false;
      state.status = { text: 'Network error verifying card.', tone: 'danger' };
      render();
    });
  }

  function confirmOrder() {
    var items = cartItems();
    if (!state.student || !items.length || isOverBalance() || state.busy) return;
    state.busy = true;
    state.status = { text: 'Placing order…', tone: 'muted' };
    renderOrderDynamic();
    fetch('/api/canteen-kiosk/place-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: state.student.student_id, items: items, delivery_option: state.deliveryOption }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      state.busy = false;
      if (!data.success) {
        state.status = { text: data.message || 'Order failed.', tone: 'danger' };
        renderOrderDynamic();
        return;
      }
      state.status = { text: data.message, tone: 'ok' };
      renderOrderDynamic();
      setTimeout(resetToIdle, 2500);
    }).catch(function () {
      state.busy = false;
      state.status = { text: 'Network error placing order.', tone: 'danger' };
      renderOrderDynamic();
    });
  }

  // ---- cart helpers ------------------------------------------------------------
  function addToCart(food) { state.cart[food.id] = (state.cart[food.id] || 0) + 1; resetIdleTimer(); renderOrderDynamic(); }
  function incCartItem(id) { state.cart[id] = (state.cart[id] || 0) + 1; resetIdleTimer(); renderOrderDynamic(); }
  function decCartItem(id) {
    var cur = (state.cart[id] || 0) - 1;
    if (cur <= 0) delete state.cart[id]; else state.cart[id] = cur;
    resetIdleTimer();
    renderOrderDynamic();
  }
  function cartItems() {
    var out = [];
    for (var id in state.cart) {
      var qty = state.cart[id];
      var food = null;
      for (var i = 0; i < state.foods.length; i++) { if (String(state.foods[i].id) === String(id)) { food = state.foods[i]; break; } }
      if (food) out.push({ id: food.id, name: food.name, price: Number(food.unit_price), qty: qty });
    }
    return out;
  }
  function cartTotal() { var items = cartItems(); var s = 0; for (var i = 0; i < items.length; i++) s += items[i].price * items[i].qty; return s; }
  function isOverBalance() {
    var balance = Number((state.student && state.student.balance) || 0);
    var lending = Number((state.student && state.student.lending_limit) || 0);
    return cartTotal() > balance + lending;
  }

  // Same 5-left / 5-right / paged-by-10 split as the original -- slot N always
  // means the same physical button regardless of how many foods exist.
  function currentPageItems() {
    var pageStart = state.page * PAGE_SIZE;
    return state.foods.slice(pageStart, pageStart + PAGE_SIZE);
  }
  function totalPages() { return Math.max(1, Math.ceil(state.foods.length / PAGE_SIZE)); }
  function goPrevPage() { state.page = Math.max(0, state.page - 1); resetIdleTimer(); renderOrderDynamic(); }
  function goNextPage() { state.page = Math.min(totalPages() - 1, state.page + 1); resetIdleTimer(); renderOrderDynamic(); }

  // ---- manual fallback form ----------------------------------------------------
  document.getElementById('manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var el = document.getElementById('manualInput');
    var v = el.value.trim();
    if (!v) return;
    verifyCard(v);
  });

  document.getElementById('cancelBtn').addEventListener('click', resetToIdle);
  document.getElementById('confirmBtn').addEventListener('click', confirmOrder);
  document.getElementById('prevPageBtn').addEventListener('click', goPrevPage);
  document.getElementById('nextPageBtn').addEventListener('click', goNextPage);
  document.getElementById('handBtn').addEventListener('click', function () { state.deliveryOption = 'hand'; resetIdleTimer(); renderOrderDynamic(); });
  document.getElementById('classBtn').addEventListener('click', function () { state.deliveryOption = 'class'; resetIdleTimer(); renderOrderDynamic(); });

  // ---- rendering ------------------------------------------------------------------
  function render() {
    if (!state.student) {
      idleScreen.style.display = '';
      orderScreen.style.display = 'none';
      renderIdle();
    } else {
      idleScreen.style.display = 'none';
      orderScreen.style.display = '';
      renderOrderDynamic();
    }
  }

  function renderIdle() {
    var dot = document.getElementById('bridgeDot');
    var text = document.getElementById('bridgeText');
    dot.style.background = state.bridgeConnected ? 'var(--ok)' : 'var(--danger)';
    text.textContent = state.bridgeConnected ? 'Card Reader Bridge Connected' : 'Card Reader Bridge Not Connected';
    var statusEl = document.getElementById('idleStatus');
    statusEl.textContent = state.status.text;
    statusEl.style.color = toneColor(state.status.tone);
    statusEl.style.display = state.status.text ? '' : 'none';
    document.getElementById('manualBtn').disabled = state.busy;
  }

  function foodThumbHtml(food) {
    if (!food.photo) return '<div class="thumb-fallback" aria-hidden="true">🍽️</div>';
    return '<img class="thumb food-thumb-img" src="' + esc(food.photo) + '" alt="' + esc(food.name) + '">';
  }
  // Rebinds the fallback-on-error handler after every innerHTML rebuild,
  // same pattern as the rail-slot click delegation below -- avoids juggling
  // nested quote-escaping for an inline onerror attribute string.
  function bindThumbFallbacks(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.food-thumb-img'), function (img) {
      img.addEventListener('error', function () {
        var div = document.createElement('div');
        div.className = 'thumb-fallback';
        div.setAttribute('aria-hidden', 'true');
        div.textContent = '🍽️';
        img.replaceWith(div);
      });
    });
  }

  function railSlotHtml(food, digit, align) {
    if (!food) return '<div class="rail-slot-empty"></div>';
    var qty = state.cart[food.id] || 0;
    var alignCls = align === 'right' ? ' align-right' : '';
    return '<button type="button" class="rail-slot' + alignCls + '" data-food-id="' + esc(food.id) + '">'
      + '<span class="keycap">' + esc(digit) + '</span>'
      + foodThumbHtml(food)
      + '<span class="rail-slot-info"><p class="rail-slot-name">' + esc(food.name) + '</p><p class="rail-slot-price">৳' + Number(food.unit_price).toFixed(2) + '</p></span>'
      + (qty > 0 ? '<span class="rail-slot-qty">' + qty + '</span>' : '')
      + '</button>';
  }

  function renderOrderDynamic() {
    if (!state.student) return;
    var s = state.student;
    document.getElementById('headerName').textContent = s.name;
    document.getElementById('headerMeta').textContent = s.class_section_roll + ' · ID ' + s.student_id;

    var meterWrap = document.getElementById('meterWrap');
    if (s.daily_limit > 0) {
      var spent = Number(s.spent_today || 0);
      var limit = Number(s.daily_limit);
      var pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
      var color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--accent-2)' : 'var(--ok)';
      var left = Math.max(0, limit - spent);
      meterWrap.innerHTML = '<div class="meter-wrap" title="Spent ৳' + spent.toFixed(2) + ' of ৳' + limit.toFixed(2) + ' today">'
        + '<div class="meter-ring" style="background:conic-gradient(' + color + ' ' + (pct * 3.6) + 'deg, var(--line) 0deg)"><span class="meter-pct">' + pct + '%</span></div>'
        + '<div class="meter-text"><span class="meter-label">Left today</span><span class="meter-value" style="color:' + color + '">৳' + left.toFixed(0) + '</span></div>'
        + '</div>';
    } else {
      meterWrap.innerHTML = '';
    }

    var tp = totalPages();
    var pagingBar = document.getElementById('pagingBar');
    if (tp > 1) {
      pagingBar.style.display = '';
      document.getElementById('pagingLabel').textContent = 'Page ' + (state.page + 1) + ' of ' + tp;
      var prevBtn = document.getElementById('prevPageBtn');
      var nextBtn = document.getElementById('nextPageBtn');
      prevBtn.disabled = state.page === 0;
      prevBtn.style.opacity = state.page === 0 ? '0.4' : '1';
      nextBtn.disabled = state.page === tp - 1;
      nextBtn.style.opacity = state.page === tp - 1 ? '0.4' : '1';
    } else {
      pagingBar.style.display = 'none';
    }

    var statusEl = document.getElementById('orderStatus');
    statusEl.textContent = state.status.text;
    statusEl.style.color = toneColor(state.status.tone);
    statusEl.style.display = state.status.text ? '' : 'none';

    var pageItems = currentPageItems();
    var leftSlots = [], rightSlots = [];
    for (var i = 0; i < 5; i++) leftSlots.push(pageItems[i] || null);
    for (var j = 0; j < 5; j++) rightSlots.push(pageItems[j + 5] || null);

    var leftRailEl = document.getElementById('leftRail');
    var rightRailEl = document.getElementById('rightRail');
    leftRailEl.innerHTML = leftSlots.map(function (f, i) { return railSlotHtml(f, String(i + 1), 'left'); }).join('');
    rightRailEl.innerHTML = rightSlots.map(function (f, i) { return railSlotHtml(f, i === 4 ? '0' : String(i + 6), 'right'); }).join('');
    bindThumbFallbacks(leftRailEl);
    bindThumbFallbacks(rightRailEl);
    // Delegate rail-slot clicks (innerHTML was just rebuilt, so bind fresh each time).
    Array.prototype.forEach.call(document.querySelectorAll('#leftRail .rail-slot, #rightRail .rail-slot'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-food-id');
        var food = null;
        for (var k = 0; k < state.foods.length; k++) { if (String(state.foods[k].id) === String(id)) { food = state.foods[k]; break; } }
        if (food) addToCart(food);
      });
    });

    document.getElementById('receiptStudentName').textContent = s.name;
    document.getElementById('receiptStudentMeta').textContent = 'ID ' + s.student_id + ' · ' + s.class_section_roll;
    document.getElementById('balancePill').textContent = '৳' + Number(s.balance || 0).toFixed(2);

    var items = cartItems();
    var receiptEl = document.getElementById('receiptItems');
    if (!items.length) {
      var favourites = Array.isArray(s.favourites) ? s.favourites : [];
      var favHtml = favourites.length
        ? '<div class="fav-block"><p class="fav-label">You usually order</p><div class="fav-row">' + favourites.map(function (f) { return '<span class="fav-chip">' + esc(f.name) + '</span>'; }).join('') + '</div></div>'
        : '';
      receiptEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:18px;padding-top:8px"><p class="receipt-empty">Press a numbered item to add it here.</p>' + favHtml + '</div>';
    } else {
      receiptEl.innerHTML = items.map(function (item) {
        return '<div class="receipt-row" data-item-id="' + esc(item.id) + '">'
          + '<div class="receipt-row-top"><span class="receipt-row-name">' + esc(item.name) + '</span><span class="receipt-row-amount">৳' + (item.price * item.qty).toFixed(2) + '</span></div>'
          + '<div class="receipt-row-ctrl"><span class="receipt-row-unit">৳' + item.price.toFixed(2) + ' × ' + item.qty + '</span>'
          + '<div class="stepper"><button type="button" class="stepper-btn dec-btn">–</button><button type="button" class="stepper-btn inc-btn">+</button></div></div>'
          + '</div>';
      }).join('');
      Array.prototype.forEach.call(receiptEl.querySelectorAll('.receipt-row'), function (row) {
        var id = row.getAttribute('data-item-id');
        row.querySelector('.dec-btn').addEventListener('click', function () { decCartItem(id); });
        row.querySelector('.inc-btn').addEventListener('click', function () { incCartItem(id); });
      });
    }

    document.getElementById('totalValue').textContent = '৳' + cartTotal().toFixed(2);
    var overBalance = isOverBalance();
    document.getElementById('balanceWarning').style.display = overBalance && items.length > 0 ? '' : 'none';

    var handBtn = document.getElementById('handBtn');
    var classBtn = document.getElementById('classBtn');
    handBtn.className = 'delivery-btn' + (state.deliveryOption === 'hand' ? ' active' : '');
    classBtn.className = 'delivery-btn' + (state.deliveryOption === 'class' ? ' active' : '');

    var confirmBtn = document.getElementById('confirmBtn');
    var confirmDisabled = !items.length || overBalance || state.busy;
    confirmBtn.disabled = confirmDisabled;
    confirmBtn.style.opacity = confirmDisabled ? '0.5' : '1';
  }

  // ---- clock -------------------------------------------------------------------
  function tickClock() {
    var now = new Date();
    document.getElementById('clock').textContent = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  tickClock();
  setInterval(tickClock, 1000);

  render();
})();
</script>
</body></html>`;

export async function GET() {
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
