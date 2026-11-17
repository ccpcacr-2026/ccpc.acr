export const dynamic = 'force-dynamic';

import { readKitchenSession } from '../../../../../lib/canteen-kitchen-auth';

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

const DEFAULT_SETTINGS = { notify_app_enabled: true };
async function getSettings() {
  const rows = await sbStudent('canteen_settings?id=eq.1&select=data');
  if (Array.isArray(rows) && rows[0] && rows[0].data) return { ...DEFAULT_SETTINGS, ...rows[0].data };
  return { ...DEFAULT_SETTINGS };
}
// Best-effort: a failure here must never block the delivery mark that triggered it.
async function addNotification(studentId, message, kind = 'info') {
  if (!studentId || !message) return;
  try {
    const settings = await getSettings();
    if (!settings.notify_app_enabled) return;
    await sbStudent('canteen_notifications', 'POST', { student_id: studentId, message, kind });
  } catch { /* non-fatal */ }
}

export async function PATCH(request, { params }) {
  if (readKitchenSession(request) == null) {
    return Response.json({ success: false, message: 'Not signed in.' }, { status: 401 });
  }
  const { id } = await params;
  const { is_delivered } = await request.json();
  const updated = await sbStudent(
    `canteen_orders?id=eq.${encodeURIComponent(id)}&select=*`,
    'PATCH',
    { is_delivered: !!is_delivered, updated_at: new Date().toISOString() }
  );
  if (updated && updated.error) {
    return Response.json({ success: false, message: 'Could not update the order.' }, { status: 502 });
  }
  if (is_delivered) {
    const row = Array.isArray(updated) && updated[0];
    if (row && row.student_id) {
      await addNotification(row.student_id, `Order #${row.invoice_number || id} is ready for pickup.`, 'ready');
    }
  }
  return Response.json({ success: true });
}
