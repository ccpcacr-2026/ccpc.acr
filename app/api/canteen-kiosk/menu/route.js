export const dynamic = 'force-dynamic';

// Ported from ccpc-canteen/app/api/kiosk/menu/route.js (+ its lib/menu.js)
// as a self-contained route, matching this repo's no-shared-lib convention
// for standalone routes (see app/bill/[id]/route.js, app/canteen-kiosk/route.js).

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

function castToArray(val) {
  return Array.isArray(val) ? val : (val == null ? [] : [val]);
}

// Ports database_manager.py get_active_menu_ids() via the original's
// lib/menu.js resolveActiveFoodIds(): a food is on the menu right now if it
// belongs to any *active* menu --
//   - its override_date is today  -> use its `activated` flag for today, or
//   - otherwise its schedule matches now:
//       Daily                        -> always
//       Weekly + description=weekday -> e.g. "Monday"
//       Monthly + description=day    -> e.g. "15"
//       Date + description=YYYY-MM-DD
//       Custom                       -> use `activated` flag
// `menus.items` is a comma-separated list of food ids; `activated` is 0/1.
function resolveActiveFoodIds(menus, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dayOfMonth = String(now.getDate());

  const ids = new Set();
  for (const m of castToArray(menus)) {
    let isActive = false;
    const ovDate = String(m.override_date || '');
    if (ovDate.slice(0, 10) === today) {
      isActive = !!Number(m.activated);
    } else {
      const sched = m.scheduled;
      const desc = String(m.description || '');
      if (sched === 'Daily') isActive = true;
      else if (sched === 'Weekly' && desc === weekday) isActive = true;
      else if (sched === 'Monthly' && desc === dayOfMonth) isActive = true;
      else if (sched === 'Date' && (desc === today || desc.slice(0, 10) === today)) isActive = true;
      else if (sched === 'Custom') isActive = !!Number(m.activated);
    }
    if (isActive && m.items) {
      String(m.items).split(',').forEach((x) => {
        const t = x.trim();
        if (/^\d+$/.test(t)) ids.add(Number(t));
      });
    }
  }
  return ids;
}

export async function GET() {
  const [foods, menus] = await Promise.all([
    sbStudent('foods?select=*&order=name.asc'),
    sbStudent('menus?select=*'),
  ]);
  if (foods && foods.error) {
    return Response.json({ success: false, message: 'Could not load the menu.' }, { status: 502 });
  }

  const allFoods = castToArray(foods);
  const passesAvail = (f) => f.is_available && (f.qty ?? 0) > 0;
  const menuRows = castToArray(menus);

  // If NO menus are defined at all, every available food shows (so the
  // kiosk still works before anyone builds a menu) -- matches the original.
  let out;
  if (!menuRows.length) {
    out = allFoods.filter(passesAvail);
  } else {
    const activeIds = resolveActiveFoodIds(menuRows);
    const byId = new Map(allFoods.map((f) => [Number(f.id), f]));
    out = [];
    for (const id of activeIds) {
      const f = byId.get(Number(id));
      if (f && passesAvail(f)) out.push(f);
    }
  }

  return Response.json({ success: true, foods: out });
}
