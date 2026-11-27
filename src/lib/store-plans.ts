import { checkoutConsents } from "./checkout-consents";
import type { PublicPlans, PublicPrice } from "./plan-offer";
import type { PlanInterval } from "./plans";

/**
 * A store's plans as its pricing table shows them (D912): each plan product a card, priced at what a subscriber pays every month and
 * every year in the visitor's market, with what it includes. Pure: `src/server/store-plans.ts` reads them, the Plans component draws them
 * with the cards and comparison Kaizena Flow's own plans have (`planCards()`, `comparisonTable()` in `plan-offer.ts`).
 */

/** The most lines of a plan's description its card lists. */
export const INCLUDED_MAX = 30;
/** The most characters of one line. */
export const INCLUDED_LINE_MAX = 160;

/**
 * A price on a plan's card, and what its button buys: the variant (its billing period) with the purchase option renewing at it. `renewalMinor` is
 * what each renewal charges, with VAT, as the cart's consent says it (D915); `minCycles` the payments committed to (D29).
 */
export type StorePlanPrice = PublicPrice & { variantId: string; sellingPlanId: string; trialDays: number; renewalMinor: number; minCycles: number };

export type StorePlan = {
  id: string;
  handle: string;
  name: string;
  /** Its short line under the name (the product's excerpt), or empty. */
  line: string;
  /** What it includes: its description's lines (`includedLines()`). */
  included: string[];
  /** At most one a billing period, the lowest a subscriber pays. */
  prices: StorePlanPrice[];
  /** Whether a price of nothing says Free (D913), as the plan, its tags, its categories or the store choose; absent is Free. */
  zeroFree?: boolean;
  /** Choosing it goes straight to payment, past the cart page (D915); its terms are said beside its button. */
  skipsCart?: boolean;
  /** The product categories it is in, and every category above them (D914): a pricing table of a category shows the plans in it or under it. */
  categoryIds: string[];
};

/** The plans a pricing table shows (D914): those in its category or one under it, or every plan when it names none. */
export function plansOfCategory<T extends Pick<StorePlan, "categoryIds">>(plans: readonly T[], categoryId: string | undefined): T[] {
  return categoryId ? plans.filter((plan) => plan.categoryIds.includes(categoryId)) : [...plans];
}

/** A product category that holds plans, for the pricing table's choice of which to show (D914), with the plans it shows. */
export type PlanGroup = { id: string; name: string; planIds: string[] };

/** The categories holding at least one plan, by name, each with its plans (in or under it). */
export function planGroups(plans: readonly Pick<StorePlan, "id" | "categoryIds">[], categories: readonly { id: string; name: string }[]): PlanGroup[] {
  return categories
    .map((category) => ({ id: category.id, name: category.name, planIds: plans.filter((plan) => plan.categoryIds.includes(category.id)).map((plan) => plan.id) }))
    .filter((group) => group.planIds.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a plan includes, from its description (D912: a plan has no page, so its description is the list): one thing per line, a bullet or
 * a dash in front taken off, blank and repeated lines left out, each line cut to `INCLUDED_LINE_MAX`.
 */
export function includedLines(description: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•·–—]|\d+[.)])\s+/u, "").replace(/\s+/g, " ").trim().slice(0, INCLUDED_LINE_MAX).trim();
    const key = featureKey(line);
    if (!line || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length === INCLUDED_MAX) break;
  }
  return lines;
}

/** Lines that say the same thing alike are one row of the comparison: compared without case, spacing or a full stop at the end. */
export const featureKey = (line: string) => line.toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/u, "").trim();

/** A price a subscriber pays a month, for ordering cards from the cheapest: a yearly price as its twelfth. */
function monthOf(plan: StorePlan): number {
  const month = plan.prices.find((p) => p.interval === "month");
  const year = plan.prices.find((p) => p.interval === "year");
  return month ? month.amountMinor : year ? year.amountMinor / 12 : Number.POSITIVE_INFINITY;
}

/**
 * The store's plans as the pricing table's data, in the shape Kaizena Flow's own plans have, so one table draws both: the plans from the
 * cheapest a month, each line a feature, shared by the plans that write it alike, in the order the lines are first written (the plans'
 * own order, so a cheaper plan's lines lead and a dearer one's extras follow).
 */
export function storePlansData(plans: readonly StorePlan[]): PublicPlans {
  const ordered = [...plans].sort((a, b) => monthOf(a) - monthOf(b) || a.name.localeCompare(b.name));
  const features = new Map<string, { id: string; category: string; name: string; description: string; position: number }>();
  for (const plan of ordered) {
    for (const line of plan.included) {
      const key = featureKey(line);
      if (!features.has(key)) features.set(key, { id: key, category: "", name: line, description: "", position: features.size });
    }
  }
  return {
    plans: ordered.map((plan, position) => ({
      id: plan.id,
      name: plan.name,
      description: plan.line,
      saleFeeBps: 0,
      position,
      prices: plan.prices.map(({ currency, interval, amountMinor }) => ({ currency, interval, amountMinor })),
      featureIds: plan.included.map(featureKey),
    })),
    features: [...features.values()],
  };
}

/** What a card's button buys at a billing period: the plan's price at it, or null when it has none. */
export function choiceFor(plan: StorePlan | undefined, interval: PlanInterval): StorePlanPrice | null {
  return plan?.prices.find((price) => price.interval === interval) ?? null;
}

/** The lowest of several prices a plan has at one billing period (two variants renewing alike): a card shows one price a period. */
export function lowestPerInterval(prices: readonly StorePlanPrice[]): StorePlanPrice[] {
  const best = new Map<PlanInterval, StorePlanPrice>();
  for (const price of prices) {
    const held = best.get(price.interval);
    if (!held || price.amountMinor < held.amountMinor) best.set(price.interval, price);
  }
  return (["month", "year"] as const).flatMap((interval) => {
    const price = best.get(interval);
    return price ? [price] : [];
  });
}

/**
 * What pressing a plan's button agrees to (D915), for the plans that skip the cart: each price's renewals in the cart's own words
 * (`checkoutConsents()`), by `{variant}:{option}`; none for a plan renewing at nothing (D913). `money` writes an amount as the cart does.
 */
export function planAgreements(
  plans: readonly StorePlan[],
  m: Parameters<typeof checkoutConsents>[0],
  money: (minor: number) => string,
  lead: string,
): { lead: string; byChoice: Record<string, string> } | undefined {
  const byChoice: Record<string, string> = {};
  for (const plan of plans) {
    if (!plan.skipsCart) continue;
    for (const price of plan.prices) {
      const terms = { interval: price.interval, intervalCount: 1, trialDays: price.trialDays, minCycles: price.minCycles };
      const said = checkoutConsents(m, { digital: false, service: false, plan: terms, renewal: price.renewalMinor }, money).subscription;
      if (said) byChoice[`${price.variantId}:${price.sellingPlanId}`] = said;
    }
  }
  return Object.keys(byChoice).length > 0 ? { lead, byChoice } : undefined;
}
