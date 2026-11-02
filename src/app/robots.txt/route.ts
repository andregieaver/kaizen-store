import { connection } from "next/server";

import { siteRobots } from "@/server/seo";

/**
 * Rules for crawlers: Kaizen's, then each store's under its address (D21). Made at each request, never prerendered: what every store
 * closes to AI crawlers is read in two queries for all of them (`closedToAiOf()`), uncached, so a page closed or opened shows at once.
 */
export async function GET() {
  await connection();
  return new Response(await siteRobots(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
