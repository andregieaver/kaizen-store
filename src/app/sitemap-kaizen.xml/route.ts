import { platformSitemap } from "@/server/seo";

/** Kaizen's own public pages. */
export function GET() {
  return new Response(platformSitemap(), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
