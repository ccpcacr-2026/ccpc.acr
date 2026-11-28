export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL('/seat', req.url);
  return Response.redirect(url, 307);
}
