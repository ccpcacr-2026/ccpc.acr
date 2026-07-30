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
  async headers() {
    return [
      {
        source: '/app.html',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};
module.exports = nextConfig;
