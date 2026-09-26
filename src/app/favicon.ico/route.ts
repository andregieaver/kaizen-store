import { connection } from "next/server";

import { faviconRedirect } from "@/lib/site-icons";
import { getPlatformFavicon } from "@/server/platform-navigation";

/** For browsers that ask for `/favicon.ico` without reading the page: Kaizen's icon (D62). */
export async function GET() {
  // Answered per request: prerendered, the redirect would be lost and the body empty.
  await connection();
  return faviconRedirect(await getPlatformFavicon());
}
