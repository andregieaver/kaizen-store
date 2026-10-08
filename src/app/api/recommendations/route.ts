import { connection } from "next/server";

import { recommendRequest } from "@/lib/recommendations";
import { visitorKey } from "@/server/chat-agent";
import { fail, sameSite } from "@/server/chat-route";
import { recommendFor } from "@/server/recommend";
import { takeRecommendRequest } from "@/server/recommend-events";
import { resolveSellingShop } from "@/server/shop";

/**
 * A page's request for recommendations (D139): where the grid is, what it asks for, and what the shopper's tab remembers
 * (the products looked at and the searches made). The cart, wishlist, account and the orders placed from the device are
 * read from the request's own cookies. Nothing of the session is kept; what comes back is the products as the site
 * shows them, with the reason under each.
 */
export async function POST(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "Recommendations are for the site's own pages.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 8_000) return fail(413, "That request is too long.");
    body = JSON.parse(text);
  } catch {
    return fail(400, "That request could not be read.");
  }
  const parsed = recommendRequest.safeParse(body);
  if (!parsed.success) return fail(400, "That request could not be read.");
  // A website (D178 step 5: the online shop off) recommends nothing: the store is not there for this.
  const shop = await resolveSellingShop(parsed.data.store, parsed.data.market);
  if (!shop) return fail(404, "No such store.");
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!(await takeRecommendRequest(shop.store.id, visitorKey(address), "ask"))) return fail(429, "Too many requests. Try again in a moment.");
  try {
    const { items, arm, placement } = await recommendFor(shop.store, shop.market, parsed.data);
    return Response.json({ items, arm, placement }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn(`[recommend] ${shop.store.slug}: ${error instanceof Error ? error.message : String(error)}`);
    return fail(503, "Recommendations are not available just now.");
  }
}
