import { connection } from "next/server";

import { FEED_EXTENSION, feedFile, parseFeedFile } from "@/lib/feeds";
import { marketUrl } from "@/lib/paths";
import { featureOn } from "@/lib/store-features";
import { feedTokenHash, storeOfFeedToken } from "@/server/feed-settings";
import { storeFeed } from "@/server/feeds";
import { takeBudget } from "@/server/request-budget";
import { offeredMarketIn } from "@/server/shop";
import { getStore } from "@/server/stores";

/**
 * A store's product feed (D302, `docs/wave-5-marketing.md` 13): `/api/feeds/{token}/{market}-{channel}.{xml|csv}`, for Google Merchant Center,
 * Meta, TikTok and Pinterest to fetch. The token is the only key: anything that is not an open store's feed while it is on is a plain 404.
 * Cached for 15 minutes, the stated refresh time, and limited per address by `takeBudget()`.
 */
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

export async function GET(_request: Request, { params }: RouteContext<"/api/feeds/[token]/[file]">) {
  await connection();
  const { token, file } = await params;
  const name = parseFeedFile(file);
  if (!name) return notFound();
  const owner = await storeOfFeedToken(token);
  if (!owner) return notFound();
  const store = await getStore(owner.slug);
  if (!store || store.status !== "active" || store.isTemplate || store.starter || !featureOn(store, "shop")) return notFound();
  const market = offeredMarketIn(store, name.market);
  if (!market || market.slug !== name.market) return notFound();
  if (!(await takeBudget(store.id, "feed", feedTokenHash(token).slice(0, 16)))) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } });
  }
  const { items } = await storeFeed(store, market);
  const body = feedFile(name.channel, items, { title: store.name, link: marketUrl(store.slug, market.slug, "", store.address) });
  return new Response(body, {
    headers: {
      "Content-Type": FEED_EXTENSION[name.channel] === "xml" ? "application/xml; charset=utf-8" : "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
