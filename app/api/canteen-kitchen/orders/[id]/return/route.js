export const dynamic = 'force-dynamic';

// Ported from ccpc-canteen's return_order(): return some quantity of
// specific items, credit the student the refund (unit price x returned
// qty), and shrink or delete the order. `returns` is [{id, qty}]. Same
// compensating-write-on-failure discipline as modify/route.js.

import { readKitchenSession } from '../../../../../../lib/canteen-kitchen-auth';

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

export async function POST(request, { params }) {
  if (readKitchenSession(request) == null) {
    return Response.json({ success: false, message: 'Not signed in.' }, { status: 401 });
  }
  const { id } = await params;
  const { returns } = await request.json();
  if (!Array.isArray(returns) || !returns.length) {
    return Response.json({ success: false, message: 'Nothing to return.' }, { status: 400 });
  }

  const orderRows = await sbStudent(`canteen_orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = Array.isArray(orderRows) && orderRows[0];
  if (!order) {
    return Response.json({ success: false, message: 'Order not found.' }, { status: 404 });
  }

  const items = (Array.isArray(order.orders) ? order.orders : []).map((i) => ({
    id: i.id, name: i.name, price: Number(i.price) || 0, qty: Number(i.qty) || 0,
  }));

  let totalRefund = 0;
  for (const ret of returns) {
    const item = items.find((i) => String(i.id) === String(ret.id));
    if (!item) continue;
    const qtyBack = Math.min(item.qty, Math.max(0, Number(ret.qty) || 0));
    totalRefund += item.price * qtyBack; // price is unit price
    item.qty -= qtyBack;
  }
  if (totalRefund <= 0) {
    return Response.json({ success: false, message: 'Nothing was returned.' }, { status: 400 });
  }

  const newItems = items.filter((i) => i.qty > 0);
  const newTotal = newItems.reduce((s, i) => s + i.price * i.qty, 0);

  const studentRows = await sbStudent(`students_data?student_id=eq.${encodeURIComponent(order.student_id)}&select=balance`);
  const student = Array.isArray(studentRows) && studentRows[0];
  if (!student) {
    return Response.json({ success: false, message: 'Student record missing.' }, { status: 404 });
  }
  const balance = Number(student.balance || 0);
  const newBalance = balance + totalRefund;

  const balUpd = await sbStudent(`students_data?student_id=eq.${encodeURIComponent(order.student_id)}`, 'PATCH', { balance: newBalance });
  if (balUpd && balUpd.error) {
    return Response.json({ success: false, message: 'Could not credit the refund.' }, { status: 502 });
  }

  let res;
  if (!newItems.length) {
    res = await sbStudent(`canteen_orders?id=eq.${encodeURIComponent(id)}`, 'DELETE');
  } else {
    res = await sbStudent(`canteen_orders?id=eq.${encodeURIComponent(id)}`, 'PATCH', {
      orders: newItems, price: newTotal, updated_at: new Date().toISOString(),
    });
  }
  if (res && res.error) {
    await sbStudent(`students_data?student_id=eq.${encodeURIComponent(order.student_id)}`, 'PATCH', { balance });
    return Response.json({ success: false, message: 'Could not update the order.' }, { status: 502 });
  }

  return Response.json({ success: true, message: `Refunded ৳${totalRefund.toFixed(2)}.`, new_balance: newBalance, deleted: !newItems.length });
}
