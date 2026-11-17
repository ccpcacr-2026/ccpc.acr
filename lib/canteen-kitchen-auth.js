// Canteen Kitchen session/auth primitives -- ported 1:1 from ccpc-canteen's
// lib/auth.js (its kitchen-specific pieces only; the generic admin/control
// session functions in the original aren't ported, out of scope here).
//
// Why a shared lib and not duplicated per-route (unlike this repo's usual
// per-route sbXxx()/esc() convention): this is HMAC signing/verification
// and cookie parsing, used by 8 different route files. Duplicating
// security-sensitive crypto logic 8 times is a real correctness risk a
// duplicated fetch helper isn't -- a future fix would need to land in 8
// places to be safe. lib/supabase.js is the existing precedent for a
// shared lib used by multiple routes in this repo.
//
// Kitchen staff sign into a specific physical counter using that counter's
// own password (set by an admin against canteen_counters.password_hash via
// app/api/canteen-admin/route.js) -- not a personal teacher/staff login.
// The server issues an HMAC-signed `kitchen_session` cookie carrying which
// counter they're signed into; every other Kitchen endpoint re-derives the
// counter number from that cookie, never trusts a client-sent counter
// number.

import crypto from 'crypto';

const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours -- a kiosk shift

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

// Keyed hash for stored per-counter passwords -- keyed by SESSION_SECRET so
// a leaked DB row can't be reversed, no per-row salt to manage.
export function hashCounterPassword(password) {
  return crypto.createHmac('sha256', SESSION_SECRET).update('counter:' + String(password)).digest('hex');
}
export function verifyCounterPassword(password, storedHash) {
  if (!storedHash) return false;
  const h = hashCounterPassword(password);
  try {
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

// Token: kitchen.<counter>.<expires>.<sig>.
export function createKitchenToken(counterNo) {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `kitchen.${counterNo}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

// Returns the counter number (integer) for a valid kitchen session, else null.
export function readKitchenSession(request, cookieName = 'kitchen_session') {
  if (!SESSION_SECRET) return null;
  const token = parseCookies(request)[cookieName];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [role, counterStr, expiresStr, sig] = parts;
  if (role !== 'kitchen') return null;
  const expires = parseInt(expiresStr, 10);
  if (!expires || Date.now() > expires) return null;
  const expectedSig = sign(`${role}.${counterStr}.${expiresStr}`);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }
  const counter = parseInt(counterStr, 10);
  return Number.isFinite(counter) ? counter : null;
}

export function sessionCookieHeader(cookieName, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function clearCookieHeader(cookieName) {
  return `${cookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}
