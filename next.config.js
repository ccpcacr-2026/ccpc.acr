/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/': ['./public/app.html']
  },
  // app/route.js already serves "/" with Cache-Control: no-store, but
  // /app.html itself is ALSO reachable directly as a static public/ file —
  // that path bypasses the custom route entirely and got Vercel's default
  // static-asset caching (observed: Age 300+s, X-Vercel-Cache: HIT), so a
  // freshly deployed app.html (with its own updated ?v= references to
  // app.js/styles.css) could sit unserved behind a stale cached copy for
  // minutes after a push. Same no-store treatment, explicitly, for the
  // static path too.
  //
  // admission-print-templates.js and admission-form-designer.js are lazy-
  // loaded the same unversioned way (plain `<script src="/foo.js">`, no
  // ?v= cache-bust — see _ensureAdmissionPrintTemplates/_ensureAdmission-
  // FormDesigner in _src/app.js), so they're exposed to the exact same
  // stale-edge-cache bug: a deploy can land while these two keep being
  // served from a cached copy that predates it. Same fix.
  async headers() {
    return [
      {
        source: '/app.html',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/admission-print-templates.js',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/admission-form-designer.js',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};
module.exports = nextConfig;
