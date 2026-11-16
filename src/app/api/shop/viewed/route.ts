import { connection } from "next/server";

import { sameSite } from "@/lib/same-site";
import { recordProductView } from "@/server/product-views";
import { resolveSellingShop } from "@/server/shop";

/**
 * A product page seen by a visitor who allowed marketing cookies (D691, browse abandonment): `{ store, market, product }`, POST only, from the
 * site's own pages, at most 300 bytes. `recordProductView()` keeps it only for a signed-in customer subscribed to the store's emails, never
 * with Global Privacy Control or Do Not Track. Always an empty 204 that is never cached, kept or not, so a script learns nothing from it.
 */

const MAX_BYTES = 300;
const quiet = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return quiet();
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (typeof body.store !== "string" || typeof body.market !== "string") return quiet();
  const shop = await resolveSellingShop(body.store, body.market);
  if (shop) await recordProductView(shop.store.id, body.product, request.headers);
  return quiet();
}
