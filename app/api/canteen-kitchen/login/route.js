export const dynamic = 'force-dynamic';

// Ported from ccpc-canteen/app/api/kitchen/login/route.js. Staff sign into a
// specific counter using that counter's own password (set by an admin via
// app/api/canteen-admin/route.js) -- no shared kitchen password.

import { createKitchenToken, sessionCookieHeader, verifyCounterPassword } from '../../../../lib/canteen-kitchen-auth';

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

export async function POST(request) {
  const { counter_no, password } = await request.json();
  const counter = parseInt(counter_no, 10);
  if (!counter || counter < 1 || counter > 99) {
    return Response.json({ success: false, message: 'Pick a counter.' }, { status: 400 });
  }
  const rows = await sbStudent(`canteen_counters?counter_id=eq.${counter}&select=counter_id,name,password_hash`);
  const row = Array.isArray(rows) && rows[0];
  if (!row || !row.password_hash) {
    return Response.json({ success: false, message: 'This counter is not set up yet. Ask an admin to create it.' }, { status: 404 });
  }
  if (!password || !verifyCounterPassword(password, row.password_hash)) {
    return Response.json({ success: false, message: 'Incorrect password for this counter.' }, { status: 401 });
  }
  const token = createKitchenToken(counter);
  return Response.json({ success: true, counter_no: counter, counter_name: row.name || `Counter ${counter}` }, {
    headers: { 'Set-Cookie': sessionCookieHeader('kitchen_session', token) },
  });
}
