import { connection } from "next/server";

import { recordClick } from "@/server/broadcasts";

/**
 * A press on a link in a broadcast (D297, docs/wave-5-marketing.md 5.5): the link is looked up in the broadcast's own content, so this never sends
 * anyone where the store did not write, its count goes up by one, and the browser goes on to it. Nothing of who pressed is kept: no cookie, no
 * address, no time.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/marketing/c/[broadcast]/[link]">) {
  await connection();
  const { broadcast, link } = await params;
  const market = new URL(request.url).searchParams.get("m");
  const target = await recordClick(broadcast, decodeURIComponent(link), market ? market.toLowerCase().slice(0, 40) : null).catch(() => null);
  if (!target) return new Response("This link is not known.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
