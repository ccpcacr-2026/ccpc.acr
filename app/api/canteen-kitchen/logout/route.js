export const dynamic = 'force-dynamic';

import { clearCookieHeader } from '../../../../lib/canteen-kitchen-auth';

export async function POST() {
  return Response.json({ success: true }, {
    headers: { 'Set-Cookie': clearCookieHeader('kitchen_session') },
  });
}
