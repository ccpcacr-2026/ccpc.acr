/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    '/': ['./public/app.html']
  }
};
module.exports = nextConfig;
