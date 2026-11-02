import { connection } from "next/server";

import { storeDomain } from "@/lib/paths";
import { siteRobots } from "@/server/seo";

/**
 * Rules for crawlers: Kaizen's, then each store's under its address (D21). Where stores have hosts of their own (P7) it holds Kaizen's
 * rules alone and is prerendered; where it holds every store's, it is made at each request: what every store closes to AI crawlers is
 * read in two queries for all of them (`closedToAiOf()`), uncached, so a page closed or opened shows at once.
 */
export async function GET() {
  if (!storeDomain()) await connection();
  return new Response(await siteRobots(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
