import { z } from "zod";

/**
 * The challenge's baseline (`docs/100-day-challenge.md` 3.3 and E7, D650): what the score rests on, frozen by the platform team before Day 1 so
 * nothing either side changes later moves it. The clone's own cost estimates the score counts with (payment fee, shipping and handling per
 * order: E1), the ad money agreed for each store, and the agreed cost prices of the clone's goods (a fingerprint of every variant's cost, so a
 * change is seen without keeping a copy of the catalogue). The scoreboard counts with the frozen estimates and ad money, and names any
 * difference. Pure: the shape, the fingerprint and the differences; the server reads the store and freezes it.
 */

const minor = z.number().int().min(0).max(1_000_000_000_000);

export const baselineCostsSchema = z.object({
  paymentFeeBps: z.number().int().min(0).max(10_000),
  paymentFeeFixedMinor: minor,
  shippingCostMinor: minor,
  handlingCostMinor: minor,
});
export type BaselineCosts = z.infer<typeof baselineCostsSchema>;

export const baselineSchema = z.object({
  frozenAt: z.iso.datetime(),
  /** The platform admin who froze it. */
  frozenBy: z.uuid(),
  /** The clone's main currency when it was frozen: the estimates and the ad money are in it. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  costs: baselineCostsSchema,
  /** The ad money agreed for each store, as the challenge had it (null: none agreed). */
  adMoney: z.number().min(0).max(1_000_000_000).nullable(),
  /** The agreed cost prices: how many variants had one, and a fingerprint of them all (`costFingerprint()`). */
  variantsWithCost: z.number().int().min(0),
  variantsWithoutCost: z.number().int().min(0),
  costFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Baseline = z.infer<typeof baselineSchema>;

/** The text a fingerprint of the cost prices is made from: every variant's id and cost (or "-" without one), in id order. */
export function costFingerprintText(variants: readonly { id: string; costMinor: number | null }[]): string {
  return [...variants]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((v) => `${v.id}:${v.costMinor ?? "-"}`)
    .join("\n");
}

/** Which of the frozen cost estimates the store has changed since, in words; empty when none. */
export function changedCosts(baseline: Baseline, now: BaselineCosts): string[] {
  const words: Record<keyof BaselineCosts, string> = {
    paymentFeeBps: "the payment fee's percentage",
    paymentFeeFixedMinor: "the fixed payment fee",
    shippingCostMinor: "the shipping cost per order",
    handlingCostMinor: "the handling and packaging cost per order",
  };
  return (Object.keys(words) as (keyof BaselineCosts)[]).filter((k) => baseline.costs[k] !== now[k]).map((k) => words[k]);
}

/** Whether the baseline may be frozen (or frozen again) on this day: only before Day 1, both in UTC dates. */
export const mayFreeze = (dayOne: string, today: string): boolean => today < dayOne;
