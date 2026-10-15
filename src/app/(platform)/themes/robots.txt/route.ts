import { themeStoreRobots } from "@/server/seo";

/** The theme store's own host's rules for crawlers (`docs/theme-phase-3.md` step 3), served there as `/robots.txt`; nothing without the host. */
export function GET() {
  const body = themeStoreRobots();
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
