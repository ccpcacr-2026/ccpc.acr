export const dynamic = 'force-dynamic';

// The counter number comes from the signed session (set at login), never
// the request body -- staff can only open/close the till they signed into.

import { readKitchenSession } from '../../../../lib/canteen-kitchen-auth';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbStudent(path, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
      'Accept-Profile': 'student',
      'Content-Profile': 'student',
      ...extraHeaders,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) return { error: text };
  return text ? JSON.parse(text) : null;
}

// Ports updateCounterHeartbeat(): upsert last_seen_at/status for this till.
// on_conflict alone isn't enough -- PostgREST also needs the
// resolution=merge-duplicates Prefer directive to actually upsert instead
// of erroring on a duplicate key (confirmed against the original's own
// lib/supabase.js, which adds this automatically whenever the endpoint
// contains "on_conflict").
export async function POST(request) {
  const counter = readKitchenSession(request);
  if (counter == null) {
    return Response.json({ success: false, message: 'Not signed in.' }, { status: 401 });
  }
  const { is_open } = await request.json();
  const nowIso = new Date().toISOString();
  const res = await sbStudent('canteen_counters?on_conflict=counter_id', 'POST', {
    counter_id: counter, last_seen_at: nowIso, status: !!is_open, updated_at: nowIso,
  }, { Prefer: 'return=representation,resolution=merge-duplicates' });
  if (res && res.error) {
    return Response.json({ success: false, message: 'Could not update counter status.' }, { status: 502 });
  }
  return Response.json({ success: true, counter_id: counter, is_open: !!is_open });
}
