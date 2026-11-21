/**
 * A business customer's lead score (email plan M2.8, D865): how warm they are, from what they did, worked out here in code and never by a
 * model, each point with its reason so staff can see why. Four signals, each capped so no one of them makes the whole score: quotes they
 * asked for, an open deal, presses on links in the store's emails, and products they looked at while signed in. Visits are counted only
 * as those product views, the store keeping no visit per person (a visit is a daily hash, D303). Pure.
 */

/** What a customer did, as `leadScoreFacts()` reads it. */
export type LeadFacts = {
  /** Requests for a quote in the last 90 days (D431), not declined. */
  quotes: number;
  /** Their deals still open (D464), while Deals is on. */
  openDeals: number;
  /** Presses on links in the store's emails in the last 30 days, and in the 90 days. */
  presses30: number;
  presses90: number;
  /** Products they looked at while signed in, among the views kept (D691, a week, while a browse email runs). */
  viewed: number;
};

export type LeadReason = "quotes" | "deal" | "pressed" | "pressedEarlier" | "viewed";

/** One reason's share: what it is, how many times it happened, and the points it gave. */
export type LeadPoint = { reason: LeadReason; count: number; points: number };

export type LeadScore = { score: number; points: LeadPoint[] };

/** The rules, in one place: points per time, and the most one reason gives. */
export const LEAD_RULES: Record<LeadReason, { each: number; max: number }> = {
  quotes: { each: 25, max: 50 },
  deal: { each: 20, max: 20 },
  pressed: { each: 10, max: 20 },
  pressedEarlier: { each: 5, max: 5 },
  viewed: { each: 5, max: 15 },
};

/** How a score reads: 60 or more is hot, 25 or more warm, above nothing cool. */
export type LeadLevel = "hot" | "warm" | "cool" | "none";

export function leadLevel(score: number): LeadLevel {
  if (score >= 60) return "hot";
  if (score >= 25) return "warm";
  return score > 0 ? "cool" : "none";
}

/** The score out of 100 and each reason behind it, largest first; reasons that gave nothing are left out. */
export function leadScore(facts: LeadFacts): LeadScore {
  const counts: Record<LeadReason, number> = {
    quotes: facts.quotes,
    deal: facts.openDeals,
    pressed: facts.presses30,
    // An earlier press counts only for someone with none in the last 30 days, so one press is never counted twice.
    pressedEarlier: facts.presses30 > 0 ? 0 : facts.presses90,
    viewed: facts.viewed,
  };
  const points = (Object.keys(LEAD_RULES) as LeadReason[])
    .map((reason) => {
      const count = Math.max(0, Math.floor(counts[reason]));
      return { reason, count, points: Math.min(count * LEAD_RULES[reason].each, LEAD_RULES[reason].max) };
    })
    .filter((p) => p.points > 0)
    .sort((a, b) => b.points - a.points);
  return { score: Math.min(100, points.reduce((sum, p) => sum + p.points, 0)), points };
}
