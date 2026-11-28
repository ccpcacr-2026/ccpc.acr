export const dynamic = 'force-dynamic';

export async function GET(req, context) {
  const params = await context.params;
  const code = encodeURIComponent(String((params && params.code) || '').trim());
  const inUrl = new URL(req.url);
  const target = new URL('/seat/' + code + inUrl.search, req.url);
  return Response.redirect(target, 307);
}
