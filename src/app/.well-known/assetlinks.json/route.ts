import { connection } from "next/server";

import { appLinksEnv } from "@/lib/env";
import { assetLinks } from "@/lib/native-app";

/**
 * Which Android app may open the site's links (App Links, D908): Android reads this file when the app is installed and checks the app's
 * signing key against these fingerprints before it hands `/auth/confirm` links to it. 404 while `ANDROID_APP_SHA256` is empty.
 */
export async function GET() {
  await connection();
  const { androidFingerprints } = appLinksEnv();
  if (androidFingerprints.length === 0) return new Response(null, { status: 404 });
  return Response.json(assetLinks(androidFingerprints), { headers: { "Cache-Control": "public, max-age=3600" } });
}
