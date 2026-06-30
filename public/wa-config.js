// WhatsApp config is loaded from the server at runtime — not stored here
(async function () {
  try {
    const r = await fetch('/api/config');
    const c = await r.json();
    window.WA_SERVER_URL = c.waServerUrl || 'http://localhost:3001';
    window.WA_API_KEY    = c.waApiKey    || '';
  } catch {
    window.WA_SERVER_URL = 'http://localhost:3001';
    window.WA_API_KEY    = '';
  }
})();
