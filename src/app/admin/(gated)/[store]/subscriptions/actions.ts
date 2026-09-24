"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireMember } from "@/server/auth";
import { changeSubscription, type SubscriptionChange } from "@/server/subscriptions";

export type StaffSubscriptionState = { failed: boolean };

/** Staff cancel a subscription (at the period's end or at once), or take a cancellation back. */
export async function changeSubscriptionAction(
  storeSlug: string,
  subscriptionId: string,
  change: SubscriptionChange,
): Promise<StaffSubscriptionState> {
  const { store } = await requireMember(storeSlug);
  if (!z.uuid().safeParse(subscriptionId).success) return { failed: true };
  const ok = await changeSubscription(store.id, subscriptionId, change);
  refresh();
  return { failed: !ok };
}
