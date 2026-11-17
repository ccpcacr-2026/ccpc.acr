export const dynamic = 'force-dynamic';

// Top-selling items today, by quantity -- the "Popular today" strip that
// tells the kitchen what to pre-make.

import { readKitchenSession } from '../../../../lib/canteen-kitchen-auth';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbStudent(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'student' },
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

function startOfDayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function GET(request) {
  if (readKitchenSession(request) == null) {
    return Response.json({ success: false, message: 'Not signed in.' }, { status: 401 });
  }
  const rows = await sbStudent(`canteen_orders?created_at=gte.${startOfDayISO()}&select=orders`);
  if (rows && rows.error) {
    return Response.json({ success: false, message: 'Could not load sales.' }, { status: 502 });
  }
  const counts = {};
  for (const o of (Array.isArray(rows) ? rows : [])) {
    const items = Array.isArray(o.orders) ? o.orders : [];
    for (const it of items) {
      if (it.id == null) continue;
      if (!counts[it.id]) counts[it.id] = { id: it.id, name: it.name, qty: 0 };
      counts[it.id].qty += Number(it.qty) || 0;
    }
  }
  const popular = Object.values(counts).sort((a, b) => b.qty - a.qty).slice(0, 4);
  return Response.json({ success: true, popular });
}
