import type { NextRequest } from "next/server";

import { connectionForm } from "@/server/social-connect-routes";
import { TIKTOK_CONNECTION } from "@/server/tiktok";

/**
 * The TikTok account's buttons on Social posts (D870 S3.5), plain forms posted here (a route, so the screen adds no server action): `connect`
 * and `disconnect`, each back to the page with how it went.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/tiktok">) {
  return connectionForm(TIKTOK_CONNECTION, request, (await params).store);
}
