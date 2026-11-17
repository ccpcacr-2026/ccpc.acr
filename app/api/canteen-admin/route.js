import { NextResponse } from 'next/server';
import { hashCounterPassword } from '../../../lib/canteen-kitchen-auth';

// Lets an Admin/Canteen Admin create and manage the physical counters
// (number + name + password) that Kitchen staff sign into
// (app/api/canteen-kitchen/login). Nothing else in this repo could set
// canteen_counters.password_hash -- the only place that ever did was
// ccpc-canteen's own separate /admin screen (its own admin_session cookie,
// a whole different login system), which Part 13 deliberately left out of
// scope. Reuses this repo's OWN existing Admin-role check pattern instead
// of resurrecting that separate auth system -- same pattern as
// app/api/inventory-admin/route.js:52-75 (_getUserRoles/_isInventoryAdmin).

export const dynamic = 'force-dynamic';

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

async function _getUserRoles(userId) {
  if (!userId) return [];
  const res = await fetch(`${SB_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}&select=role`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Accept-Profile': 'teacher_staff' },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  const role = Array.isArray(rows) && rows[0] ? rows[0].role : '';
  return String(role || '').split(',').map(r => r.trim()).filter(Boolean);
}
async function _isCanteenAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('Canteen Admin');
}

export async function POST(req) {
  const { action, payload, user_id } = await req.json();
  if (!(await _isCanteenAdmin(user_id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (action === 'listCounters') {
    const rows = await sbStudent('canteen_counters?select=counter_id,name,status,last_seen_at,password_hash&order=counter_id.asc');
    if (rows?.error) return NextResponse.json({ error: rows.error });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const counters = (Array.isArray(rows) ? rows : []).map((c) => ({
      counter_id: c.counter_id,
      name: c.name || `Counter ${c.counter_id}`,
      has_password: !!c.password_hash,
      open: !!c.status && c.last_seen_at && new Date(c.last_seen_at).getTime() > fiveMinAgo,
      last_seen_at: c.last_seen_at,
    }));
    return NextResponse.json({ counters });
  }

  if (action === 'saveCounter') {
    const cid = parseInt(payload?.counter_id, 10);
    if (!cid || cid < 1 || cid > 99) return NextResponse.json({ error: 'Counter number must be 1-99.' });
    const name = payload?.name && String(payload.name).trim() ? String(payload.name).trim() : `Counter ${cid}`;
    const existingRows = await sbStudent(`canteen_counters?counter_id=eq.${cid}&select=counter_id`);
    const exists = Array.isArray(existingRows) && existingRows.length;
    if (!exists) {
      if (!payload?.password || String(payload.password).length < 3) {
        return NextResponse.json({ error: 'Set a password (at least 3 characters).' });
      }
      const ins = await sbStudent('canteen_counters', 'POST', {
        counter_id: cid, name, password_hash: hashCounterPassword(payload.password), status: false,
      });
      if (ins?.error) return NextResponse.json({ error: ins.error });
      return NextResponse.json({ success: true });
    }
    const patch = { name };
    if (payload?.password) {
      if (String(payload.password).length < 3) return NextResponse.json({ error: 'Password must be at least 3 characters.' });
      patch.password_hash = hashCounterPassword(payload.password);
    }
    const upd = await sbStudent(`canteen_counters?counter_id=eq.${cid}`, 'PATCH', patch);
    if (upd?.error) return NextResponse.json({ error: upd.error });
    return NextResponse.json({ success: true });
  }

  if (action === 'deleteCounter') {
    const cid = parseInt(payload?.counter_id, 10);
    if (!cid) return NextResponse.json({ error: 'Missing counter_id.' });
    await sbStudent(`canteen_counters?counter_id=eq.${cid}`, 'DELETE');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action.' });
}
