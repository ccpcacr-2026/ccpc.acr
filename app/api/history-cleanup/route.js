import { NextResponse } from 'next/server';

// ── Scheduled retention cleanup (Vercel Cron, see vercel.json) ───────────
// Deletes rows older than 3 months from the three logs behind the admin
// "History" view (Student Portal module): student.edit_history (existing,
// trigger-populated on every students_data UPDATE), teacher_staff.
// portal_visit_log and student.portal_visit_log (new, see
// migration_portal_visit_logs.sql and app/api/exec/route.js's
// loginAndGetProfile). Self-contained per this repo's no-shared-lib
// convention -- duplicates the plain-fetch Supabase REST pattern already
// used by every other cron route (e.g. app/api/vortibd-cron/route.js)
// rather than importing lib/supabase.js.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const RETENTION_DAYS = 90; // "3 months" -- a fixed day count, not calendar months, so it's exact and DST-proof

async function deleteOlderThan(schema, table, dateColumn, cutoffIso) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${dateColumn}=lt.${encodeURIComponent(cutoffIso)}`, {
    method: 'DELETE',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Accept-Profile': schema,
      'Content-Profile': schema,
      Prefer: 'count=exact',
    },
  });
  const countRange = res.headers.get('content-range') || '';
  const deleted = Number(countRange.split('/')[1]) || 0;
  if (!res.ok) {
    const text = await res.text();
    return { table, error: text };
  }
  return { table, deleted };
}

export async function GET(req) {
  const auth = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const results = await Promise.all([
    deleteOlderThan('student', 'edit_history', 'created_at', cutoffIso),
    deleteOlderThan('teacher_staff', 'portal_visit_log', 'visited_at', cutoffIso),
    deleteOlderThan('student', 'portal_visit_log', 'visited_at', cutoffIso),
  ]);
  return NextResponse.json({ cutoff: cutoffIso, results });
}
