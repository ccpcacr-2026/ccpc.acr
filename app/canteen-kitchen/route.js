export const dynamic = 'force-dynamic';

// Staff-facing canteen Kitchen screen — ported from the standalone
// ccpc-canteen app's app/kitchen/page.js (a React client component) into
// this repo's own plain-HTML-string + inline-vanilla-JS standalone-route
// convention, same skeleton as app/canteen-kiosk/route.js. Every behavior
// below is ported 1:1 from the original, not simplified.
//
// Auth: staff sign into a specific physical counter using that counter's
// own password (set by an admin via app/api/canteen-admin/route.js, gated
// by this repo's own Admin-role check — see that file's header comment for
// why). The server issues a signed `kitchen_session` cookie
// (lib/canteen-kitchen-auth.js) carrying which counter they're in; every
// other endpoint re-derives the counter from that cookie, never a
// client-sent value.
//
// This is a normal mouse/keyboard staff dashboard, not a touchscreen-only
// kiosk — no special HID handling needed here, unlike canteen-kiosk.

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
    --shadow-sm:0 1px 2px rgba(18,19,26,0.06); --shadow-md:0 6px 18px rgba(18,19,26,0.08); --shadow-lg:0 16px 40px rgba(18,19,26,0.14);
    --font-display:'Baloo Da 2',sans-serif; --font-body:'Manrope',sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink:#f2f3fa; --paper:#0d0e14; --surface:#171926; --line:#262a3b; --muted:#9ca1b8;
      --accent-soft:#3a1f16; --accent-glow:rgba(255,90,54,0.45); --violet-soft:#251c42;
      --ok-soft:#0e3527; --danger-soft:#3a121c;
      --shadow-sm:0 1px 2px rgba(0,0,0,0.3); --shadow-md:0 6px 18px rgba(0,0,0,0.35); --shadow-lg:0 16px 40px rgba(0,0,0,0.5);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--paper); color: var(--ink); font-family: var(--font-body), -apple-system, "Segoe UI", Arial, sans-serif; font-variant-numeric: tabular-nums; }
  button { font-family: inherit; cursor: pointer; }
  input { font-family: inherit; }

  .wrap { min-height: 100vh; background: var(--paper); padding: 24px; }
  .muted { color: var(--muted); font-weight: 600; padding: 20px; text-align: center; }

  .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at 22% 20%, rgba(255,90,54,0.30), transparent 45%), radial-gradient(circle at 82% 78%, rgba(124,92,250,0.30), transparent 45%), var(--night); }
  .login-card { background: var(--surface); border-radius: 20px; padding: 32px; width: 320px; display: flex; flex-direction: column; gap: 10px; box-shadow: var(--shadow-lg); }
  .login-title { font-family: var(--font-display); margin: 0; font-size: 24px; font-weight: 700; }
  .login-sub { margin: 0 0 8px; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .login-label { font-size: 11px; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
  .login-input { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line); font-size: 14px; background: var(--surface); color: var(--ink); }
  .login-error { color: var(--danger); font-size: 13px; font-weight: 700; margin: 0; }
  .login-note { color: var(--muted); font-size: 13px; font-weight: 600; line-height: 1.5; margin: 4px 0; }
  .login-btn { padding: 12px 0; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-weight: 800; font-size: 14px; box-shadow: 0 10px 24px var(--accent-glow); margin-top: 6px; }
  .signout { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); font-weight: 700; font-size: 12px; }

  .top-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
  .title { font-family: var(--font-display); margin: 0; font-size: 28px; font-weight: 700; }
  .controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .search { padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); font-size: 13px; background: var(--surface); min-width: 200px; color: var(--ink); }
  .pill-on { padding: 10px 16px; border-radius: 10px; border: none; background: var(--ok-soft); color: var(--ok); font-weight: 800; font-size: 12px; }
  .pill-off { padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); font-weight: 800; font-size: 12px; }
  .tabs { display: flex; gap: 8px; }
  .tab { padding: 10px 18px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-weight: 700; font-size: 13px; }
  .tab-active { padding: 10px 18px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-weight: 800; font-size: 13px; box-shadow: 0 8px 18px var(--accent-glow); }

  .popular-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; background: var(--violet-soft); border-radius: 12px; margin-bottom: 12px; }
  .popular-label { font-weight: 800; font-size: 12px; color: var(--violet); text-transform: uppercase; letter-spacing: 0.04em; }
  .popular-chip { font-size: 13px; font-weight: 600; padding: 4px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); }

  .hint { font-size: 13px; color: var(--muted); font-weight: 600; margin: 0 0 12px; }
  .kbd { font-family: "Courier New", monospace; font-weight: 900; font-size: 11px; border: 1px solid var(--line); border-radius: 6px; padding: 2px 7px; background: var(--surface); }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .card { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 4px; box-shadow: var(--shadow-md); }
  .card-oldest { grid-column: 1 / -1; box-shadow: 0 12px 34px var(--accent-glow); }
  .next-tag { position: absolute; top: -10px; left: 16px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-size: 10px; font-weight: 900; letter-spacing: 0.08em; padding: 3px 10px; border-radius: 999px; }
  .card-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); font-weight: 700; }
  .invoice { font-family: "Courier New", monospace; }
  .student-name { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: 4px 0 0; }
  .student-meta { color: var(--muted); font-size: 12px; font-weight: 600; margin: 2px 0 8px; }
  .items { border-top: 1px dashed var(--line); border-bottom: 1px dashed var(--line); padding: 8px 0; display: flex; flex-direction: column; gap: 4px; }
  .item-row { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
  .card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
  .total { font-weight: 900; font-size: 19px; color: var(--accent); }
  .actions { display: flex; align-items: center; gap: 8px; }
  .ghost-btn { padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-weight: 700; font-size: 12px; }
  .deliver-btn { padding: 8px 16px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--ok), #0ea876); color: #fff; font-weight: 800; font-size: 12px; box-shadow: 0 6px 14px rgba(18,203,140,0.35); }
  .deliver-btn:disabled { opacity: 0.6; }
  .delivered-tag { padding: 6px 12px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font-weight: 800; font-size: 11px; }

  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--paper); padding: 12px 22px; border-radius: 999px; font-weight: 700; font-size: 14px; box-shadow: var(--shadow-lg); z-index: 50; }

  .backdrop { position: fixed; inset: 0; background: rgba(10,11,18,0.55); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 60; backdrop-filter: blur(2px); }
  .modal { background: var(--surface); border-radius: 18px; padding: 24px; width: 100%; max-width: 460px; box-shadow: var(--shadow-lg); border: 1px solid var(--line); }
  .modal-title { font-family: var(--font-display); font-size: 20px; font-weight: 800; margin: 0 0 2px; }
  .modal-sub { color: var(--muted); font-size: 13px; font-weight: 600; margin: 0 0 16px; }
  .row-list { display: flex; flex-direction: column; gap: 8px; max-height: 46vh; overflow-y: auto; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .row-name { font-weight: 700; font-size: 14px; margin: 0; }
  .row-unit { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
  .stepper { display: flex; align-items: center; gap: 10px; }
  .step-btn { width: 30px; height: 30px; border-radius: 999px; border: none; background: var(--paper); color: var(--ink); font-weight: 900; font-size: 16px; line-height: 1; }
  .qty { font-weight: 800; font-size: 15px; min-width: 22px; text-align: center; }
  .summary { padding: 14px 0 4px; font-weight: 800; font-size: 14px; text-align: right; }
  .foot { display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px; }
  .cancel-btn { padding: 10px 18px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-weight: 700; font-size: 13px; }
  .confirm-btn { padding: 10px 20px; border-radius: 10px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-weight: 800; font-size: 13px; box-shadow: 0 8px 18px var(--accent-glow); }
`;

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CCPC Kitchen</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+Da+2:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
</head><body>

<div id="loadingScreen" class="wrap"><p class="muted">Loading…</p></div>

<div id="loginScreen" class="login-wrap" style="display:none">
  <form id="loginForm" class="login-card">
    <h1 class="login-title">&#127859; Kitchen Counter</h1>
    <p class="login-sub">Sign in to your counter</p>
    <div id="noCountersNote" class="login-note" style="display:none">No counters have been set up yet. An admin needs to create one (Admin → Canteen Counters) with a password.</div>
    <div id="loginFields" style="display:none">
      <label class="login-label">Counter</label>
      <select id="counterSelect" class="login-input" style="width:100%"></select>
      <label class="login-label">Counter password</label>
      <input type="password" id="passwordInput" class="login-input" style="width:100%" placeholder="Password" autocomplete="current-password">
    </div>
    <p id="loginError" class="login-error" style="display:none"></p>
    <button id="loginBtn" type="submit" class="login-btn" style="display:none">Open counter</button>
  </form>
</div>

<div id="mainScreen" class="wrap" style="display:none">
  <div class="top-bar">
    <h1 class="title">&#127859; Counter <span id="counterLabel"></span></h1>
    <div class="controls">
      <input id="searchInput" class="search" placeholder="Search name / ID / invoice">
      <button id="myCounterBtn" type="button" class="pill-off"></button>
      <button id="counterOpenBtn" type="button" class="pill-off"></button>
      <div class="tabs">
        <button id="tabPendingBtn" type="button" class="tab-active">Pending</button>
        <button id="tabDeliveredBtn" type="button" class="tab">Delivered</button>
      </div>
      <button id="signoutBtn" type="button" class="signout">Sign out</button>
    </div>
  </div>
  <div id="popularBar" class="popular-bar" style="display:none"></div>
  <p id="hintLine" class="hint" style="display:none">Press <kbd class="kbd">Enter</kbd> to mark the oldest order ready.</p>
  <div id="ordersGrid" class="grid"></div>
</div>

<div id="dialogHost"></div>
<div id="toastHost"></div>

<script>
(function () {
  var POLL_MS = 5000;
  var COUNTER_HEARTBEAT_MS = 60000;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    checking: true, authed: false, counter: null, availableCounters: [],
    tab: 'pending', orders: [], popular: [], query: '', myCounterOnly: false,
    busyId: null, dialog: null, counterOpen: false,
  };
  var pollTimer = null, heartbeatTimer = null;

  function flash(msg) {
    var host = document.getElementById('toastHost');
    host.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
    setTimeout(function () { host.innerHTML = ''; }, 2600);
  }

  // ---- bootstrap: session check + counters list --------------------------
  fetch('/api/canteen-kitchen/session').then(function (r) { return r.json(); }).then(function (d) {
    if (d.authed) { state.authed = true; state.counter = d.counter_no; }
  }).finally(function () {
    state.checking = false;
    render();
    if (state.authed) {
      startPolling();
      if (state.tab === 'pending') loadPopular();
    }
  });
  fetch('/api/canteen-kitchen/counters').then(function (r) { return r.json(); }).then(function (d) {
    if (d.success && d.counters.length) {
      state.availableCounters = d.counters;
      renderLoginFields();
    }
  }).catch(function () {});

  // ---- polling (Page Visibility-aware, same as the original) -------------
  function startPolling() {
    stopPolling();
    load();
    if (!document.hidden) pollTimer = setInterval(load, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  document.addEventListener('visibilitychange', function () {
    if (!state.authed) return;
    if (document.hidden) stopPolling();
    else startPolling();
  });

  function load() {
    var cf = state.myCounterOnly && state.counter ? '&counter=' + state.counter : '';
    fetch('/api/canteen-kitchen/orders?status=' + state.tab + cf).then(function (r) { return r.json(); })
      .then(function (d) { if (d.success) { state.orders = d.orders; renderMain(); } }).catch(function () {});
  }
  function loadPopular() {
    fetch('/api/canteen-kitchen/popular').then(function (r) { return r.json(); })
      .then(function (d) { if (d.success) { state.popular = d.popular; renderMain(); } }).catch(function () {});
  }
  function sendHeartbeat(isOpen) {
    fetch('/api/canteen-kitchen/counter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_open: isOpen }),
    }).catch(function () {});
  }

  // ---- login / logout ------------------------------------------------------
  function renderLoginFields() {
    var noCounters = state.availableCounters.length === 0;
    document.getElementById('noCountersNote').style.display = noCounters ? '' : 'none';
    document.getElementById('loginFields').style.display = noCounters ? 'none' : '';
    document.getElementById('loginBtn').style.display = noCounters ? 'none' : '';
    if (!noCounters) {
      var sel = document.getElementById('counterSelect');
      sel.innerHTML = state.availableCounters.map(function (c) {
        return '<option value="' + esc(c.counter_id) + '">' + esc(c.name) + '</option>';
      }).join('');
    }
  }
  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    var counterNo = Number(document.getElementById('counterSelect').value);
    var password = document.getElementById('passwordInput').value;
    fetch('/api/canteen-kitchen/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counter_no: counterNo, password: password }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.success) {
        state.authed = true; state.counter = d.counter_no;
        document.getElementById('passwordInput').value = '';
        render();
        startPolling();
        if (state.tab === 'pending') loadPopular();
      } else {
        errEl.textContent = d.message || 'Incorrect password.';
        errEl.style.display = '';
      }
    });
  });
  document.getElementById('signoutBtn').addEventListener('click', function () {
    if (state.counterOpen) { sendHeartbeat(false); }
    fetch('/api/canteen-kitchen/logout', { method: 'POST' }).then(function () {
      state.authed = false; state.counter = null; state.counterOpen = false; state.orders = [];
      stopPolling();
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      render();
    });
  });

  // ---- mark delivered --------------------------------------------------------
  function markDelivered(id) {
    state.busyId = id;
    renderMain();
    fetch('/api/canteen-kitchen/orders/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_delivered: true }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      state.busyId = null;
      if (data.success) {
        state.orders = state.orders.filter(function (o) { return o.id !== id; });
        flash('Order marked ready.');
      }
      renderMain();
    }).catch(function () { state.busyId = null; renderMain(); });
  }

  // ---- oldest-pending Enter shortcut (ignored while a modal/input has focus) --
  function getOldest(filtered) { return state.tab === 'pending' && filtered.length ? filtered[0] : null; }
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (state.dialog) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (!state.authed) return;
    var oldest = getOldest(filteredOrders());
    if (oldest) markDelivered(oldest.id);
  });

  function filteredOrders() {
    var q = state.query.trim().toLowerCase();
    if (!q) return state.orders;
    return state.orders.filter(function (o) {
      return [o.student_name, o.student_id, o.invoice_number].some(function (v) {
        return String(v || '').toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  // ---- modify / return dialog --------------------------------------------------
  function openDialog(mode, order) { state.dialog = { mode: mode, order: order }; renderDialog(); }
  function closeDialog() { state.dialog = null; renderDialog(); }
  function submitModify(orderId, rows) {
    fetch('/api/canteen-kitchen/orders/' + orderId + '/modify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: rows }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      closeDialog();
      flash(data.message || (data.success ? 'Updated.' : 'Modify failed.'));
      if (data.success) load();
    });
  }
  function submitReturn(orderId, returns) {
    fetch('/api/canteen-kitchen/orders/' + orderId + '/return', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returns: returns }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      closeDialog();
      flash(data.message || (data.success ? 'Refunded.' : 'Return failed.'));
      if (data.success) load();
    });
  }
  function renderDialog() {
    var host = document.getElementById('dialogHost');
    if (!state.dialog) { host.innerHTML = ''; return; }
    var mode = state.dialog.mode, order = state.dialog.order, isModify = mode === 'modify';
    var original = (Array.isArray(order.orders) ? order.orders : []).map(function (i) {
      return { id: i.id, name: i.name, price: Number(i.price) || 0, qty: Number(i.qty) || 0 };
    });
    // Working copy -- dialogRows is read/mutated by the stepper buttons below.
    if (!state.dialog.rows) state.dialog.rows = original.map(function (r) { return { id: r.id, name: r.name, price: r.price, qty: r.qty }; });
    var rows = state.dialog.rows;

    function origQtyOf(id) { var f = original.find(function (o) { return o.id === id; }); return f ? f.qty : 0; }
    var newTotal = rows.reduce(function (s, r) { return s + r.price * r.qty; }, 0);
    var oldTotal = Number(order.price) || 0;
    var diff = newTotal - oldTotal;

    var rowsHtml = rows.map(function (r) {
      var origQty = origQtyOf(r.id);
      var plusDisabled = !isModify && r.qty >= origQty;
      return '<div class="row" data-row-id="' + esc(r.id) + '">'
        + '<div><p class="row-name">' + esc(r.name) + '</p><p class="row-unit">৳' + r.price.toFixed(2) + ' each' + (!isModify ? ' · ordered ' + origQty : '') + '</p></div>'
        + '<div class="stepper"><button type="button" class="step-btn dec-row" data-id="' + esc(r.id) + '">–</button>'
        + '<span class="qty">' + r.qty + '</span>'
        + '<button type="button" class="step-btn inc-row" data-id="' + esc(r.id) + '" ' + (plusDisabled ? 'disabled style="opacity:0.4"' : '') + '>+</button></div>'
        + '</div>';
    }).join('');

    var summaryHtml = isModify
      ? '<span style="color:' + (diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--ok)' : 'var(--muted)') + '">'
        + (diff > 0 ? 'Charge ৳' + diff.toFixed(2) : diff < 0 ? 'Refund ৳' + (-diff).toFixed(2) : 'No change') + ' · new total ৳' + newTotal.toFixed(2) + '</span>'
      : '<span style="color:var(--ok)">Refund ৳' + (oldTotal - newTotal).toFixed(2) + '</span>';

    host.innerHTML = '<div class="backdrop" id="dialogBackdrop">'
      + '<div class="modal" id="dialogModal">'
      + '<h2 class="modal-title">' + (isModify ? 'Modify order' : 'Refund items') + ' · #' + esc(order.invoice_number) + '</h2>'
      + '<p class="modal-sub">' + esc(order.student_name) + ' · ' + esc(order.class_section_roll) + '</p>'
      + '<div class="row-list">' + rowsHtml + '</div>'
      + '<div class="summary">' + summaryHtml + '</div>'
      + '<div class="foot"><button type="button" class="cancel-btn" id="dialogCancel">Cancel</button>'
      + '<button type="button" class="confirm-btn" id="dialogConfirm">' + (isModify ? 'Apply changes' : 'Process refund') + '</button></div>'
      + '</div></div>';

    document.getElementById('dialogBackdrop').addEventListener('click', function (e) { if (e.target.id === 'dialogBackdrop') closeDialog(); });
    document.getElementById('dialogCancel').addEventListener('click', closeDialog);
    Array.prototype.forEach.call(host.querySelectorAll('.dec-row'), function (btn) {
      btn.addEventListener('click', function () { setRowQty(btn.getAttribute('data-id'), -1, origQtyOf, isModify); });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.inc-row'), function (btn) {
      btn.addEventListener('click', function () { setRowQty(btn.getAttribute('data-id'), 1, origQtyOf, isModify); });
    });
    document.getElementById('dialogConfirm').addEventListener('click', function () {
      if (isModify) {
        submitModify(order.id, rows);
      } else {
        var returns = rows.map(function (r) { return { id: r.id, qty: origQtyOf(r.id) - r.qty }; }).filter(function (r) { return r.qty > 0; });
        if (!returns.length) { closeDialog(); return; }
        submitReturn(order.id, returns);
      }
    });
  }
  function setRowQty(id, delta, origQtyOf, isModify) {
    var rows = state.dialog.rows;
    var row = rows.find(function (r) { return String(r.id) === String(id); });
    if (!row) return;
    var next = row.qty + delta;
    if (next < 0) next = 0;
    if (!isModify && next > origQtyOf(row.id)) next = origQtyOf(row.id);
    row.qty = next;
    renderDialog();
  }

  // ---- rendering ---------------------------------------------------------------
  function render() {
    document.getElementById('loadingScreen').style.display = state.checking ? '' : 'none';
    document.getElementById('loginScreen').style.display = (!state.checking && !state.authed) ? '' : 'none';
    document.getElementById('mainScreen').style.display = (!state.checking && state.authed) ? '' : 'none';
    if (!state.checking && state.authed) renderMain();
  }

  function renderMain() {
    document.getElementById('counterLabel').textContent = state.counter;
    var filtered = filteredOrders();
    var oldest = getOldest(filtered);

    document.getElementById('hintLine').style.display = oldest ? '' : 'none';

    var myBtn = document.getElementById('myCounterBtn');
    myBtn.className = state.myCounterOnly ? 'pill-on' : 'pill-off';
    myBtn.textContent = state.myCounterOnly ? '🎯 Counter ' + state.counter + ' only' : '🌐 All counters';

    var openBtn = document.getElementById('counterOpenBtn');
    openBtn.className = state.counterOpen ? 'pill-on' : 'pill-off';
    openBtn.textContent = state.counterOpen ? '🟢 Open' : '🔴 Closed';

    document.getElementById('tabPendingBtn').className = state.tab === 'pending' ? 'tab-active' : 'tab';
    document.getElementById('tabDeliveredBtn').className = state.tab === 'delivered' ? 'tab-active' : 'tab';

    var popBar = document.getElementById('popularBar');
    if (state.tab === 'pending' && state.popular.length) {
      popBar.style.display = '';
      popBar.innerHTML = '<span class="popular-label">⭐ Popular today</span>'
        + state.popular.map(function (p) { return '<span class="popular-chip">' + esc(p.name) + ' <b>×' + p.qty + '</b></span>'; }).join('');
    } else {
      popBar.style.display = 'none';
    }

    var gridEl = document.getElementById('ordersGrid');
    if (!filtered.length) {
      gridEl.innerHTML = '<p class="muted">' + (state.tab === 'pending' ? 'No pending orders.' : 'Nothing delivered yet.') + '</p>';
    } else {
      gridEl.innerHTML = filtered.map(function (o) {
        var isOldest = oldest && o.id === oldest.id;
        var items = Array.isArray(o.orders) ? o.orders : [];
        var itemsHtml = items.map(function (it) {
          return '<div class="item-row"><span>' + it.qty + '× ' + esc(it.name) + '</span><span>৳' + (Number(it.price) * Number(it.qty)).toFixed(2) + '</span></div>';
        }).join('');
        var time = new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        var actionsHtml = state.tab === 'pending'
          ? '<div class="actions"><button type="button" class="ghost-btn modify-btn" data-id="' + esc(o.id) + '">Modify</button>'
            + '<button type="button" class="deliver-btn deliver-btn-x" data-id="' + esc(o.id) + '" ' + (state.busyId === o.id ? 'disabled' : '') + '>' + (state.busyId === o.id ? '…' : '✔ Ready') + '</button></div>'
          : '<div class="actions"><button type="button" class="ghost-btn return-btn" data-id="' + esc(o.id) + '">Refund</button><span class="delivered-tag">Delivered</span></div>';
        return '<div class="card' + (isOldest ? ' card-oldest' : '') + '" style="border-left:' + (isOldest ? 6 : 4) + 'px solid ' + (state.tab === 'pending' ? 'var(--accent)' : 'var(--ok)') + '">'
          + (isOldest ? '<span class="next-tag">NEXT UP</span>' : '')
          + '<div class="card-head"><span class="invoice">#' + esc(o.invoice_number) + '</span><span>' + time + '</span></div>'
          + '<p class="student-name">' + esc(o.student_name) + '</p>'
          + '<p class="student-meta">' + esc(o.class_section_roll) + ' · ' + (o.delivery_option === 'class' ? '🏫 Class' : '✋ Hand') + ' · counter ' + (o.counter_no != null ? o.counter_no : 1) + '</p>'
          + '<div class="items">' + itemsHtml + '</div>'
          + '<div class="card-foot"><span class="total">৳' + Number(o.price).toFixed(2) + '</span>' + actionsHtml + '</div>'
          + '</div>';
      }).join('');
      Array.prototype.forEach.call(gridEl.querySelectorAll('.deliver-btn-x'), function (btn) {
        btn.addEventListener('click', function () { markDelivered(Number(btn.getAttribute('data-id'))); });
      });
      Array.prototype.forEach.call(gridEl.querySelectorAll('.modify-btn'), function (btn) {
        btn.addEventListener('click', function () {
          var o = state.orders.find(function (x) { return String(x.id) === btn.getAttribute('data-id'); });
          if (o) openDialog('modify', o);
        });
      });
      Array.prototype.forEach.call(gridEl.querySelectorAll('.return-btn'), function (btn) {
        btn.addEventListener('click', function () {
          var o = state.orders.find(function (x) { return String(x.id) === btn.getAttribute('data-id'); });
          if (o) openDialog('return', o);
        });
      });
    }
  }

  document.getElementById('myCounterBtn').addEventListener('click', function () { state.myCounterOnly = !state.myCounterOnly; renderMain(); load(); });
  document.getElementById('counterOpenBtn').addEventListener('click', function () {
    var next = !state.counterOpen;
    state.counterOpen = next;
    if (next) {
      sendHeartbeat(true);
      heartbeatTimer = setInterval(function () { sendHeartbeat(true); }, COUNTER_HEARTBEAT_MS);
    } else {
      sendHeartbeat(false);
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }
    renderMain();
  });
  document.getElementById('tabPendingBtn').addEventListener('click', function () { state.tab = 'pending'; load(); loadPopular(); renderMain(); });
  document.getElementById('tabDeliveredBtn').addEventListener('click', function () { state.tab = 'delivered'; state.popular = []; load(); renderMain(); });
  document.getElementById('searchInput').addEventListener('input', function (e) { state.query = e.target.value; renderMain(); });

  render();
})();
</script>
</body></html>`;

export async function GET() {
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
