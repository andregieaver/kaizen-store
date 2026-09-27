import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { marketPath } from "@/lib/paths";
import { recordClick } from "@/server/search-experiment";
import { resolveShop } from "@/server/shop";

const HANDLE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A search result's link (D77): records which result of which search was
 * opened, then opens the product. It sets and reads no cookie. A link that
 * does not name one of the store's searches and products just opens the
 * product, or the search page.
 */
export async function GET(request: Request, { params }: RouteContext<"/s/[store]/[market]/search/go">) {
  await connection();
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const searchId = url.searchParams.get("s") ?? "";
  const handle = url.searchParams.get("p") ?? "";
  const position = Number(url.searchParams.get("r"));
  const base = marketPath(shop.store.slug, shop.market.slug);
  if (!HANDLE.test(handle) || handle.length > 80) redirect(`${base}/search`);
  if (z.uuid().safeParse(searchId).success && Number.isInteger(position)) {
    await recordClick(shop.store.id, searchId, handle, position);
  }
  redirect(`${base}/p/${handle}`);
}
