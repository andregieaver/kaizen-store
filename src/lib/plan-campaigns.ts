import type { PlatformDiscount } from "./discounts";

/**
 * Timed plan prices (C5 of `docs/platform-parity-plan.md`, D524): a store's campaigns (D114) for Kaizena Flow's own plans. A campaign is
 * one of Kaizena Flow's discount codes (D31) with a name, a start and an end: while it runs, a plan chosen among its plans (every plan when it
 * names none) gets its Stripe coupon without a code being typed, for as long as the coupon lasts (the first payment, some months, or always),
 * and the plans pages say so by its name. The pure parts: which campaign applies, what a price comes to under it, and whether two meet.
 */

export type PlanCampaign = Pick<PlatformDiscount, "id" | "code" | "kind" | "percent" | "amounts" | "duration" | "durationMonths" | "active"> & {
  name: string;
  startsAt: string;
  /** A campaign always ends. */
  expiresAt: string;
  /** The plans it is for; empty is every plan. */
  planIds: string[];
};

/** Running at this moment: switched on, started and not ended. */
export const campaignRuns = (c: Pick<PlanCampaign, "active" | "startsAt" | "expiresAt">, now: Date) =>
  c.active && new Date(c.startsAt) <= now && now < new Date(c.expiresAt);

/** Whether a campaign gives anything on a price in this currency: a percentage always, an amount only where it has one. */
export const campaignGivesIn = (c: Pick<PlanCampaign, "kind" | "amounts">, currency: string) =>
  c.kind === "percent" || (c.amounts[currency.toLowerCase()] ?? 0) > 0;

const forPlan = (c: Pick<PlanCampaign, "planIds">, planId: string) => c.planIds.length === 0 || c.planIds.includes(planId);

/** The campaign a plan chosen now gets, in the price's currency: the one running for it (the latest started, should two ever run). */
export function campaignFor<C extends PlanCampaign>(campaigns: readonly C[], planId: string, currency: string, now: Date): C | null {
  return (
    campaigns
      .filter((c) => campaignRuns(c, now) && forPlan(c, planId) && campaignGivesIn(c, currency))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0] ?? null
  );
}

/** What a price comes to while the campaign gives on it: a percentage off, rounded to the minor unit, or an amount off, never below zero. */
export function campaignPrice(minor: number, c: Pick<PlanCampaign, "kind" | "percent" | "amounts">, currency: string): number {
  if (c.kind === "percent") return Math.max(0, Math.round((minor * (100 - c.percent)) / 100));
  return Math.max(0, minor - (c.amounts[currency.toLowerCase()] ?? 0));
}

/** Two campaigns meet when their times overlap and they share a plan (no plans named is every plan). */
export function campaignsMeet(a: Pick<PlanCampaign, "startsAt" | "expiresAt" | "planIds">, b: Pick<PlanCampaign, "startsAt" | "expiresAt" | "planIds">): boolean {
  const overlap = new Date(a.startsAt) < new Date(b.expiresAt) && new Date(b.startsAt) < new Date(a.expiresAt);
  const share = a.planIds.length === 0 || b.planIds.length === 0 || a.planIds.some((id) => b.planIds.includes(id));
  return overlap && share;
}

/** A code for a campaign that nobody types: its name's letters and a random tail, within the codes' shape (3–40 of A–Z, 0–9, - and _). */
export function campaignCode(name: string, random: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const tail = random.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "CAMPAIGN";
  return `${base || "CAMPAIGN"}-${tail}`;
}

/** The public plans' view of a running campaign (D142): what the cards need to show it, never its code. */
export type PublicCampaign = Pick<PlanCampaign, "name" | "kind" | "percent" | "amounts" | "duration" | "durationMonths" | "planIds" | "expiresAt">;

export const publicCampaign = (c: PlanCampaign): PublicCampaign => ({
  name: c.name,
  kind: c.kind,
  percent: c.percent,
  amounts: c.amounts,
  duration: c.duration,
  durationMonths: c.durationMonths,
  planIds: c.planIds,
  expiresAt: c.expiresAt,
});

/** A card's price under the public campaign, or null when it gives nothing on this plan and currency. */
export function cardCampaignPrice(c: PublicCampaign | null | undefined, planId: string, minor: number, currency: string): number | null {
  if (!c || !forPlan(c, planId) || !campaignGivesIn(c, currency)) return null;
  const price = campaignPrice(minor, c, currency);
  return price < minor ? price : null;
}
