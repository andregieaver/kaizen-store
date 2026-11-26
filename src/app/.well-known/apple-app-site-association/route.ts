import { connection } from "next/server";

import { appLinksEnv } from "@/lib/env";
import { appleAppSiteAssociation } from "@/lib/native-app";

/**
 * Which of the site's links open the phone app on an iPhone (Universal Links, D908): Apple's servers read this file (JSON, no extension,
 * never a redirect) when the app is installed, and only then hand `/auth/confirm` links to the app. 404 while `APPLE_TEAM_ID` is empty.
 */
export async function GET() {
  await connection();
  const { appleTeamId } = appLinksEnv();
  if (!appleTeamId) return new Response(null, { status: 404 });
  return Response.json(appleAppSiteAssociation(appleTeamId), { headers: { "Cache-Control": "public, max-age=3600" } });
}
