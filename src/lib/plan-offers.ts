import { nextWeekend } from "./campaign-offers";

/**
 * Ready offers on Kaizena Flow's Discounts page (round 16, D650): three plan codes and a weekend campaign, each opening its form filled in
 * so the platform's owner only presses Make. The platform's counterpart of the stores' ready coupons (D630) and sales (D633). Pure.
 */
export const PLAN_OFFER_KEYS = ["welcome", "start20", "partner", "weekend"] as const;
export type PlanOfferKey = (typeof PLAN_OFFER_KEYS)[number];

export type PlanOfferDraft = {
  /** A code to type, or none for a campaign. */
  code?: string;
  /** A campaign's name, in the admin's words (the page fills it in). */
  name?: string;
  campaign: boolean;
  percent: number;
  duration: "once" | "repeating" | "forever";
  durationMonths?: number;
  /** `YYYY-MM-DD`, Norwegian time; a campaign's start and last day. */
  startsAt?: string;
  expiresAt?: string;
};

export function isPlanOfferKey(value: unknown): value is PlanOfferKey {
  return typeof value === "string" && (PLAN_OFFER_KEYS as readonly string[]).includes(value);
}

/** The offer as its form's starting values; the weekend campaign runs the coming Friday to Sunday. */
export function planOfferDraft(key: PlanOfferKey, now = new Date()): PlanOfferDraft {
  switch (key) {
    case "welcome":
      return { code: "WELCOME", campaign: false, percent: 100, duration: "once" };
    case "start20":
      return { code: "START20", campaign: false, percent: 20, duration: "repeating", durationMonths: 3 };
    case "partner":
      return { code: "PARTNER10", campaign: false, percent: 10, duration: "forever" };
    case "weekend": {
      const { startsAt, endsAt } = nextWeekend(now);
      return { campaign: true, percent: 30, duration: "once", startsAt: startsAt.slice(0, 10), expiresAt: endsAt.slice(0, 10) };
    }
  }
}
