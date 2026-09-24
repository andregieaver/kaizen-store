import { storeSitemap } from "@/server/seo";

/** The store's pages for search engines, in every market it sells to. */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/store-sitemap.xml">) {
  const body = await storeSitemap((await params).store);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
