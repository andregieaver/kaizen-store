import { connection } from "next/server";

import { fontCss } from "@/server/fonts";

/**
 * An installed family's stylesheet (D59): `@font-face` rules pointing at
 * Kaizen's copies of its files, and the class that sets it. A family's
 * stylesheet never changes once installed, so the CDN keeps it.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/fonts/css/[slug]">) {
  await connection();
  const css = await fontCss((await params).slug);
  if (!css) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(css, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=604800",
    },
  });
}
