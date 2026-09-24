import { siteRobots } from "@/server/seo";

/** Rules for crawlers: Kaizen's, then each store's under its address (D21). */
export async function GET() {
  return new Response(await siteRobots(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
