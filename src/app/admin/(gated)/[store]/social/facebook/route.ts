import type { NextRequest } from "next/server";

import { FACEBOOK_CONNECTION } from "@/server/facebook-pages";
import { connectionForm } from "@/server/social-connect-routes";

/**
 * The Facebook Page's buttons on Social posts (D870 S1.2b), plain forms posted here (a route, so the screen adds no server action): `connect`, `choose` and
 * `disconnect`, each back to the page with how it went.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/facebook">) {
  return connectionForm(FACEBOOK_CONNECTION, request, (await params).store);
}
