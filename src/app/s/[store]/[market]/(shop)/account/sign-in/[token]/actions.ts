"use server";

import { redirect } from "next/navigation";

import { marketPath } from "@/lib/paths";
import { consumeSignInLink } from "@/server/companies";
import { startSession } from "@/server/customers";
import { resolveShop } from "@/server/shop";

/** Signs in with an emailed one-time link, from the button on the page it opens, so a mail scanner opening the link does not spend it. */
export async function signInWithLinkAction(storeSlug: string, marketSlug: string, token: string): Promise<void> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) redirect(marketPath(storeSlug, marketSlug, "/account"));
  const customerId = await consumeSignInLink(shop.store.id, token);
  if (!customerId) redirect(marketPath(shop.store.slug, shop.market.slug, `/account/sign-in/${encodeURIComponent(token)}`));
  await startSession(shop.store.id, customerId);
  redirect(marketPath(shop.store.slug, shop.market.slug, "/account"));
}
