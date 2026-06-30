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
    try {
      const json = JSON.parse(text);
      if (res.status >= 400) return { error: 'Supabase Error', details: text, status: res.status };
      return json;
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
