import { connection } from "next/server";

import { FONT_SLUG } from "@/lib/fonts";
import { fontCss } from "@/server/fonts";

/** What a family Kaizen has no stylesheet for is answered with. */
const NONE = "/* Not installed: the fallback font shows. */\n";

const stylesheet = (css: string, cacheControl: string) =>
  new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": cacheControl } });

/**
 * An installed family's stylesheet (D59): `@font-face` rules pointing at
 * Kaizen's copies of its files, and the class that sets it. A family's
 * stylesheet never changes once installed, so the CDN and browsers keep it for a year (`immutable`); a change to how it is
 * written gives it a new address (`FONT_CSS_VERSION` in `fontCssHref()`).
 *
 * A family Kaizen has no stylesheet for (never installed, kept empty, or the database not answering) gets an empty one, kept
 * for a moment only, never a 404: React holds a streamed `<Suspense>` boundary until the stylesheets `FontLinks` adds have
 * loaded, and a failed one makes it give the boundary up and draw it again in the browser. A missing font is only the fallback.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/fonts/css/[slug]">) {
  await connection();
  const { slug } = await params;
  if (!FONT_SLUG.test(slug)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  let css: string | null;
  try {
    css = await fontCss(slug);
  } catch (error) {
    console.error(`[fonts] reading the stylesheet of ${slug} failed:`, error instanceof Error ? error.message : error);
    return stylesheet(NONE, "no-store");
  }
  if (!css) return stylesheet(NONE, "public, max-age=60, s-maxage=60");
  return stylesheet(css, "public, max-age=31536000, s-maxage=31536000, immutable");
}
