"use server";

import { resolveSellingShop } from "@/server/shop";
import { suggestProducts, type Suggestion } from "@/server/search";

/** Type-ahead (Phase 2, S1): a few products as the shopper types, keyword only. */
export async function suggestAction(storeSlug: string, marketSlug: string, query: string): Promise<Suggestion[]> {
  if (typeof query !== "string" || query.length > 200) return [];
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return [];
  return suggestProducts({ storeId: shop.store.id, market: shop.market }, query);
}
