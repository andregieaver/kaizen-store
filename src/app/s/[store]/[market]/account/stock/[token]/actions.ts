"use server";

import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { resolveAfterSaleShop } from "@/server/shop";
import { confirmStockRequest } from "@/server/stock-requests";

/** The confirm page's button (D298, 6.4): the request waits for stock, once, while its link works. */
export async function confirmStockAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  const done = shop ? await confirmStockRequest(shop.store.id, token) : false;
  redirect(`${marketPath(storeSlug, marketSlug, `/account/stock/${token}`)}${done ? "?done=1" : ""}`);
}
