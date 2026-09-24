"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { readContentsForm } from "@/lib/subscription-form";
import { resolveShop } from "@/server/shop";
import { sendSubscriptionChanged } from "@/server/shopper-emails";
import {
  changeSubscription,
  changeSubscriptionContents,
  getSubscriptionByToken,
  type ChangeProblem,
  type ChangeResult,
} from "@/server/subscriptions";

export type SubscriptionActionState = { failed: boolean; problem?: ChangeProblem; saved?: boolean };

async function find(storeSlug: string, marketSlug: string, token: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  const subscription = shop && /^[0-9a-f]{64}$/.test(token) ? await getSubscriptionByToken(shop.store.id, token) : null;
  return shop && subscription ? { storeId: shop.store.id, subscription } : null;
}

function answer(result: ChangeResult): SubscriptionActionState {
  refresh();
  return result.ok ? { failed: false, saved: true } : { failed: true, problem: result.problem };
}

const shopperChange = z.enum(["cancel", "resume", "pause", "unpause", "skip"]);

/**
 * The shopper cancels (at the end of the paid period or commitment), takes
 * it back, pauses, skips or ends a pause (D25, D29). The secret in their
 * link is all it takes, as signing up took no account either: cancelling
 * must be as easy as subscribing.
 */
export async function changeMySubscription(
  storeSlug: string,
  marketSlug: string,
  token: string,
  change: string,
  periods = 1,
): Promise<SubscriptionActionState> {
  const parsed = shopperChange.safeParse(change);
  const found = parsed.success ? await find(storeSlug, marketSlug, token) : null;
  if (!parsed.success || !found) return { failed: true, problem: "not_found" };
  const result = await changeSubscription(found.storeId, found.subscription.id, parsed.data, { periods });
  if (result.ok) await sendSubscriptionChanged(found.storeId, result.subscription, parsed.data);
  return answer(result);
}

/** The shopper swaps variants and changes quantities for the next deliveries (D29). */
export async function changeMyContents(
  storeSlug: string,
  marketSlug: string,
  token: string,
  _state: SubscriptionActionState,
  form: FormData,
): Promise<SubscriptionActionState> {
  const parsed = readContentsForm(form);
  if (!parsed.success) return { failed: true, problem: "invalid" };
  const found = await find(storeSlug, marketSlug, token);
  if (!found) return { failed: true, problem: "not_found" };
  const result = await changeSubscriptionContents(found.storeId, found.subscription.id, parsed.data);
  if (result.ok && result.changed) {
    await sendSubscriptionChanged(found.storeId, result.subscription, "change");
  }
  return answer(result);
}
