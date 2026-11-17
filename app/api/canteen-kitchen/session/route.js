export const dynamic = 'force-dynamic';

import { readKitchenSession } from '../../../../lib/canteen-kitchen-auth';

export async function GET(request) {
  const counter = readKitchenSession(request);
  return Response.json({ authed: counter != null, counter_no: counter });
}
