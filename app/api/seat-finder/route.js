import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const BUILDING_PREFIXES = {
  SB: 'School Building',
  MB: 'Main Building',
  CB: 'College Building',
  JB: 'Junior Block',
  HB: 'Honors Building',
};

async function sbAdmission(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Accept-Profile': 'admission',
    },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function sbInventory(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Accept-Profile': 'inventory',
    },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function parseRoomMeta(roomName, explicitBuilding) {
  const rn = String(roomName || '').trim();
  const pm = /^([A-Za-z]{2,4})[-_\s]/.exec(rn);
  const code = pm ? pm[1].toUpperCase() : 'MAIN';
  const building = explicitBuilding || BUILDING_PREFIXES[code] || (code === 'MAIN' ? 'Main Campus' : code);
  const nm = /(\d{3,4})/.exec(rn);
  let floorNum = 1;
  let floorLabel = 'Ground / 1st Floor';
  if (nm) {
    const num = parseInt(nm[1], 10);
    floorNum = Math.floor(num / 100);
    if (floorNum <= 0) { floorNum = 0; floorLabel = 'Ground Floor'; }
    else if (floorNum === 1) floorLabel = '1st Floor';
    else if (floorNum === 2) floorLabel = '2nd Floor';
    else if (floorNum === 3) floorLabel = '3rd Floor';
    else floorLabel = `${floorNum}th Floor`;
  }
  return { code, building, floorNum, floorLabel };
}

function defaultLayout(capacity) {
  const cap = Math.max(1, parseInt(capacity, 10) || 30);
  const numCols = cap <= 24 ? 3 : (cap <= 42 ? 4 : (cap <= 60 ? 5 : 6));
  const base = Math.floor(cap / numCols);
  const extra = cap % numCols;
  const columns = [];
  for (let c = 0; c < numCols; c++) {
    const aisleAfter = (numCols === 4 && c === 1) || (numCols === 5 && (c === 1 || c === 3)) || (numCols === 6 && (c === 1 || c === 3));
    columns.push({ label: `Col ${c + 1}`, rows: Math.max(1, base + (c < extra ? 1 : 0)), aisle_after: aisleAfter });
  }
  return {
    columns,
    disabled: [],
    fill_order: 'col_tb',
    fixtures: [
      { id: 'fx_board', type: 'board', wall: 'top', pos: 45, label: 'Whiteboard / Front' },
      { id: 'fx_desk', type: 'desk', wall: 'top', pos: 84, label: "Teacher's Desk" },
      { id: 'fx_door', type: 'door', wall: 'left', pos: 14, label: 'Main Door' },
    ],
  };
}

function getLayoutSlots(layout) {
  const cols = layout.columns || [];
  const dis = new Set(layout.disabled || []);
  const order = layout.fill_order || 'col_tb';
  const maxRows = cols.reduce((m, c) => Math.max(m, parseInt(c.rows, 10) || 0), 0);
  const slots = [];
  const push = (c, r) => {
    if (r >= (parseInt(cols[c]?.rows, 10) || 0)) return;
    if (dis.has(`${c}:${r}`)) return;
    slots.push({ slotIdx: slots.length, seatNo: slots.length + 1, col: c, row: r });
  };
  if (order === 'col_tb') {
    for (let c = 0; c < cols.length; c++) for (let r = 0; r < (cols[c].rows || 0); r++) push(c, r);
  } else if (order === 'col_snake') {
    for (let c = 0; c < cols.length; c++) {
      const len = cols[c].rows || 0;
      if (c % 2 === 0) for (let r = 0; r < len; r++) push(c, r);
      else for (let r = len - 1; r >= 0; r--) push(c, r);
    }
  } else if (order === 'row_lr') {
    for (let r = 0; r < maxRows; r++) for (let c = 0; c < cols.length; c++) push(c, r);
  } else if (order === 'row_snake') {
    for (let r = 0; r < maxRows; r++) {
      if (r % 2 === 0) for (let c = 0; c < cols.length; c++) push(c, r);
      else for (let c = cols.length - 1; c >= 0; c--) push(c, r);
    }
  }
  return slots;
}

function adaptLayoutToSeats(baseLayout, targetSeats) {
  const n = Math.max(1, parseInt(targetSeats, 10) || 1);
  const lay = JSON.parse(JSON.stringify(baseLayout || defaultLayout(n)));
  if (!Array.isArray(lay.columns) || !lay.columns.length) return defaultLayout(n);
  if (getLayoutSlots(lay).length >= n) return lay;
  const cols = lay.columns;
  const C = cols.length;
  const origRows = cols.map(c => Math.max(0, parseInt(c.rows, 10) || 0));
  const origSum = origRows.reduce((a, b) => a + b, 0);
  const weights = origSum > 0 ? origRows.map(v => v / origSum) : cols.map(() => 1 / C);
  const raw = weights.map(w => w * n);
  const alloc = raw.map(v => Math.floor(v));
  const rem = n - alloc.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < rem; k++) alloc[order[k % C].i]++;
  cols.forEach((col, ci) => { col.rows = Math.max(1, alloc[ci]); });
  lay.disabled = [];
  return lay;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = String(searchParams.get('code') || '').trim();
  const circularParam = parseInt(searchParams.get('c') || '', 10) || 0;
  if (!code) return NextResponse.json({ error: 'Enter your Index ID or Tracking ID.' }, { status: 400 });

  const enc = encodeURIComponent(code);
  const sel = 'id,circular_id,token,tracking_id,index_id,external_key,name_english,name_bangla,father_name,mother_name,class,version,category,room_id,room_no,seat_no';
  let q = `admission_applications?select=${sel}&or=(index_id.eq.${enc},token.eq.${enc},tracking_id.eq.${enc},external_key.eq.${enc})&order=id.desc&limit=5`;
  if (circularParam) q += `&circular_id=eq.${circularParam}`;

  const rows = await sbAdmission(q);
  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: 'No applicant found with that ID. Please check your Index ID or Tracking ID.' }, { status: 404 });
  }
  // Prefer a row that already has a room assigned
  const app = rows.find(r => r.room_id || r.room_no) || rows[0];

  const [circRows, layoutsRows, campusMapRows, schedRows, roomRows, bldgRows] = await Promise.all([
    app.circular_id ? sbAdmission(`exam_circulars?id=eq.${app.circular_id}&select=id,name,session_id`) : Promise.resolve(null),
    sbAdmission('admission_settings?key=eq.seat_plan_room_layouts&select=value'),
    sbAdmission('admission_settings?key=eq.seat_plan_campus_map&select=value'),
    app.circular_id ? sbAdmission(`admission_settings?key=eq.seat_plan_schedules_${app.circular_id}&select=value`) : Promise.resolve(null),
    app.room_id ? sbInventory(`rooms?id=eq.${app.room_id}&select=id,name,capacity,building_id`) : Promise.resolve(null),
    sbInventory('buildings?select=id,name'),
  ]);

  const circ = Array.isArray(circRows) && circRows[0];
  let sessionName = '';
  if (circ && circ.session_id) {
    const sRows = await sbAdmission(`exam_sessions?id=eq.${circ.session_id}&select=name`);
    if (Array.isArray(sRows) && sRows[0]) sessionName = sRows[0].name || '';
  }

  const roomRow = Array.isArray(roomRows) && roomRows[0];
  const bldgById = {};
  (Array.isArray(bldgRows) ? bldgRows : []).forEach(b => { bldgById[b.id] = b.name; });
  const roomName = (roomRow && roomRow.name) || app.room_no || '';
  const explicitBldg = (roomRow && roomRow.building_id && bldgById[roomRow.building_id]) || '';
  const meta = parseRoomMeta(roomName, explicitBldg);
  const roomCap = (roomRow && parseInt(roomRow.capacity, 10)) || 0;
  const seatNo = parseInt(app.seat_no, 10) || 0;

  // Find matching exam schedule for Exam Date / Time
  const schedVal = Array.isArray(schedRows) && schedRows[0] && schedRows[0].value;
  const schedules = Array.isArray(schedVal?.schedules) ? schedVal.schedules : (Array.isArray(schedVal) ? schedVal : []);
  const critKey = `${String(app.class || '').trim()}||${String(app.version || '').trim()}||${String(app.category || '').trim()}`;
  const matchedSched = schedules.find(s => Array.isArray(s.included_criteria) && s.included_criteria.includes(critKey))
    || schedules.find(s => Array.isArray(s.plan_rows) && s.plan_rows.some(r => String(r.room_id) === String(app.room_id)))
    || schedules[0] || null;

  // Resolve global room layout
  const allLayouts = (Array.isArray(layoutsRows) && layoutsRows[0] && layoutsRows[0].value && typeof layoutsRows[0].value === 'object') ? layoutsRows[0].value : {};
  const savedLayout = app.room_id ? allLayouts[String(app.room_id)] : null;
  let layout = (savedLayout && Array.isArray(savedLayout.columns) && savedLayout.columns.length)
    ? savedLayout
    : defaultLayout(Math.max(roomCap, seatNo, 30));
  if (seatNo > getLayoutSlots(layout).length) {
    layout = adaptLayoutToSeats(layout, Math.max(roomCap, seatNo));
  }
  const slots = getLayoutSlots(layout);
  const mySlot = seatNo > 0 ? (slots.find(s => s.seatNo === seatNo) || null) : null;

  const campusMap = (Array.isArray(campusMapRows) && campusMapRows[0] && campusMapRows[0].value && typeof campusMapRows[0].value === 'object')
    ? campusMapRows[0].value
    : null;

  return NextResponse.json({
    student: {
      name: app.name_english || app.name_bangla || 'Applicant',
      name_bangla: app.name_bangla || '',
      father_name: app.father_name || '',
      mother_name: app.mother_name || '',
      index_id: app.index_id || '',
      tracking_id: app.tracking_id || app.token || app.external_key || '',
      class: app.class || '',
      version: app.version || '',
      category: app.category || '',
    },
    exam: {
      circular_name: (circ && circ.name) || 'Admission Test',
      session_name: sessionName,
      schedule_name: (matchedSched && matchedSched.name) || 'Written Exam',
      exam_date: (matchedSched && matchedSched.exam_date) || '',
      exam_time: (matchedSched && matchedSched.start_time) || '',
    },
    seat: {
      assigned: !!(roomName && seatNo),
      room_id: app.room_id || null,
      room_name: roomName,
      building: meta.building,
      building_code: meta.code,
      floor_num: meta.floorNum,
      floor_label: meta.floorLabel,
      seat_no: seatNo || null,
      col: mySlot ? mySlot.col : null,
      row: mySlot ? mySlot.row : null,
      col_label: mySlot && layout.columns[mySlot.col] ? (layout.columns[mySlot.col].label || `Col ${mySlot.col + 1}`) : '',
      row_number: mySlot ? (mySlot.row + 1) : null,
      total_desks: slots.length,
    },
    room_layout: layout,
    campus_map: campusMap,
    seat_info_cfg: (matchedSched && matchedSched.seat_info_cfg) || null,
  });
}
