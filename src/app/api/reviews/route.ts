import { connection, NextResponse } from "next/server";
import { z } from "zod";

import { moreReviews } from "@/server/review-facts";
import { resolveFeatureShop } from "@/server/shop";

/**
 * *Show more reviews* (D301 9.5): the next published reviews of one of the store's products after one already shown. Only published words, the
 * same for everyone, so it may be cached briefly; a store without reviews on answers 404.
 */
export async function GET(request: Request): Promise<NextResponse> {
  await connection();
  const url = new URL(request.url);
  const store = url.searchParams.get("store") ?? "";
  const market = url.searchParams.get("market") ?? "";
  const product = url.searchParams.get("product") ?? "";
  const after = url.searchParams.get("after") ?? "";
  if (!z.uuid().safeParse(product).success || !z.uuid().safeParse(after).success || store.length > 80 || market.length > 40) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const shop = await resolveFeatureShop(store, market, "reviews");
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const page = await moreReviews(shop.store.id, product, { id: after });
  return NextResponse.json(page, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}
