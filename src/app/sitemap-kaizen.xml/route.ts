import { platformSitemap } from "@/server/seo";

/** Kaizen's own public pages. */
export async function GET() {
  return new Response(await platformSitemap(), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
