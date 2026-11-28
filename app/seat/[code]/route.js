export const dynamic = 'force-dynamic';

export async function GET(req, context) {
  const params = await context.params;
  const code = decodeURIComponent(String((params && params.code) || '')).trim();
  const { searchParams } = new URL(req.url);
  const circularParam = parseInt(searchParams.get('c') || '', 10) || 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=2">
  <title>3D Seat Finder — CCPC Exam Hall Guide</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f8fafc; min-height: 100vh; overflow-x: hidden; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 14px 12px 40px; }
    .hero { background: linear-gradient(135deg,#0f172a 0%,#1e3a8a 60%,#0f766e 100%); border: 1px solid rgba(255,255,255,0.14); border-radius: 22px; padding: 18px 20px; margin-bottom: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
    .hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .college { font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #93c5fd; }
    .sname { font-size: 21px; font-weight: 900; color: #fff; margin: 4px 0 2px; }
    .smeta { font-size: 12px; color: #cbd5e1; font-weight: 600; }
    .seat-badges { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
    .sbadge { background: rgba(255,255,255,0.1); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.16); border-radius: 14px; padding: 10px 12px; }
    .sbadge .k { font-size: 9px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: #93c5fd; }
    .sbadge .v { font-size: 16px; font-weight: 900; color: #fff; margin-top: 2px; }
    .sbadge.hi { background: linear-gradient(135deg,rgba(16,185,129,0.28),rgba(5,150,105,0.4)); border-color: #34d399; }
    .tabs { display: flex; gap: 8px; margin-bottom: 14px; background: #111827; padding: 5px; border-radius: 16px; border: 1px solid #1e293b; }
    .tab-btn { flex: 1; padding: 11px 10px; border-radius: 12px; border: none; background: transparent; color: #94a3b8; font-size: 12px; font-weight: 900; cursor: pointer; transition: all 0.2s; }
    .tab-btn.active { background: linear-gradient(135deg,#2563eb,#1d4ed8); color: #fff; box-shadow: 0 6px 18px rgba(37,99,235,0.4); }
    .panel { background: #111827; border: 1px solid #1e293b; border-radius: 22px; padding: 16px; margin-bottom: 14px; }
    .hidden { display: none !important; }

    /* Interactive 3D Viewport */
    .stage-bar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .pill-btn { padding: 7px 12px; border-radius: 10px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 11px; font-weight: 800; cursor: pointer; }
    .pill-btn.on, .pill-btn:hover { background: #2563eb; border-color: #3b82f6; color: #fff; }
    .pill-btn.play { background: linear-gradient(135deg,#10b981,#059669); border-color: #34d399; color: #fff; }

    .scene-3d { position: relative; width: 100%; min-height: 430px; background: radial-gradient(circle at 50% 35%, #1e293b 0%, #0f172a 75%); border-radius: 18px; border: 1px solid #1e293b; overflow: hidden; display: flex; align-items: center; justify-content: center; perspective: 1150px; touch-action: none; user-select: none; cursor: grab; }
    .scene-3d:active { cursor: grabbing; }
    .drag-tip { position: absolute; bottom: 10px; right: 12px; font-size: 10px; font-weight: 700; color: #94a3b8; background: rgba(15,23,42,0.8); padding: 4px 10px; border-radius: 999px; pointer-events: none; border: 1px solid #334155; }

    /* 3D Campus Wayfinding Map */
    .campus-world { position: relative; width: 640px; height: 390px; transform-style: preserve-3d; transition: transform 0.35s ease-out; }
    .campus-ground { position: absolute; inset: 0; background: linear-gradient(135deg,#132032,#0f172a); border: 2px solid #334155; border-radius: 20px; box-shadow: 0 30px 60px rgba(0,0,0,0.65); }
    .road-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .bldg-3d { position: absolute; transform-style: preserve-3d; transition: all 0.35s; }
    .bldg-top { width: 100%; height: 100%; border-radius: 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 900; font-size: 12px; border: 2px solid #475569; background: #1e293b; color: #cbd5e1; box-shadow: 0 10px 25px rgba(0,0,0,0.45); transform: translateZ(34px); position: relative; }
    .bldg-3d.target .bldg-top { background: linear-gradient(135deg,#059669,#10b981); border-color: #6ee7b7; color: #fff; transform: translateZ(56px); box-shadow: 0 0 30px rgba(16,185,129,0.65); }
    .bldg-side-front { position: absolute; left: 0; right: 0; bottom: 0; height: 34px; background: #0f172a; border: 1px solid #334155; transform-origin: bottom; transform: rotateX(-90deg); }
    .bldg-3d.target .bldg-side-front { height: 56px; background: linear-gradient(180deg,#047857,#064e3b); border-color: #34d399; }
    .bldg-tag { position: absolute; top: -28px; left: 50%; transform: translateX(-50%) translateZ(70px); background: #f59e0b; color: #0f172a; font-size: 10px; font-weight: 900; padding: 3px 10px; border-radius: 999px; white-space: nowrap; box-shadow: 0 6px 16px rgba(245,158,11,0.5); animation: bob 1.6s ease-in-out infinite; }
    .gate-node { position: absolute; left: 26px; bottom: 26px; background: #2563eb; border: 2px solid #93c5fd; color: #fff; font-size: 11px; font-weight: 900; padding: 6px 12px; border-radius: 10px; transform: translateZ(14px); box-shadow: 0 8px 20px rgba(37,99,235,0.5); }

    /* Step Cards */
    .steps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 8px; margin-top: 12px; }
    .step-card { background: #1e293b; border: 1.5px solid #334155; border-radius: 14px; padding: 10px 12px; cursor: pointer; transition: all 0.2s; }
    .step-card.active { background: rgba(16,185,129,0.16); border-color: #34d399; }
    .step-num { font-size: 9px; font-weight: 900; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.7px; }
    .step-card.active .step-num { color: #34d399; }
    .step-txt { font-size: 12px; font-weight: 800; color: #f1f5f9; margin-top: 3px; line-height: 1.35; }

    /* 3D Classroom Stage */
    .room-world { position: relative; transform-style: preserve-3d; transition: transform 0.25s ease-out; padding: 28px 30px; background: linear-gradient(145deg,#f8fafc,#e2e8f0); border: 4px solid #334155; border-radius: 18px; box-shadow: 0 32px 65px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.7); color: #0f172a; }
    .room-cols { display: flex; align-items: flex-start; gap: 10px; position: relative; z-index: 2; }
    .room-col { display: flex; flex-direction: column; gap: 8px; min-width: 72px; }
    .col-hdr { text-align: center; font-size: 10px; font-weight: 900; color: #475569; background: #e2e8f0; border-radius: 6px; padding: 3px 6px; }
    .aisle-gap { width: 22px; align-self: stretch; display: flex; align-items: center; justify-content: center; }
    .aisle-line { height: 100%; border-left: 2px dashed #94a3b8; }
    .desk { height: 42px; min-width: 72px; border-radius: 8px; background: #fff; border: 1.5px solid #cbd5e1; border-bottom: 4px solid #94a3b8; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; color: #64748b; position: relative; transform: translateZ(10px); transition: all 0.25s; }
    .desk.disabled { background: repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 4px,#f1f5f9 4px,#f1f5f9 8px); border-style: dashed; border-bottom-width: 1.5px; color: #94a3b8; transform: translateZ(1px); }
    .desk.mine { background: linear-gradient(135deg,#10b981,#059669); border-color: #6ee7b7; border-bottom: 6px solid #065f46; color: #fff; transform: translateZ(26px) scale(1.06); box-shadow: 0 0 26px rgba(16,185,129,0.85); z-index: 5; }
    .you-pin { position: absolute; top: -32px; left: 50%; transform: translateX(-50%) translateZ(18px); background: #f59e0b; color: #0f172a; font-size: 10px; font-weight: 900; padding: 3px 9px; border-radius: 999px; white-space: nowrap; box-shadow: 0 6px 14px rgba(245,158,11,0.55); animation: bob 1.4s ease-in-out infinite; }
    .fx-badge { position: absolute; padding: 3px 9px; border-radius: 7px; font-size: 10px; font-weight: 900; white-space: nowrap; z-index: 4; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
    .room-path-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; }

    @keyframes bob { 0%,100%{ transform: translateX(-50%) translateY(0px) translateZ(18px); } 50%{ transform: translateX(-50%) translateY(-6px) translateZ(18px); } }
    @keyframes dashMove { to { stroke-dashoffset: -40; } }
    .anim-route { stroke-dasharray: 10 8; animation: dashMove 1.1s linear infinite; }

    .err-box { background: #1e293b; border: 1px solid #ef4444; border-radius: 20px; padding: 32px 20px; text-align: center; }
    .err-box h2 { color: #fca5a5; margin-bottom: 8px; }
    .search-mini { display: flex; gap: 8px; max-width: 360px; margin: 16px auto 0; }
    .search-mini input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #fff; font-weight: 700; }
    .search-mini button { padding: 10px 16px; border-radius: 10px; border: none; background: #2563eb; color: #fff; font-weight: 900; cursor: pointer; }

    @media (max-width: 640px) {
      .seat-badges { grid-template-columns: 1fr; }
      .scene-3d { min-height: 360px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="appRoot">
      <div class="panel" style="text-align:center;padding:48px 20px;color:#94a3b8;font-weight:800">Loading your 3D Exam Hall &amp; Seat Map…</div>
    </div>
  </div>
  <script>
    const CODE = ${JSON.stringify(code)};
    const CIRC = ${JSON.stringify(circularParam)};
    const FX_STYLE = {
      door:   { icon:'🚪', bg:'#fef3c7', bd:'#d97706', fg:'#92400e' },
      window: { icon:'🪟', bg:'#e0f2fe', bd:'#0284c7', fg:'#075985' },
      board:  { icon:'📋', bg:'#0f172a', bd:'#0f172a', fg:'#ffffff' },
      desk:   { icon:'🧑‍🏫', bg:'#e2e8f0', bd:'#475569', fg:'#0f172a' },
      pillar: { icon:'🏛', bg:'#fce7f3', bd:'#db2777', fg:'#9d174d' },
    };
    let DATA = null;
    let TAB = 'way';
    let CAM = { rx: 46, rz: -14, scale: 0.92 };
    let CAMPUS_CAM = { rx: 52, rz: -24, scale: 0.86 };
    let WALK_TIMER = null;
    let ACTIVE_STEP = 0;

    function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function getSlots(layout){
      const cols = layout.columns || [];
      const dis = new Set(layout.disabled || []);
      const order = layout.fill_order || 'col_tb';
      const maxR = cols.reduce((m,c)=>Math.max(m, parseInt(c.rows,10)||0), 0);
      const slots = [];
      const push = (c,r) => { if (r >= (parseInt(cols[c]?.rows,10)||0) || dis.has(c+':'+r)) return; slots.push({ seatNo: slots.length+1, col: c, row: r }); };
      if (order === 'col_tb') { for (let c=0;c<cols.length;c++) for (let r=0;r<(cols[c].rows||0);r++) push(c,r); }
      else if (order === 'col_snake') { for (let c=0;c<cols.length;c++) { const l=cols[c].rows||0; if (c%2===0) for(let r=0;r<l;r++) push(c,r); else for(let r=l-1;r>=0;r--) push(c,r); } }
      else if (order === 'row_lr') { for (let r=0;r<maxR;r++) for (let c=0;c<cols.length;c++) push(c,r); }
      else if (order === 'row_snake') { for (let r=0;r<maxR;r++) { if (r%2===0) for(let c=0;c<cols.length;c++) push(c,r); else for(let c=cols.length-1;c>=0;c--) push(c,r); } }
      return slots;
    }

    async function load() {
      try {
        const url = '/api/seat-finder?code=' + encodeURIComponent(CODE) + (CIRC ? '&c=' + CIRC : '');
        const res = await fetch(url);
        const json = await res.json();
        if (!res.ok || json.error) {
          document.getElementById('appRoot').innerHTML = '<div class="err-box"><h2>Seat Not Found</h2><p style="color:#cbd5e1;font-size:13px">' + esc(json.error || 'Invalid ID') + '</p><form class="search-mini" onsubmit="event.preventDefault();var v=this.q.value.trim();if(v)location.href=\\'/seat/\\'+encodeURIComponent(v);"><input name="q" placeholder="Try Index ID or Tracking ID" value="' + esc(CODE) + '"><button type="submit">Find</button></form></div>';
          return;
        }
        DATA = json;
        render();
      } catch (e) {
        document.getElementById('appRoot').innerHTML = '<div class="err-box"><h2>Connection Error</h2><p style="color:#cbd5e1">Please refresh the page.</p></div>';
      }
    }

    function setTab(t) {
      TAB = t;
      render();
      if (t === 'room') setTimeout(drawRoomPath, 60);
    }

    function setCamPreset(kind) {
      if (TAB === 'room') {
        if (kind === 'iso') CAM = { rx: 46, rz: -14, scale: 0.92 };
        else if (kind === 'front') CAM = { rx: 60, rz: 0, scale: 0.94 };
        else if (kind === 'top') CAM = { rx: 0, rz: 0, scale: 0.96 };
        applyTransform();
      } else {
        if (kind === 'iso') CAMPUS_CAM = { rx: 52, rz: -24, scale: 0.86 };
        else if (kind === 'front') CAMPUS_CAM = { rx: 62, rz: 0, scale: 0.9 };
        else if (kind === 'top') CAMPUS_CAM = { rx: 0, rz: 0, scale: 0.92 };
        applyTransform();
      }
    }

    function zoomCam(delta) {
      const target = TAB === 'room' ? CAM : CAMPUS_CAM;
      target.scale = Math.max(0.45, Math.min(1.5, target.scale + delta));
      applyTransform();
    }

    function applyTransform() {
      const rw = document.getElementById('roomWorld3D');
      if (rw) rw.style.transform = 'scale(' + CAM.scale + ') rotateX(' + CAM.rx + 'deg) rotateZ(' + CAM.rz + 'deg)';
      const cw = document.getElementById('campusWorld3D');
      if (cw) cw.style.transform = 'scale(' + CAMPUS_CAM.scale + ') rotateX(' + CAMPUS_CAM.rx + 'deg) rotateZ(' + CAMPUS_CAM.rz + 'deg)';
    }

    function wireDrag(elId, isRoom) {
      const el = document.getElementById(elId);
      if (!el) return;
      let dragging = false, sx = 0, sy = 0;
      const down = (x, y) => { dragging = true; sx = x; sy = y; };
      const move = (x, y) => {
        if (!dragging) return;
        const dx = x - sx, dy = y - sy;
        sx = x; sy = y;
        const c = isRoom ? CAM : CAMPUS_CAM;
        c.rz = Math.max(-70, Math.min(70, c.rz + dx * 0.35));
        c.rx = Math.max(0, Math.min(72, c.rx - dy * 0.35));
        applyTransform();
      };
      const up = () => { dragging = false; };
      el.onmousedown = e => down(e.clientX, e.clientY);
      window.onmousemove = e => move(e.clientX, e.clientY);
      window.onmouseup = up;
      el.ontouchstart = e => { if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY); };
      el.ontouchmove = e => { if (e.touches.length === 1) { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); } };
      el.ontouchend = up;
    }

    function highlightStep(idx) {
      ACTIVE_STEP = idx;
      document.querySelectorAll('.step-card').forEach((c, i) => c.classList.toggle('active', i === idx));
      if (idx === 4 && TAB !== 'room') { setTab('room'); }
    }

    function playGuidedWalk() {
      if (WALK_TIMER) { clearInterval(WALK_TIMER); WALK_TIMER = null; }
      TAB = 'way';
      ACTIVE_STEP = 0;
      render();
      let step = 0;
      WALK_TIMER = setInterval(() => {
        step++;
        if (step <= 3) {
          ACTIVE_STEP = step;
          document.querySelectorAll('.step-card').forEach((c, i) => c.classList.toggle('active', i === step));
        } else if (step === 4) {
          ACTIVE_STEP = 4;
          TAB = 'room';
          render();
          setTimeout(drawRoomPath, 80);
          clearInterval(WALK_TIMER);
          WALK_TIMER = null;
        }
      }, 1500);
    }

    function drawRoomPath() {
      const world = document.getElementById('roomWorld3D');
      const svg = document.getElementById('roomPathSvg');
      const myDesk = document.getElementById('myDeskCard');
      const doorEl = document.querySelector('.fx-door-anchor');
      if (!world || !svg || !myDesk) return;
      const wRect = world.getBoundingClientRect();
      // Compute coordinates in untransformed space using offsetLeft/offsetTop traversal
      const relCenter = (node) => {
        let x = node.offsetWidth / 2, y = node.offsetHeight / 2, cur = node;
        while (cur && cur !== world) { x += cur.offsetLeft; y += cur.offsetTop; cur = cur.offsetParent; }
        return { x, y };
      };
      const target = relCenter(myDesk);
      const start = doorEl ? relCenter(doorEl) : { x: 24, y: 40 };
      // L-shaped clean hallway path along the front/aisle then straight to the seat
      const midX = start.x < world.offsetWidth / 2 ? Math.min(start.x + 32, target.x) : Math.max(start.x - 32, target.x);
      const d = 'M ' + start.x + ' ' + start.y + ' L ' + target.x + ' ' + start.y + ' L ' + target.x + ' ' + target.y;
      svg.setAttribute('viewBox', '0 0 ' + world.offsetWidth + ' ' + world.offsetHeight);
      svg.innerHTML =
        '<path d="' + d + '" fill="none" stroke="rgba(16,185,129,0.28)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="' + d + '" fill="none" stroke="#10b981" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" class="anim-route"/>' +
        '<circle cx="' + start.x + '" cy="' + start.y + '" r="6" fill="#f59e0b" stroke="#fff" stroke-width="2"/>' +
        '<circle cx="' + target.x + '" cy="' + target.y + '" r="7" fill="#10b981" stroke="#fff" stroke-width="2"/>';
    }

    function renderCampusHtml() {
      const s = DATA.seat;
      const code = (s.building_code || 'SB').toUpperCase();
      // Campus block positions (in 640x390 3D ground plane)
      const bldgs = [
        { code: 'MB', name: 'Main Building (MB)', x: 220, y: 245, w: 185, h: 74, cx: 312, cy: 282 },
        { code: 'SB', name: 'School Building (SB)', x: 85, y: 78, w: 195, h: 86, cx: 182, cy: 121 },
        { code: 'CB', name: 'College Building (CB)', x: 355, y: 75, w: 195, h: 86, cx: 452, cy: 118 },
        { code: 'JB', name: 'Junior Block (JB)', x: 455, y: 235, w: 145, h: 76, cx: 527, cy: 273 },
        { code: 'HB', name: 'Honors Building (HB)', x: 255, y: 18, w: 130, h: 48, cx: 320, cy: 42 },
      ];
      const tgt = bldgs.find(b => b.code === code) || bldgs[1];
      const routeD = 'M 75 340 L 180 340 L 180 205 L ' + tgt.cx + ' 205 L ' + tgt.cx + ' ' + tgt.cy;

      const bHtml = bldgs.map(b => {
        const isT = b.code === tgt.code;
        return '<div class="bldg-3d' + (isT ? ' target' : '') + '" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px">' +
          '<div class="bldg-side-front"></div>' +
          '<div class="bldg-top">' +
            (isT ? '<div class="bldg-tag">📍 ' + esc(s.room_name) + ' · ' + esc(s.floor_label) + '</div>' : '') +
            '<div>' + esc(b.code) + '</div>' +
            '<div style="font-size:9px;opacity:0.85;font-weight:700">' + esc(b.name.replace(/\\s*\\([^)]*\\)/, '')) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      const steps = [
        { n: 'Step 1 · Entry', t: 'Enter through CCPC Main Gate with your Admit Card.' },
        { n: 'Step 2 · Building', t: 'Walk along the main path to ' + s.building + ' (' + s.building_code + ').' },
        { n: 'Step 3 · Floor', t: 'Take the stairs to ' + s.floor_label + '.' },
        { n: 'Step 4 · Exam Hall', t: 'Locate Room ' + s.room_name + ' and enter through the door.' },
        { n: 'Step 5 · Your Desk', t: 'Go to ' + (s.col_label || 'your column') + (s.row_number ? ', Row ' + s.row_number : '') + ' — Seat #' + s.seat_no + '.' },
      ];

      return '<div class="panel">' +
        '<div class="stage-bar">' +
          '<div style="font-size:13px;font-weight:900;color:#e2e8f0">🧭 3D Wayfinding to ' + esc(s.building) + ' — Room ' + esc(s.room_name) + '</div>' +
          '<div class="btn-row">' +
            '<button class="pill-btn play" onclick="playGuidedWalk()">▶ Play Guided Walk</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'iso\\')">3D View</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'top\\')">2D Top</button>' +
            '<button class="pill-btn" onclick="zoomCam(0.12)">+</button>' +
            '<button class="pill-btn" onclick="zoomCam(-0.12)">−</button>' +
          '</div>' +
        '</div>' +
        '<div id="campusScene" class="scene-3d">' +
          '<div id="campusWorld3D" class="campus-world">' +
            '<div class="campus-ground"></div>' +
            '<svg class="road-svg" viewBox="0 0 640 390">' +
              '<path d="' + routeD + '" fill="none" stroke="rgba(16,185,129,0.25)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<path d="' + routeD + '" fill="none" stroke="#34d399" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" class="anim-route"/>' +
              '<circle cx="' + tgt.cx + '" cy="' + tgt.cy + '" r="9" fill="#f59e0b" stroke="#fff" stroke-width="2.5"/>' +
            '</svg>' +
            '<div class="gate-node">🏫 MAIN GATE</div>' +
            bHtml +
          '</div>' +
          '<div class="drag-tip">👆 Drag to rotate 3D campus map</div>' +
        '</div>' +
        '<div class="steps-grid">' +
          steps.map((st, i) => '<div class="step-card' + (ACTIVE_STEP === i ? ' active' : '') + '" onclick="highlightStep(' + i + ')"><div class="step-num">' + esc(st.n) + '</div><div class="step-txt">' + esc(st.t) + '</div></div>').join('') +
        '</div>' +
      '</div>';
    }

    function renderRoom3dHtml() {
      const s = DATA.seat;
      const lay = DATA.room_layout || { columns: [], disabled: [], fixtures: [] };
      const slots = getSlots(lay);
      const dis = new Set(lay.disabled || []);
      const numByCR = {};
      slots.forEach(sl => { numByCR[sl.col + ':' + sl.row] = sl.seatNo; });
      const cols = lay.columns || [];
      const maxR = cols.reduce((m, c) => Math.max(m, parseInt(c.rows, 10) || 0), 0);

      const colsHtml = cols.map((col, ci) => {
        const cr = parseInt(col.rows, 10) || 0;
        let desks = '';
        for (let r = 0; r < maxR; r++) {
          if (r >= cr) { desks += '<div style="height:42px"></div>'; continue; }
          const k = ci + ':' + r;
          if (dis.has(k)) { desks += '<div class="desk disabled">—</div>'; continue; }
          const sn = numByCR[k] || '';
          const isMine = sn === s.seat_no;
          desks += '<div ' + (isMine ? 'id="myDeskCard" ' : '') + 'class="desk' + (isMine ? ' mine' : '') + '">' +
            (isMine ? '<div class="you-pin">📍 YOUR SEAT #' + sn + '</div>' : '') +
            '<div>Seat #' + sn + '</div>' +
            (isMine ? '<div style="font-size:8px;opacity:0.9">Row ' + (r + 1) + '</div>' : '') +
          '</div>';
        }
        const aisle = (col.aisle_after && ci < cols.length - 1) ? '<div class="aisle-gap"><div class="aisle-line"></div></div>' : '';
        return '<div class="room-col"><div class="col-hdr">' + esc(col.label || ('Col ' + (ci + 1))) + '</div>' + desks + '</div>' + aisle;
      }).join('');

      let hasDoor = false;
      const fxHtml = (lay.fixtures || []).map(f => {
        const st = FX_STYLE[f.type] || FX_STYLE.door;
        const pos = Math.max(8, Math.min(92, parseInt(f.pos, 10) || 50));
        let posCss = '';
        if (f.wall === 'top') posCss = 'top:4px;left:' + pos + '%;transform:translateX(-50%) translateZ(16px);';
        else if (f.wall === 'bottom') posCss = 'bottom:4px;left:' + pos + '%;transform:translateX(-50%) translateZ(16px);';
        else if (f.wall === 'left') posCss = 'left:4px;top:' + pos + '%;transform:translateY(-50%) translateZ(16px);';
        else posCss = 'right:4px;top:' + pos + '%;transform:translateY(-50%) translateZ(16px);';
        const isFirstDoor = f.type === 'door' && !hasDoor;
        if (isFirstDoor) hasDoor = true;
        return '<div class="fx-badge' + (isFirstDoor ? ' fx-door-anchor' : '') + '" style="' + posCss + 'background:' + st.bg + ';border:1.5px solid ' + st.bd + ';color:' + st.fg + '">' + st.icon + ' ' + esc(f.label || f.type) + '</div>';
      }).join('');

      return '<div class="panel">' +
        '<div class="stage-bar">' +
          '<div style="font-size:13px;font-weight:900;color:#e2e8f0">🪑 Interactive 3D Classroom — Room ' + esc(s.room_name) + '</div>' +
          '<div class="btn-row">' +
            '<button class="pill-btn" onclick="setCamPreset(\\'iso\\')">3D Isometric</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'front\\')">Front Angle</button>' +
            '<button class="pill-btn" onclick="setCamPreset(\\'top\\')">2D Top-Down</button>' +
            '<button class="pill-btn" onclick="zoomCam(0.12)">+</button>' +
            '<button class="pill-btn" onclick="zoomCam(-0.12)">−</button>' +
          '</div>' +
        '</div>' +
        '<div id="roomScene" class="scene-3d" style="min-height:460px">' +
          '<div id="roomWorld3D" class="room-world">' +
            fxHtml +
            '<svg id="roomPathSvg" class="room-path-svg"></svg>' +
            '<div class="room-cols">' + colsHtml + '</div>' +
          '</div>' +
          '<div class="drag-tip">👆 Drag to rotate 3D classroom · Green glowing path = Door to your Seat</div>' +
        '</div>' +
      '</div>';
    }

    function render() {
      const st = DATA.student, ex = DATA.exam, s = DATA.seat;
      const examLine = [ex.session_name, ex.circular_name, ex.schedule_name].filter(Boolean).join(' · ');
      const dateLine = [ex.exam_date ? '📅 ' + ex.exam_date : '', ex.exam_time ? '🕒 ' + ex.exam_time : ''].filter(Boolean).join('   ');

      let body = '';
      if (!s.assigned) {
        body = '<div class="panel" style="text-align:center;padding:34px 20px"><h3 style="color:#fbbf24;margin-bottom:6px">Seat Not Assigned Yet</h3><p style="color:#94a3b8;font-size:13px">Your application is confirmed, and your exam room &amp; seat number will appear here as soon as the seat plan is published.</p></div>';
      } else {
        body =
          '<div class="tabs">' +
            '<button class="tab-btn' + (TAB === 'way' ? ' active' : '') + '" onclick="setTab(\\'way\\')">🧭 3D Way to Exam Hall</button>' +
            '<button class="tab-btn' + (TAB === 'room' ? ' active' : '') + '" onclick="setTab(\\'room\\')">🪑 3D Classroom &amp; My Seat</button>' +
          '</div>' +
          (TAB === 'way' ? renderCampusHtml() : renderRoom3dHtml());
      }

      document.getElementById('appRoot').innerHTML =
        '<div class="hero">' +
          '<div class="hero-top">' +
            '<div>' +
              '<div class="college">Chattogram Cantonment Public College · ' + esc(examLine) + '</div>' +
              '<div class="sname">' + esc(st.name) + '</div>' +
              '<div class="smeta">' + esc([st.class, st.version, st.category].filter(Boolean).join(' · ')) + (st.index_id ? ' &nbsp;|&nbsp; Index: <b>' + esc(st.index_id) + '</b>' : '') + (st.tracking_id ? ' &nbsp;|&nbsp; ID: ' + esc(st.tracking_id) : '') + '</div>' +
              (dateLine ? '<div class="smeta" style="margin-top:4px;color:#fde68a">' + esc(dateLine) + '</div>' : '') +
            '</div>' +
          '</div>' +
          (s.assigned ? (
            '<div class="seat-badges">' +
              '<div class="sbadge"><div class="k">Building &amp; Floor</div><div class="v">' + esc(s.building) + '</div><div style="font-size:11px;color:#cbd5e1;font-weight:700">' + esc(s.floor_label) + '</div></div>' +
              '<div class="sbadge"><div class="k">Exam Room</div><div class="v">Room ' + esc(s.room_name) + '</div><div style="font-size:11px;color:#cbd5e1;font-weight:700">' + esc(s.total_desks) + ' seats in hall</div></div>' +
              '<div class="sbadge hi"><div class="k">Your Exact Seat</div><div class="v">Seat #' + esc(s.seat_no) + '</div><div style="font-size:11px;color:#d1fae5;font-weight:700">' + esc([s.col_label, s.row_number ? 'Row ' + s.row_number : ''].filter(Boolean).join(' · ')) + '</div></div>' +
            '</div>'
          ) : '') +
        '</div>' +
        body;

      applyTransform();
      if (TAB === 'way') wireDrag('campusScene', false);
      else { wireDrag('roomScene', true); setTimeout(drawRoomPath, 60); }
    }

    load();
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
