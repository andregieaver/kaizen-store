import { connection } from "next/server";

import { adminManifest } from "@/lib/admin-sw";
import { getPlatformFavicon } from "@/server/platform-navigation";

/** The admin's web app manifest (D361), with Kaizena Flow's own icon. */
export async function GET() {
  await connection();
  return Response.json(adminManifest(await getPlatformFavicon()), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
