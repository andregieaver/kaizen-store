"use server";

import { refresh } from "next/cache";

import { resolveShop } from "@/server/shop";
import { changeSubscription, getSubscriptionByToken } from "@/server/subscriptions";

export type SubscriptionActionState = { failed: boolean };

/**
 * The shopper cancels (at the end of the paid period) or keeps their
 * subscription. The secret in their link is all it takes, as signing up
 * took no account either: cancelling must be as easy as subscribing.
 */
export async function changeMySubscription(
  storeSlug: string,
  marketSlug: string,
  token: string,
  change: "cancel" | "resume",
): Promise<SubscriptionActionState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const subscription = shop && /^[0-9a-f]{64}$/.test(token) ? await getSubscriptionByToken(shop.store.id, token) : null;
  if (!shop || !subscription) return { failed: true };
  const ok = await changeSubscription(shop.store.id, subscription.id, change);
  refresh();
  return { failed: !ok };
}
