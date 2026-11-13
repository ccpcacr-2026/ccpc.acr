export const dynamic = 'force-dynamic';

// Ported from ccpc-canteen/app/api/kiosk/verify-card/route.js (+ its
// lib/settings.js) as a self-contained route, matching this repo's
// no-shared-lib convention for standalone routes. Looks up a scanned NFC
// UID or a typed Student ID against the exact same student.students_data
// row this repo's own admin screens already manage -- the canteen columns
// (balance/daily_limit/monthly_limit/card_status/nfc_uid) are shared data,
// not a separate table.

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

function castToArray(val) {
  return Array.isArray(val) ? val : (val == null ? [] : [val]);
}

// Mirrors the desktop apps' config.json limit/notification flags. Stored as
// a single JSONB row (student.canteen_settings id=1) so an eventual Admin/
// Control screen can edit them without a redeploy -- same storage shape as
// the original, just read here via this route's own sbStudent helper
// instead of ccpc-canteen's lib/settings.js.
const DEFAULT_SETTINGS = {
  enable_daily_limit: true,
  enable_monthly_limit: true,
  enable_lending_limit: true,
  general_daily_limit: 120,
  general_monthly_limit: 1200,
  general_lending_limit: 200,
  low_stock_threshold: 10,
  notify_app_enabled: true,
};
async function getSettings() {
  const rows = await sbStudent('canteen_settings?id=eq.1&select=data');
  if (Array.isArray(rows) && rows[0] && rows[0].data) {
    return { ...DEFAULT_SETTINGS, ...rows[0].data };
  }
  return { ...DEFAULT_SETTINGS };
}

function startOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function POST(request) {
  const { uid } = await request.json();
  if (!uid) {
    return Response.json({ success: false, message: 'No card UID provided.' }, { status: 400 });
  }

  const rows = await sbStudent(
    `students_data?or=(nfc_uid.eq.${encodeURIComponent(uid)},student_id.eq.${encodeURIComponent(uid)})&select=*`
  );

  if (rows && rows.error) {
    return Response.json({ success: false, message: 'Could not reach the student database.' }, { status: 502 });
  }
  if (!Array.isArray(rows) || !rows.length) {
    return Response.json({ success: false, message: 'Card not recognized.' }, { status: 404 });
  }

  const s = rows[0];
  if (s.card_status === 'Blocked' || s.card_status === 'Lost') {
    return Response.json({
      success: false,
      blocked: true,
      message: `This card is marked ${s.card_status}. Please contact the canteen office.`,
    }, { status: 403 });
  }

  const parts = [s.class, s.section, s.group && s.group !== 'None' ? s.group : null, s.roll].filter(Boolean);

  // Pull this month's orders once, then derive both the day-wise spend total
  // and the student's favourites (most-ordered items) from it -- the same
  // signals the desktop kiosk showed in its sidebar.
  const [settings, monthOrders] = await Promise.all([
    getSettings(),
    sbStudent(`canteen_orders?student_id=eq.${encodeURIComponent(s.student_id)}&created_at=gte.${startOfMonthISO()}&select=created_at,price,orders`),
  ]);

  const orders = castToArray(monthOrders);
  const spendByDay = {};
  let monthSpent = 0;
  const favCounts = {};
  const favMeta = {};
  for (const o of orders) {
    const day = String(o.created_at || '').slice(0, 10);
    if (day) spendByDay[day] = (spendByDay[day] || 0) + Number(o.price || 0);
    monthSpent += Number(o.price || 0);
    const items = Array.isArray(o.orders) ? o.orders : [];
    for (const it of items) {
      const id = it.id;
      if (id == null) continue;
      favCounts[id] = (favCounts[id] || 0) + (Number(it.qty) || 0);
      if (!favMeta[id]) favMeta[id] = { id, name: it.name, price: Number(it.price) / (Number(it.qty) || 1) };
    }
  }
  const favourites = Object.keys(favCounts)
    .sort((a, b) => favCounts[b] - favCounts[a])
    .slice(0, 3)
    .map((id) => favMeta[id]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const dailyLimit = settings.enable_daily_limit
    ? Number(s.daily_limit || settings.general_daily_limit || 0)
    : 0;
  const monthlyLimit = settings.enable_monthly_limit
    ? Number(s.monthly_limit || settings.general_monthly_limit || 0)
    : 0;

  return Response.json({
    success: true,
    student: {
      student_id: s.student_id,
      name: s.student_name,
      class_section_roll: parts.length ? parts.join('-') : 'N/A',
      balance: Number(s.balance || 0),
      daily_limit: dailyLimit,
      monthly_limit: monthlyLimit,
      spent_today: Number(spendByDay[todayKey] || 0),
      spent_month: monthSpent,
      lending_limit: settings.enable_lending_limit ? Number(settings.general_lending_limit || 0) : 0,
      photo: s.photo || null,
      favourites,
      spend_by_day: spendByDay,
    },
  });
}
