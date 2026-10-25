import "server-only";

import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { formatBps, isOnPlan } from "@/lib/plans";
import { siteUrl } from "@/lib/site";

import { passMembership, type Account } from "./auth";
import { billingMode, cancelPlan, choosePlan, getStoreBilling, listPlans, type Plan, type StoreBilling } from "./billing";
import { OwnerToolError } from "./owner-tool-error";
import { memberCan } from "./permissions";
import type { Store } from "./stores";

/**
 * The AI manager's plan tools (PSI AGT-01; D18): the store's plan with Kaizena Flow, the plans offered, and changing or ending the plan,
 * each through the Billing page's own function (`choosePlan()`, `cancelPlan()`), on the owner's yes (`spend`) and with their membership
 * read again. The first plan is never chosen here: it is paid by card on Stripe's page, which only the owner can fill in.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const billingLink = (store: Store) => `/admin/${store.slug}/billing`;
const locale = (store: Store) => store.markets[0]?.locale ?? "en";
const priceWords = (store: Store, p: { amountMinor: number; currency: string; interval: string }) =>
  `${formatMoney(p.amountMinor, p.currency, locale(store))} a ${p.interval} (without VAT)`;

async function owner(ctx: Ctx) {
  const member = await passMembership(ctx.store.slug, ctx.account.id);
  if (!member || !memberCan(member, "owner")) return fail("Only an owner of the store changes its plan.");
  return member;
}

const STATUS_WORDS: Record<string, string> = {
  trialing: "on a free trial",
  active: "active",
  past_due: "payment overdue: Kaizena Flow's invoice is not paid",
  canceled: "ended",
  incomplete: "waiting for the first payment",
  incomplete_expired: "the first payment was never made",
  unpaid: "unpaid",
  paused: "paused",
};

/** The currency the Billing page shows prices in: the store's own when plans are priced in it, else the first the plans have. */
function shownCurrency(store: Store, offered: Plan[]): string {
  const own = mainCurrency(store);
  if (offered.some((plan) => plan.prices.some((p) => p.active && p.currency === own))) return own;
  return offered.flatMap((plan) => plan.prices).find((p) => p.active)?.currency ?? own;
}

const onPlan = (billing: StoreBilling | null) => Boolean(billing && isOnPlan(billing.status) && billing.mode === billingMode());

/** `billing_overview`: the plan, its price and period, the fee on sales, and the plans offered in the page's currency. */
export async function billingOverviewTool(ctx: Ctx) {
  const [billing, plans] = await Promise.all([getStoreBilling(ctx.store.id), listPlans()]);
  const offered = plans.filter((plan) => plan.active && plan.prices.some((p) => p.active));
  const currency = shownCurrency(ctx.store, offered);
  return {
    plan: onPlan(billing)
      ? {
          name: billing!.planName,
          price: billing!.price ? priceWords(ctx.store, billing!.price) : null,
          status: STATUS_WORDS[billing!.status ?? ""] ?? billing!.status,
          period_ends: billing!.currentPeriodEnd?.slice(0, 10) ?? null,
          ends_at_period_end: billing!.cancelAtPeriodEnd,
        }
      : null,
    fee_on_sales: formatBps(billing?.feeBps ?? 0),
    offered: offered.map((plan) => ({
      name: plan.name,
      fee_on_sales: formatBps(plan.saleFeeBps),
      prices: plan.prices.filter((p) => p.active && p.currency === currency).map((p) => priceWords(ctx.store, p)),
      current: plan.id === billing?.planId && onPlan(billing),
    })),
    note: onPlan(billing) ? "A change of plan applies at once with a prorated charge or credit." : "The store has no plan yet: the first one is chosen and paid by card on the Billing page.",
    link: billingLink(ctx.store),
  };
}

type ChangeInput = { plan: string; interval: "month" | "year" };

/** The price a plan named by the owner has for the interval, in the Billing page's currency; a refusal names what is offered. */
async function priceFor(ctx: Ctx, input: ChangeInput) {
  const [billing, plans] = await Promise.all([getStoreBilling(ctx.store.id), listPlans()]);
  if (!onPlan(billing)) return fail("The store has no plan yet: the first one is chosen and paid by card on the Billing page, which only the owner can do.");
  const offered = plans.filter((plan) => plan.active && plan.prices.some((p) => p.active));
  const wanted = input.plan.trim().toLowerCase();
  const plan = offered.find((p) => p.name.trim().toLowerCase() === wanted);
  if (!plan) return fail(`There is no plan "${input.plan}". Offered: ${offered.map((p) => p.name).join(", ")}.`);
  const currency = shownCurrency(ctx.store, offered);
  const price = plan.prices.find((p) => p.active && p.currency === currency && p.interval === input.interval);
  if (!price) return fail(`${plan.name} has no ${input.interval}ly price in ${currency}.`);
  if (price.id === billing!.priceId) return fail(`The store is on ${plan.name} (${input.interval}ly) already.`);
  return { plan, price, billing: billing! };
}

export async function preflightChangePlan(ctx: Ctx, input: ChangeInput): Promise<void> {
  await owner(ctx);
  await priceFor(ctx, input);
}

/** What the owner says yes to: the plan, its price and what it replaces. */
export async function changePlanSummary(ctx: Ctx, input: ChangeInput): Promise<string | null> {
  const found = await priceFor(ctx, input).catch(() => null);
  if (!found) return null;
  return `Move the store from ${found.billing.planName ?? "its plan"} to ${found.plan.name} at ${priceWords(ctx.store, found.price)}, at once, with a prorated charge or credit.`;
}

/** `change_plan`: the running plan moved to another price at once (`choosePlan()`, which never opens a payment page for a running plan). */
export async function changePlanTool(ctx: Ctx, input: ChangeInput) {
  const member = await owner(ctx);
  const { plan, price } = await priceFor(ctx, input);
  const result = await choosePlan(member.account, ctx.store.slug, price.id, siteUrl());
  if (!result.ok) return fail(result.problems.join(" "));
  if (result.checkoutUrl) return fail("The plan needs a payment on the Billing page first.");
  return { done: `The store is on ${plan.name} now, at ${priceWords(ctx.store, price)}. Stripe charges or credits the difference on the next invoice.`, link: billingLink(ctx.store) };
}

type EndInput = { when: "period_end" | "undo" };

export async function preflightEndPlan(ctx: Ctx, { when }: EndInput): Promise<void> {
  await owner(ctx);
  const billing = await getStoreBilling(ctx.store.id);
  if (!onPlan(billing)) fail("The store has no plan to end.");
  if (when === "period_end" && billing!.cancelAtPeriodEnd) fail("The plan already ends at the end of its period.");
  if (when === "undo" && !billing!.cancelAtPeriodEnd) fail("The plan is not set to end.");
}

/** `end_plan`: ends the plan when the period paid for runs out, or keeps it after all; never at once (that is Kaizena Flow's). */
export async function endPlanTool(ctx: Ctx, { when }: EndInput) {
  const member = await owner(ctx);
  const result = await cancelPlan(member.account, ctx.store.id, when);
  if (!result.ok) return fail(result.problems.join(" "));
  const billing = await getStoreBilling(ctx.store.id);
  return {
    done: when === "undo" ? "The plan goes on as before." : `The plan ends on ${billing?.currentPeriodEnd?.slice(0, 10) ?? "the end of its period"}; until then everything works as now.`,
    link: billingLink(ctx.store),
  };
}
