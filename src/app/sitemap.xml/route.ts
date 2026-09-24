import { sitemapIndex } from "@/server/seo";

/** The sitemap index: Kaizen's pages and each open store's sitemap. */
export async function GET() {
  return new Response(await sitemapIndex(), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
