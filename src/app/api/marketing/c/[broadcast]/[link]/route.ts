import { connection } from "next/server";

import { recordClick } from "@/server/broadcasts";

/**
 * A press on a link in a broadcast (D297, docs/wave-5-marketing.md 5.5): the link is looked up in the broadcast's own content, so this never sends
 * anyone where the store did not write, its count goes up by one, and the browser goes on to it. A recipient's own link carries their signed
 * reference (`p`, email plan M1.3, D754): while they are on the list the press is kept as theirs. No cookie is set and no address is read.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/marketing/c/[broadcast]/[link]">) {
  await connection();
  const { broadcast, link } = await params;
  const query = new URL(request.url).searchParams;
  const market = query.get("m");
  const target = await recordClick(broadcast, decodeURIComponent(link), market ? market.toLowerCase().slice(0, 40) : null, query.get("p")).catch(() => null);
  if (!target) return new Response("This link is not known.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
