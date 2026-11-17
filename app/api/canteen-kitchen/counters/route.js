export const dynamic = 'force-dynamic';

// Public (pre-login) list of counters staff can sign into -- number + name
// only, never the password hash. Only counters that have a password set are
// shown (an admin creates/passwords counters via app/api/canteen-admin/route.js).

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

export async function GET() {
  const rows = await sbStudent('canteen_counters?select=counter_id,name,password_hash&order=counter_id.asc');
  if (rows && rows.error) {
    return Response.json({ success: true, counters: [] });
  }
  const counters = (Array.isArray(rows) ? rows : [])
    .filter((c) => !!c.password_hash)
    .map((c) => ({ counter_id: c.counter_id, name: c.name || `Counter ${c.counter_id}` }));
  return Response.json({ success: true, counters });
}
