"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { readContentsForm } from "@/lib/subscription-form";
import { requireMember } from "@/server/auth";
import { sendSubscriptionChanged } from "@/server/shopper-emails";
import {
  changeSubscription,
  changeSubscriptionContents,
  type ChangeProblem,
  type SubscriptionChange,
} from "@/server/subscriptions";

export type StaffSubscriptionState = { failed: boolean; problem?: ChangeProblem; saved?: boolean };

const staffChange = z.enum(["cancel", "resume", "cancel_now", "pause", "unpause", "skip"]);

/**
 * Staff cancel a subscription (at the period's or commitment's end, or at
 * once), take a cancellation back, pause, skip or end a pause. The
 * subscriber is told by email.
 */
export async function changeSubscriptionAction(
  storeSlug: string,
  subscriptionId: string,
  change: SubscriptionChange,
  periods = 1,
): Promise<StaffSubscriptionState> {
  const { store } = await requireMember(storeSlug);
  const parsed = staffChange.safeParse(change);
  if (!parsed.success || !z.uuid().safeParse(subscriptionId).success) return { failed: true, problem: "invalid" };
  const result = await changeSubscription(store.id, subscriptionId, parsed.data, { periods, actor: "staff" });
  if (result.ok) await sendSubscriptionChanged(store.id, result.subscription, parsed.data);
  refresh();
  return result.ok ? { failed: false, saved: true } : { failed: true, problem: result.problem };
}

/** Staff swap variants and change quantities for the next deliveries (D29). */
export async function changeContentsAction(
  storeSlug: string,
  subscriptionId: string,
  _state: StaffSubscriptionState,
  form: FormData,
): Promise<StaffSubscriptionState> {
  const { store } = await requireMember(storeSlug);
  const parsed = readContentsForm(form);
  if (!parsed.success || !z.uuid().safeParse(subscriptionId).success) return { failed: true, problem: "invalid" };
  const result = await changeSubscriptionContents(store.id, subscriptionId, parsed.data, { actor: "staff" });
  if (result.ok && result.changed) await sendSubscriptionChanged(store.id, result.subscription, "change");
  refresh();
  return result.ok ? { failed: false, saved: true } : { failed: true, problem: result.problem };
}
