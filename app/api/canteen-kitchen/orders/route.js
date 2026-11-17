export const dynamic = 'force-dynamic';

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

export async function GET(request) {
  if (readKitchenSession(request) == null) {
    return Response.json({ success: false, message: 'Not signed in.' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const status = params.get('status') || 'pending';
  const counter = params.get('counter'); // optional: filter to one counter
  const filter = status === 'delivered' ? 'is_delivered=eq.true' : 'is_delivered=eq.false';
  const order = status === 'delivered' ? 'created_at.desc' : 'created_at.asc';
  const limit = status === 'delivered' ? 50 : 200;
  const counterFilter = counter ? `&counter_no=eq.${encodeURIComponent(counter)}` : '';
  const rows = await sbStudent(`canteen_orders?${filter}${counterFilter}&order=${order}&limit=${limit}&select=*`);
  if (rows && rows.error) {
    return Response.json({ success: false, message: 'Could not reach the database.' }, { status: 502 });
  }
  return Response.json({ success: true, orders: Array.isArray(rows) ? rows : [] });
}
