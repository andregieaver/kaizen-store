import { EXTENSION_NAMES, type ExtensionId } from "./extensions";
import type { PlanInterval } from "./plans";

/**
 * An account's one subscription (D748 step E4 part two, `docs/extensions.md` 13), pure: what it may hold, how a change becomes Stripe's item
 * changes, and which bought extensions end when the subscription changes. Prices and Stripe live in `src/server/account-billing.ts`.
 */

/** Days an ended trial or a stopped payment keeps everything running before read-only (section 3 of the spec). */
export const GRACE_DAYS = 14;

export type WantedPrice = { id: string; currency: string; interval: PlanInterval };
export type WantedExtension = WantedPrice & { extensionId: ExtensionId };

/**
 * Why a subscription with this plan price and these extension prices cannot be made, or none: something is chosen, one currency and one
 * interval for all of it (one invoice), each extension once, and never an extension the plan already includes (it is never charged twice).
 */
export function itemProblems(plan: WantedPrice | null, extensions: readonly WantedExtension[], included: readonly ExtensionId[]): string[] {
  const all = [...(plan ? [plan] : []), ...extensions];
  if (all.length === 0) return ["Choose a plan or an extension."];
  const problems: string[] = [];
  if (new Set(all.map((p) => p.currency)).size > 1) problems.push("Everything on the account's plan is billed in one currency.");
  if (new Set(all.map((p) => p.interval)).size > 1) problems.push("Everything on the account's plan is billed monthly or yearly, not both.");
  const seen = new Set<ExtensionId>();
  for (const e of extensions) {
    if (seen.has(e.extensionId)) problems.push(`${EXTENSION_NAMES[e.extensionId]} is chosen twice.`);
    seen.add(e.extensionId);
    if (plan && included.includes(e.extensionId)) problems.push(`${EXTENSION_NAMES[e.extensionId]} is in the plan already.`);
  }
  return problems;
}

/** One item of a running subscription: Stripe's item id and the Stripe price it bills. */
export type RunningItem = { id: string; price: string };

/**
 * Stripe's item changes that turn a running subscription's items into the wanted Stripe prices: an item already billing a wanted price is
 * kept as it is (no new proration), each other wanted price is added, and every item no longer wanted is deleted.
 */
export function itemChanges(running: readonly RunningItem[], wanted: readonly string[]): ({ id: string; deleted: true } | { price: string })[] {
  const left = [...wanted];
  const deleted: { id: string; deleted: true }[] = [];
  for (const item of running) {
    const at = left.indexOf(item.price);
    if (at >= 0) left.splice(at, 1);
    else deleted.push({ id: item.id, deleted: true });
  }
  return [...deleted, ...left.map((price) => ({ price }))];
}

/** Stripe's statuses in which a subscription still pays for what it holds (`past_due` is Stripe's own dunning, not yet stopped). */
const PAYING = ["trialing", "active", "past_due"];

/**
 * Which extensions the account bought on its subscription end now: every bought one when the subscription no longer pays (cancelled,
 * unpaid, expired), else those no longer among its items. Bought rows only: a trial or a bundle ends by its own rules.
 */
export function endedExtensions(bought: readonly ExtensionId[], onSubscription: readonly ExtensionId[], status: string): ExtensionId[] {
  if (!PAYING.includes(status)) return [...bought];
  return bought.filter((id) => !onSubscription.includes(id));
}
