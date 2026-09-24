import { shareCard } from "@/lib/share-card";
import { getPlatformSeo, PLATFORM_DEFAULTS } from "@/server/seo";

/** Kaizen's share picture when no other is chosen. */
export async function GET() {
  const seo = await getPlatformSeo();
  return shareCard(seo.title.en || PLATFORM_DEFAULTS.title, "Online stores for Norway and the EU");
}
