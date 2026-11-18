"use server";

import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { resolveAfterSaleShop } from "@/server/shop";
import { cancelStockRequest, confirmStockRequest } from "@/server/stock-requests";

/** The confirm page's button (D298, 6.4): the request waits for stock, once, while its link works. */
export async function confirmStockAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  const done = shop ? await confirmStockRequest(shop.store.id, token) : false;
  redirect(`${marketPath(storeSlug, marketSlug, `/account/stock/${token}`)}${done ? "?done=1" : ""}`);
}

/** The cancel page's button (D392): the request stops while it waits; the page then says so, or that the link no longer works. */
export async function cancelStockAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  const done = shop ? await cancelStockRequest(shop.store.id, token) : false;
  redirect(`${marketPath(storeSlug, marketSlug, `/account/stock/${token}`)}?cancel=1${done ? "&done=1" : ""}`);
}
