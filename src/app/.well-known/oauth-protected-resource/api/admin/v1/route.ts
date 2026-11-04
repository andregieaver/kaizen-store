import { connection } from "next/server";

import { APP_SCOPES } from "@/lib/apps";
import { adminProtectedResourceMetadata } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";

/** The Admin API's protected resource metadata (RFC 9728 3.1, D441): where an app's installation gets its tokens, and what it may hold. */
export async function GET() {
  await connection();
  return Response.json(adminProtectedResourceMetadata(siteUrl(), APP_SCOPES), {
    headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
