import "server-only";

import { mainCurrency } from "@/lib/markets";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { replacementCapProblem } from "@/lib/replacements";

import type { Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { replacementPlan, sendReplacement, type ReplacementRefusal } from "./replacements";
import type { Store } from "./stores";

/**
 * The AI manager's `send_replacement` (B3, D679, `src/server/replacements.ts`): a lost or returned parcel's goods sent again as an order at 0. Always on
 * the owner's yes, except in challenge mode within the cap on the goods' value (`replacementAutopilotProblem()`).
 */

type Ctx = { account: Account; store: Store };

const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");

const REFUSED: Record<ReplacementRefusal, (ref: string) => string> = {
  not_found: (ref) => `No order ${ref} in this store.`,
  not_paid: (ref) => `Order ${ref} is not paid, so nothing of it was sent.`,
  copied: (ref) => `Order ${ref} was copied from another shop's history: it was not sent from here.`,
  no_trouble: (ref) => `No parcel of order ${ref} has tracking that says it is lost or on its way back. A missed delivery is tried again by the carrier.`,
  nothing_to_send: (ref) => `The parcel of order ${ref} holds no product with stock to send again.`,
};

/** The plan, or the reason there is none, as a tool error. */
async function planOf(store: Store, ref: string) {
  const plan = await replacementPlan(store.id, ref);
  if ("refused" in plan) throw new OwnerToolError(REFUSED[plan.refused](ref));
  if (plan.replacement) throw new OwnerToolError(`Order ${plan.number} was already sent again as order ${plan.replacement.number}.`);
  return plan;
}

export async function preflightSendReplacement(ctx: Ctx, { order }: { order: string }): Promise<void> {
  await planOf(ctx.store, order);
}

/**
 * Why the autopilot keeps the replacement for the owner in challenge mode, or null when it may send it (`replacementCapProblem()`): the goods' value as
 * the customer paid for them, against the challenge's cap in the main currency. One that cannot be sent at all asks too, with the reason.
 */
export async function replacementAutopilotProblem(store: Store, ref: string, capMajor: number | null): Promise<string | null> {
  const main = mainCurrency(store);
  let plan;
  try {
    plan = await planOf(store, ref);
  } catch (error) {
    if (error instanceof OwnerToolError) return error.message;
    throw error;
  }
  return replacementCapProblem({
    valueMinor: plan.valueMinor,
    currency: plan.currency,
    mainCurrency: main,
    capMinor: capMajor === null ? null : Math.round(capMajor * 10 ** minorUnitDigits(main)),
    money: (minor) => money(minor, main),
  });
}

/** `send_replacement`: the order at 0 made, its stock drawn, both orders' histories naming each other. */
export async function sendReplacementTool(ctx: Ctx, { order }: { order: string }) {
  const plan = await planOf(ctx.store, order);
  const done = await sendReplacement(ctx.store.id, ctx.account.id, plan.orderId);
  if (!done.ok) {
    if (done.reason === "already") throw new OwnerToolError(`Order ${plan.number} was already sent again as order ${done.replacement?.number ?? "another order"}.`);
    if (done.reason === "stock_short") throw new OwnerToolError(`There is not enough stock to send the goods of order ${plan.number} again. stock_levels shows what is left.`);
    throw new OwnerToolError(REFUSED[done.reason](order));
  }
  const units = plan.lines.reduce((s, l) => s + l.quantity, 0);
  return {
    done: `Order ${done.number} sends ${units} ${units === 1 ? "unit" : "units"} of order ${done.replaces} again, at 0 (goods worth ${money(plan.valueMinor, plan.currency)}). It waits to be packed and sent like any paid order.`,
    link: `/admin/${ctx.store.slug}/orders/${done.orderId}`,
  };
}
