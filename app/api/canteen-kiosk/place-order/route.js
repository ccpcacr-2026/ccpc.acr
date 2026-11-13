export const dynamic = 'force-dynamic';

// Ported from ccpc-canteen/app/api/kiosk/place-order/route.js (+ its
// lib/settings.js, lib/counter.js, lib/notify.js) as one self-contained
// route, matching this repo's no-shared-lib convention for standalone
// routes.

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

// Same DEFAULT_SETTINGS/getSettings shape as verify-card/route.js -- kept
// as its own copy here rather than shared, per this repo's established
// per-route convention (see app/bill/[id]/route.js, app/vote/[slug]/route.js
// each keeping their own private esc()/sbXxx() rather than importing one).
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

// Ports get_best_counter(): among counters seen open in the last 5 minutes,
// pick the one with the fewest pending orders. Falls back to counter 1 when
// no counter has checked in (single-till canteen, or nobody has opened yet).
async function getBestCounter() {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const counters = await sbStudent(
      `canteen_counters?status=eq.true&last_seen_at=gt.${fiveMinAgo}&select=counter_id`
    );
    const active = (Array.isArray(counters) ? counters : []).map((c) => c.counter_id);
    if (!active.length) return 1;

    const counts = await Promise.all(
      active.map(async (cid) => {
        const rows = await sbStudent(`canteen_orders?is_delivered=eq.false&counter_no=eq.${cid}&select=id`);
        return { cid, n: (Array.isArray(rows) ? rows : []).length };
      })
    );
    counts.sort((a, b) => a.n - b.n);
    return counts[0].cid;
  } catch {
    return 1;
  }
}

// Records an in-app notification for a student (order placed), mirroring
// the desktop apps' add_notification(). Best-effort: a failure here must
// never block the order that triggered it. Gated by notify_app_enabled.
async function addNotification(studentId, message, kind = 'info') {
  if (!studentId || !message) return;
  try {
    const settings = await getSettings();
    if (!settings.notify_app_enabled) return;
    await sbStudent('canteen_notifications', 'POST', { student_id: studentId, message, kind });
  } catch {
    /* non-fatal */
  }
}

function startOfDayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function POST(request) {
  const { student_id, items, delivery_option } = await request.json();
  if (!student_id || !Array.isArray(items) || !items.length) {
    return Response.json({ success: false, message: 'Empty order.' }, { status: 400 });
  }

  const total = items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);

  const [rows, settings] = await Promise.all([
    sbStudent(`students_data?student_id=eq.${encodeURIComponent(student_id)}&select=*`),
    getSettings(),
  ]);
  if (rows && rows.error) {
    return Response.json({ success: false, message: 'Could not reach the student database.' }, { status: 502 });
  }
  const student = Array.isArray(rows) && rows[0];
  if (!student) {
    return Response.json({ success: false, message: 'Student not found.' }, { status: 404 });
  }
  if (student.card_status === 'Blocked' || student.card_status === 'Lost') {
    return Response.json({ success: false, message: `Card is ${student.card_status}.` }, { status: 403 });
  }

  // Balance check with optional lending headroom (matches desktop place_order).
  const balance = Number(student.balance || 0);
  const lending = settings.enable_lending_limit ? Number(settings.general_lending_limit || 0) : 0;
  if (balance + lending < total) {
    return Response.json({
      success: false,
      message: `Insufficient balance (limit ৳${(balance + lending).toFixed(2)}).`,
    }, { status: 402 });
  }

  // Effective limits: per-student override, else the general value; only if enabled.
  const dailyLimit = settings.enable_daily_limit
    ? Number(student.daily_limit || settings.general_daily_limit || 0)
    : 0;
  const monthlyLimit = settings.enable_monthly_limit
    ? Number(student.monthly_limit || settings.general_monthly_limit || 0)
    : 0;

  if (dailyLimit > 0 || monthlyLimit > 0) {
    const [todayOrders, monthOrders] = await Promise.all([
      dailyLimit > 0
        ? sbStudent(`canteen_orders?student_id=eq.${encodeURIComponent(student_id)}&created_at=gte.${startOfDayISO()}&select=price`)
        : Promise.resolve([]),
      monthlyLimit > 0
        ? sbStudent(`canteen_orders?student_id=eq.${encodeURIComponent(student_id)}&created_at=gte.${startOfMonthISO()}&select=price`)
        : Promise.resolve([]),
    ]);
    const todaySpent = (Array.isArray(todayOrders) ? todayOrders : []).reduce((s, o) => s + Number(o.price || 0), 0);
    const monthSpent = (Array.isArray(monthOrders) ? monthOrders : []).reduce((s, o) => s + Number(o.price || 0), 0);

    if (dailyLimit > 0 && todaySpent + total > dailyLimit) {
      return Response.json({ success: false, message: `This order would exceed the daily spend limit (৳${dailyLimit}).` }, { status: 403 });
    }
    if (monthlyLimit > 0 && monthSpent + total > monthlyLimit) {
      return Response.json({ success: false, message: `This order would exceed the monthly spend limit (৳${monthlyLimit}).` }, { status: 403 });
    }
  }

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  const countRows = await sbStudent(`canteen_orders?created_at=gte.${startOfDayISO()}&select=id`);
  const seq = (Array.isArray(countRows) ? countRows.length : 0) + 1;
  const invoiceNumber = `${dateStr}-${String(seq).padStart(5, '0')}`;

  const counterNo = await getBestCounter();

  const newBalance = balance - total;
  const balanceUpdate = await sbStudent(
    `students_data?student_id=eq.${encodeURIComponent(student_id)}`,
    'PATCH',
    { balance: newBalance }
  );
  if (balanceUpdate && balanceUpdate.error) {
    return Response.json({ success: false, message: 'Could not update balance.' }, { status: 502 });
  }

  const parts = [student.class, student.section, student.group && student.group !== 'None' ? student.group : null, student.roll].filter(Boolean);
  const orderInsert = await sbStudent('canteen_orders', 'POST', {
    student_id,
    student_name: student.student_name,
    class_section_roll: parts.length ? parts.join('-') : 'N/A',
    orders: items,
    price: total,
    is_delivered: false,
    delivery_option: delivery_option || 'hand',
    invoice_number: invoiceNumber,
    counter_no: counterNo,
  });
  if (orderInsert && orderInsert.error) {
    // Best-effort rollback of the balance deduction since the order itself
    // failed to record -- not a real DB transaction, matching the original.
    await sbStudent(`students_data?student_id=eq.${encodeURIComponent(student_id)}`, 'PATCH', { balance });
    return Response.json({ success: false, message: 'Could not place the order. Balance was not charged.' }, { status: 502 });
  }

  await addNotification(student_id, `Order of ৳${total.toFixed(2)} placed. Invoice ${invoiceNumber}.`, 'order');

  return Response.json({
    success: true,
    message: `Order placed! Invoice ${invoiceNumber}`,
    invoice_number: invoiceNumber,
    new_balance: newBalance,
    counter_no: counterNo,
  });
}
