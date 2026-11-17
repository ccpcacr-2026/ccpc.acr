export const dynamic = 'force-dynamic';

// Ported from ccpc-canteen's modify_order(): replace an order's items with
// an adjusted list, then charge or refund the student the price difference.
// Items are {id, name, price (unit), qty}; line total = price*qty. Zero-qty
// items drop. If the order empties out, it's deleted.
//
// Re-fetches the student's balance fresh server-side (never trusts the
// client), writes the balance first, then the order change, and rolls the
// balance back if that second write fails -- the exact same compensating-
// write discipline already used in app/api/canteen-kiosk/place-order.

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
  const { items } = await request.json();
  if (!Array.isArray(items)) {
    return Response.json({ success: false, message: 'No items provided.' }, { status: 400 });
  }

  const orderRows = await sbStudent(`canteen_orders?id=eq.${encodeURIComponent(id)}&select=*`);
  const order = Array.isArray(orderRows) && orderRows[0];
  if (!order) {
    return Response.json({ success: false, message: 'Order not found.' }, { status: 404 });
  }

  const newItems = items
    .map((i) => ({ id: i.id, name: i.name, price: Number(i.price) || 0, qty: Number(i.qty) || 0 }))
    .filter((i) => i.qty > 0);
  const newTotal = newItems.reduce((s, i) => s + i.price * i.qty, 0);
  const oldTotal = Number(order.price || 0);
  const priceDiff = newTotal - oldTotal; // >0 = extra charge, <0 = refund

  const studentRows = await sbStudent(`students_data?student_id=eq.${encodeURIComponent(order.student_id)}&select=balance`);
  const student = Array.isArray(studentRows) && studentRows[0];
  if (!student) {
    return Response.json({ success: false, message: 'Student record missing.' }, { status: 404 });
  }
  const balance = Number(student.balance || 0);
  if (priceDiff > 0 && balance < priceDiff) {
    return Response.json({ success: false, message: 'Student has insufficient balance for the added items.' }, { status: 402 });
  }

  const newBalance = balance - priceDiff;
  const balUpd = await sbStudent(`students_data?student_id=eq.${encodeURIComponent(order.student_id)}`, 'PATCH', { balance: newBalance });
  if (balUpd && balUpd.error) {
    return Response.json({ success: false, message: 'Could not adjust the balance.' }, { status: 502 });
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
    // Roll the balance back if the order write failed.
    await sbStudent(`students_data?student_id=eq.${encodeURIComponent(order.student_id)}`, 'PATCH', { balance });
    return Response.json({ success: false, message: 'Could not update the order.' }, { status: 502 });
  }

  const verb = priceDiff > 0 ? `Charged ৳${priceDiff.toFixed(2)}` : priceDiff < 0 ? `Refunded ৳${(-priceDiff).toFixed(2)}` : 'No price change';
  return Response.json({ success: true, message: `${verb}. New total ৳${newTotal.toFixed(2)}.`, new_balance: newBalance, deleted: !newItems.length });
}
