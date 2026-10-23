"use server";

import { headers } from "next/headers";

import { visitorKey } from "@/server/chat-agent";
import { takeBudget } from "@/server/request-budget";
import { resolveSellingShop } from "@/server/shop";
import { suggestProducts, type Suggestion } from "@/server/search";

/** Type-ahead (Phase 2, S1): a few products as the shopper types, keyword only. */
export async function suggestAction(storeSlug: string, marketSlug: string, query: string): Promise<Suggestion[]> {
  if (typeof query !== "string" || query.length > 200) return [];
  const shop = await resolveSellingShop(storeSlug, marketSlug);
  if (!shop) return [];
  // A ceiling against abuse (D314): past it, type-ahead simply suggests nothing; the search page itself is never limited.
  const asked = await headers();
  const address = asked.get("x-forwarded-for")?.split(",")[0]?.trim() || asked.get("x-real-ip") || "unknown";
  if (!(await takeBudget(shop.store.id, "suggest", visitorKey(address)))) return [];
  return suggestProducts({ storeId: shop.store.id, market: shop.market }, query);
}
