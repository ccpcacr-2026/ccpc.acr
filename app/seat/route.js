export const dynamic = 'force-dynamic';

export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>3D Exam Seat Finder — CCPC</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100vh; background: linear-gradient(135deg,#0f172a 0%,#1e3a8a 55%,#0f766e 100%); color: #0f172a; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 24px; max-width: 440px; width: 100%; padding: 32px 26px; box-shadow: 0 25px 60px rgba(0,0,0,0.35); text-align: center; }
    .badge { display: inline-block; padding: 5px 12px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 11px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; margin-bottom: 12px; }
    h1 { font-size: 22px; font-weight: 900; color: #0f172a; margin-bottom: 6px; }
    p { font-size: 13px; color: #64748b; margin-bottom: 22px; line-height: 1.5; }
    input { width: 100%; padding: 14px 16px; border: 2px solid #e2e8f0; border-radius: 14px; font-size: 16px; font-weight: 700; text-align: center; font-family: monospace; outline: none; margin-bottom: 12px; }
    input:focus { border-color: #2563eb; }
    button { width: 100%; padding: 14px; border: none; border-radius: 14px; background: linear-gradient(135deg,#2563eb,#1d4ed8); color: #fff; font-size: 14px; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase; cursor: pointer; }
    button:hover { filter: brightness(1.08); }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">CCPC 3D Seat Finder</div>
    <h1>Find Your Exam Hall &amp; Seat</h1>
    <p>Enter your <b>Index ID</b> or <b>Tracking ID</b> to view your 3D guided route to the exam hall and exact seat placement.</p>
    <form onsubmit="event.preventDefault(); var v=document.getElementById('cid').value.trim(); if(v) location.href='/seat/'+encodeURIComponent(v);">
      <input id="cid" type="text" placeholder="e.g. 3001 or Tracking ID" required autofocus>
      <button type="submit">🧭 View My 3D Seat</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
