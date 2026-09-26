import { faviconRedirect } from "@/lib/site-icons";
import { getPlatformFavicon } from "@/server/platform-navigation";

/** For browsers that ask for `/favicon.ico` without reading the page: Kaizen's icon (D62). */
export async function GET() {
  return faviconRedirect(await getPlatformFavicon());
}
