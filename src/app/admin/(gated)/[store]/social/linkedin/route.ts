import type { NextRequest } from "next/server";

import { LINKEDIN_CONNECTION } from "@/server/linkedin";
import { connectionForm } from "@/server/social-connect-routes";

/**
 * LinkedIn's buttons on Social posts (D870 S3.6), plain forms posted here (a route, so the screen adds no server action): `connect`, `choose`
 * (the profile or a Page) and `disconnect`, each back to the page with how it went.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/linkedin">) {
  return connectionForm(LINKEDIN_CONNECTION, request, (await params).store);
}
