"use server";

import { refresh } from "next/cache";

import { confirmRequestByLink } from "@/server/request-confirm";
import { resolveAfterSaleShop } from "@/server/shop";

/**
 * *Confirm* on a request's page (B3, D685): thin, the shop as the page resolves it, then `confirmRequestByLink()`, which finds the request by its
 * own token among the store's and confirms it once, within the link's hours. The page is drawn afresh and says what came of it.
 */
export async function confirmRequestAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop || typeof token !== "string") return;
  await confirmRequestByLink(shop.store.id, token);
  refresh();
}
