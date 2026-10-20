"use server";

import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { confirmSubscription } from "@/server/marketing-subscribers";
import { resolveAfterSaleShop } from "@/server/shop";

/** The confirm page's button (D295): the waiting address is subscribed to this store's emails, once, while its link works. */
export async function confirmNewsAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  const done = shop ? await confirmSubscription(shop.store.id, token) : false;
  redirect(`${marketPath(storeSlug, marketSlug, `/account/news/${token}`)}${done ? "?done=1" : ""}`);
}
