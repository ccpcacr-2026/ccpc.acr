import { NextResponse } from 'next/server';

// ── Database Backup admin panel ──────────────────────────────────────────
// Thin, Admin-only proxy in front of the ccpc-backup-agent service -- a
// small, isolated Docker container running on the VPS host (not in this
// app's own container), reachable only on the internal `coolify` Docker
// network by container name, authenticated by a long shared-secret bearer
// token (BACKUP_AGENT_TOKEN). The agent is what actually runs pg_dump/
// rclone/docker exec against the live database and Google Drive -- this
// route never touches those directly, and deliberately has no Docker
// socket or host access of its own, keeping the public-facing web app's
// own blast radius unchanged.
//
// Two permission tiers, same shape as every other admin route in this
// codebase (_getUserRoles against teacher_staff.app_users, re-verified
// fresh on every request, never trusted from the client):
// - Admin / DB Backup Admin role: required for every action in this file.
// - Passkey: a SECOND, independent secret (set via setPasskey, stored only
//   as a sha256 hash inside the agent itself, never in this app or this
//   database) required specifically for deleteBackup/restoreBackup -- the
//   two genuinely destructive actions -- so even an Admin-role account
//   can't trigger those without separately knowing the passkey.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const AGENT_URL = process.env.BACKUP_AGENT_URL;
const AGENT_TOKEN = process.env.BACKUP_AGENT_TOKEN;

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

async function _isBackupAdmin(userId) {
  const roles = await _getUserRoles(userId);
  return roles.includes('Admin') || roles.includes('DB Backup Admin');
}

async function _agent(path, method = 'GET', body) {
  if (!AGENT_URL || !AGENT_TOKEN) return { error: 'Backup agent is not configured (missing BACKUP_AGENT_URL/BACKUP_AGENT_TOKEN).' };
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${AGENT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      // The agent's own backup/restore calls can genuinely take a few
      // minutes against a real database -- never let the platform's own
      // default fetch timeout cut that short.
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text || 'Invalid response from backup agent' }; }
    if (!res.ok) return { error: json.error || `Backup agent returned ${res.status}` };
    return json;
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'Backup agent timed out.' : (e.message || 'Could not reach backup agent') };
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ result: 'error', message: 'Bad request' }, { status: 400 }); }
  const { action, payload = {}, user_id } = body;

  if (!(await _isBackupAdmin(user_id))) {
    return NextResponse.json({ result: 'error', message: 'Admin access required.' }, { status: 403 });
  }

  if (action === 'listBackups') {
    const r = await _agent('/backups');
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', files: r.files || [] });
  }

  if (action === 'getSchedule') {
    const r = await _agent('/schedule');
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', ...r });
  }

  if (action === 'setSchedule') {
    const hour = parseInt(payload.hour, 10);
    const minute = parseInt(payload.minute, 10);
    const retention_days = parseInt(payload.retention_days, 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(retention_days)) {
      return NextResponse.json({ result: 'error', message: 'Missing or invalid schedule values.' });
    }
    const r = await _agent('/schedule', 'POST', { hour, minute, retention_days });
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'triggerBackup') {
    const r = await _agent('/backup', 'POST', {});
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'getPasskeyStatus') {
    const r = await _agent('/passkey-status');
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success', has_passkey: !!r.has_passkey });
  }

  if (action === 'setPasskey') {
    const passkey = String(payload.passkey || '');
    if (passkey.length < 6) return NextResponse.json({ result: 'error', message: 'Passkey must be at least 6 characters.' });
    const r = await _agent('/set-passkey', 'POST', { passkey, current_passkey: payload.current_passkey });
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'deleteBackup') {
    const filename = String(payload.filename || '');
    if (!filename) return NextResponse.json({ result: 'error', message: 'Missing filename.' });
    const r = await _agent('/delete', 'POST', { filename, passkey: payload.passkey });
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  if (action === 'restoreBackup') {
    const filename = String(payload.filename || '');
    if (!filename) return NextResponse.json({ result: 'error', message: 'Missing filename.' });
    const r = await _agent('/restore', 'POST', { filename, passkey: payload.passkey });
    if (r.error) return NextResponse.json({ result: 'error', message: r.error });
    return NextResponse.json({ result: 'success' });
  }

  return NextResponse.json({ result: 'error', message: `Unknown action: ${action}` }, { status: 400 });
}
