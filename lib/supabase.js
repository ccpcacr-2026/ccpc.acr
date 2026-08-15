const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function supabaseRequest(endpoint, method = 'get', payload = null, timeoutMs = 8000) {
  const url = `${SB_URL}/rest/v1/${endpoint}`;
  const isUpsert = method.toUpperCase() === 'POST' && endpoint.includes('on_conflict');
  const prefer   = isUpsert
    ? 'return=representation,resolution=merge-duplicates'
    : 'return=representation';

  const options = {
    method: method.toUpperCase(),
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': prefer,
      'Accept-Profile': 'teacher',
      'Content-Profile': 'teacher',
    },
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (payload !== null) options.body = JSON.stringify(payload);

  try {
    const res  = await fetch(url, options);
    const text = await res.text();
    if (res.status >= 400) return { error: 'Supabase Error', details: text, status: res.status };
    if (!text) return null; // e.g. a void RPC call, which returns 204 with an empty body on success
    try {
      return JSON.parse(text);
    } catch {
      return { error: 'Parse Error', details: text };
    }
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    return { error: isTimeout ? 'Request timed out' : 'Network Error', details: String(err) };
  }
}

export function castToArray(val) {
  return Array.isArray(val) ? val : (val == null ? [] : [val]);
}

// ── Supabase Storage (REST, service-role key — never exposed client-side) ──
// Used by the Forum photo pipeline. No SDK dependency, same fetch-based
// approach as supabaseRequest above, just hitting /storage/v1 instead of
// /rest/v1.

export async function supabaseStorageUpload(bucket, path, buffer, contentType) {
  const url = `${SB_URL}/storage/v1/object/${bucket}/${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': contentType || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buffer,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { error: 'Storage Upload Error', details: await res.text(), status: res.status };
    return { path };
  } catch (err) {
    return { error: 'Network Error', details: String(err) };
  }
}

export function supabaseStoragePublicUrl(bucket, path) {
  return `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// Large-file path (forum attachments up to 50MB) can't go through the
// base64-in-JSON route the photo pipeline uses — Vercel serverless
// functions cap request bodies around 4.5MB. Instead the server mints a
// short-lived signed upload URL (service-role key, never exposed) and the
// browser PUTs the raw file straight to Supabase Storage via the already-
// loaded Supabase JS client's uploadToSignedUrl(), bypassing our server
// entirely for the actual transfer. The signed token itself authorizes the
// write, so no public bucket-write policy is needed.
export async function supabaseCreateSignedUploadUrl(bucket, path) {
  try {
    const res = await fetch(`${SB_URL}/storage/v1/object/upload/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    if (!res.ok) return { error: 'Storage Sign Error', details: text, status: res.status };
    const data = JSON.parse(text); // { url: "/object/upload/sign/forum/<path>?token=..." }
    const tokenMatch = /token=([^&]+)/.exec(data.url || '');
    return { path, token: tokenMatch ? decodeURIComponent(tokenMatch[1]) : null };
  } catch (err) {
    return { error: 'Network Error', details: String(err) };
  }
}

export async function supabaseStorageRemove(bucket, paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  try {
    const res = await fetch(`${SB_URL}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: paths }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: 'Storage Remove Error', details: await res.text(), status: res.status };
    return { removed: paths.length };
  } catch (err) {
    return { error: 'Network Error', details: String(err) };
  }
}
