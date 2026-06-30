# CCPC Faculty Portal — Vercel Edition

Migrated from Google Apps Script to Next.js + Vercel.

## Setup (5 steps)

### 1. Add environment variables
Copy `.env.example` to `.env.local` and fill in:
```
SUPABASE_URL=https://wugeppgvmcmsnetksies.supabase.co
SUPABASE_SERVICE_KEY=<your service role key>
```

### 2. Install & run locally
```bash
npm install
npm run dev
# Open http://localhost:3000
```

### 3. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/ccpc-portal.git
git push -u origin main
```

### 4. Deploy to Vercel
1. Go to vercel.com → New Project → Import your GitHub repo
2. In **Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
3. Click **Deploy**

### 5. Supabase Storage (for photo upload)
Create a bucket named `faculty-photos` in Supabase Storage and set it to **public**.

---

## What changed from Google Apps Script

| Before (GAS) | After (Vercel) |
|---|---|
| `Code.gs` backend | `app/api/exec/route.js` |
| `google.script.run.fn()` | `shim.js` intercepts → `POST /api/exec` |
| `HtmlService` serving pages | `app/route.js` serves `public/app.html` |
| View HTML via `getViewContent()` | Static files in `public/views/` |
| Script Properties secrets | Vercel environment variables |
| Google Drive photo upload | Supabase Storage |

No changes to the UI or business logic — only the transport layer changed.
