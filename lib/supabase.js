const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function supabaseRequest(endpoint, method = 'get', payload = null) {
  const url = `${SB_URL}/rest/v1/${endpoint}`;
  const options = {
    method: method.toUpperCase(),
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (payload !== null) options.body = JSON.stringify(payload);

  const res  = await fetch(url, options);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (res.status >= 400) return { error: 'Supabase Error', details: text, status: res.status };
    return json;
  } catch {
    return { error: 'Parse Error', details: text };
  }
}

export function castToArray(val) {
  return Array.isArray(val) ? val : (val == null ? [] : [val]);
}
