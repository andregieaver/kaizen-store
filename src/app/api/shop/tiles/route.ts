import { connection } from "next/server";

import { TILE_FACTS_MAX } from "@/lib/shop-tiles";
import { fail, sameSite } from "@/server/chat-route";
import { lockedOut } from "@/server/private-mode";
import { resolveSellingShop } from "@/server/shop";
import { tileFacts } from "@/server/shop-tiles";

/**
 * The facts a page's product tiles show (D556): `?store=&market=&ids=a,b,…` answers each product's stock in words and, when it can be
 * bought from its tile, its variant and quantity rule, with the store's product settings. Never cached, as stock never is; no cookie is
 * read or set. A website (the online shop off) and a private store's locked page answer nothing.
 */
export async function GET(request: Request) {
  await connection();
  if (!sameSite(request)) return fail(403, "Tiles are for the site's own pages.");
  const url = new URL(request.url);
  const store = url.searchParams.get("store") ?? "";
  const market = url.searchParams.get("market") ?? "";
  const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, TILE_FACTS_MAX);
  if (!store || !market || ids.length === 0) return fail(400, "Name the store, the market and the products.");
  const shop = await resolveSellingShop(store, market);
  if (!shop || (await lockedOut(shop.store))) return fail(404, "No such store.");
  // The chooser is drawn as the store's product pages draw it: − and + unless the store chose the number alone.
  const answer = await tileFacts(shop.store.id, shop.market, ids, shop.store.quantityPicker !== "box");
  return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
}
