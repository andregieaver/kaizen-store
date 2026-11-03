import { docsSitemap } from "@/lib/docs-text";
import { docsIndex } from "@/server/docs";

/**
 * The docs' sitemap (D442): every page in each language it is written in. Served as `/sitemap.xml` on the docs' own host; without one, at
 * `/docs/sitemap.xml`, which Kaizena Flow's sitemap index names (`sitemapIndex()`), as a sitemap lists only its own host's addresses.
 */
export function GET() {
  return new Response(docsSitemap(docsIndex()), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
