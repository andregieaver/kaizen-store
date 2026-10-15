import { themeStoreSitemap } from "@/server/seo";

/** The theme store's own host's sitemap (`docs/theme-phase-3.md` step 3), served there as `/sitemap.xml`; nothing without the host. */
export async function GET() {
  const body = await themeStoreSitemap();
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
