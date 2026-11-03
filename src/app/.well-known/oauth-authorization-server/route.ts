import { connection } from "next/server";

import { authorizationServerMetadata } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";

/** Kaizena Flow's authorization server metadata (RFC 8414, D439): its issuer is the site's origin. Public, cached an hour, any origin. */
export async function GET() {
  await connection();
  return Response.json(authorizationServerMetadata(siteUrl()), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
