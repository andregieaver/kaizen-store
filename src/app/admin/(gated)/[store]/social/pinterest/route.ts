import type { NextRequest } from "next/server";

import { PINTEREST_CONNECTION } from "@/server/pinterest";
import { connectionForm } from "@/server/social-connect-routes";

/**
 * The Pinterest account's buttons on Social posts (D870 S3.4), plain forms posted here (a route, so the screen adds no server action): `connect`, `choose` and
 * `disconnect`, each back to the page with how it went.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/pinterest">) {
  return connectionForm(PINTEREST_CONNECTION, request, (await params).store);
}
