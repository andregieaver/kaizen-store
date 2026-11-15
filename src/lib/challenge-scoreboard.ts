import { challengeRatios } from "./challenge-console";
import type { OriginalPeriod } from "./challenge-original";

/**
 * The challenge's scoreboard (`docs/100-day-challenge.md` 3.3, E7): the clone and the original side by side on one definition, the clone read
 * from the platform and the original from the periods of a P&L its accountant signed (typed by the platform team, never estimated). The winner
 * is ahead on two of the three ratios (margin, profit per krone of marketing, revenue per visitor), and a store that spent less than 80 % of the
 * agreed ad money cannot win by spending little. Pure: the periods, the sums and the comparison; the server reads the clone.
 */


/** A store's side of the board, in minor units of one currency, without VAT. */
export type Side = {
  netSalesMinor: number;
  /** Contribution profit after marketing; null when it cannot be known (the clone's costs of goods too unknown). */
  contributionMinor: number | null;
  marketingMinor: number;
  /** Null when sessions were not counted for the whole span. */
  sessions: number | null;
};

/** The original's periods added up, in their one currency; periods in more than one currency, or that overlap, cannot be added. */
export function originalSide(periods: readonly OriginalPeriod[]): { side: Side; currency: string } | { problem: string } | null {
  if (periods.length === 0) return null;
  const currencies = [...new Set(periods.map((p) => p.currency))];
  if (currencies.length > 1) return { problem: `The original's periods are in ${currencies.join(" and ")}: enter them in one currency.` };
  const sorted = [...periods].sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from <= sorted[i - 1].to) return { problem: `The periods ${sorted[i - 1].from} to ${sorted[i - 1].to} and ${sorted[i].from} to ${sorted[i].to} overlap.` };
  }
  const sum = (f: (p: OriginalPeriod) => number) => periods.reduce((s, p) => s + f(p), 0);
  const net = sum((p) => p.netSalesMinor);
  const costs = sum((p) => p.cogsMinor + p.shippingMinor + p.paymentFeesMinor + p.marketingMinor + p.otherMinor);
  return {
    currency: currencies[0],
    side: {
      netSalesMinor: net,
      contributionMinor: net - costs,
      marketingMinor: sum((p) => p.marketingMinor),
      sessions: periods.every((p) => p.sessions !== null) ? sum((p) => p.sessions ?? 0) : null,
    },
  };
}

export const RATIO_KEYS = ["margin", "perKrone", "perVisitor"] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];
export type Leader = "clone" | "original" | "even" | null;

/** One side's three ratios: margin, profit per krone of marketing, and revenue per visitor (net sales ÷ sessions, in minor units). */
export function sideRatios(s: Side): Record<RatioKey, number | null> {
  const r = challengeRatios({
    netRevenueMinor: s.netSalesMinor,
    contributionMinor: s.contributionMinor,
    marketingMinor: s.marketingMinor,
    revenuePerVisitorMinor: s.sessions && s.sessions > 0 ? Math.round(s.netSalesMinor / s.sessions) : null,
  });
  return { margin: r.margin, perKrone: r.perKrone, perVisitor: r.perVisitorMinor };
}

/** Which side a ratio favours: the higher one; null when either cannot be measured. */
export const ahead = (clone: number | null, original: number | null): Leader =>
  clone === null || original === null ? null : clone > original ? "clone" : original > clone ? "original" : "even";

/** The share of the agreed ad money a store spent (1 is all of it); null without an agreed amount. */
export const adShare = (spentMinor: number, agreedMinor: number | null): number | null => (agreedMinor === null || agreedMinor <= 0 ? null : spentMinor / agreedMinor);

/** The share of the agreed ad money each store must spend for its ratios to count (3.3). */
export const AD_MONEY_SHARE = 0.8;

export type Board = {
  ratios: Record<RatioKey, { clone: number | null; original: number | null; ahead: Leader }>;
  /** Ahead on two of the three ratios; null while fewer than two can be compared, or nobody leads two. */
  leader: Leader;
  ad: { clone: number | null; original: number | null };
  /** A store under the agreed share of ad money: its lead does not count. */
  underSpent: ("clone" | "original")[];
};

/**
 * The board: each ratio for both sides and who is ahead, the leader on two of three, and who spent too little of the agreed ad money. Both
 * sides must be in the same currency (the server converts the clone's into the original's, or says it cannot).
 */
export function board(clone: Side, original: Side, agreedAdMinor: number | null): Board {
  const c = sideRatios(clone);
  const o = sideRatios(original);
  const ratios = Object.fromEntries(RATIO_KEYS.map((k) => [k, { clone: c[k], original: o[k], ahead: ahead(c[k], o[k]) }])) as Board["ratios"];
  const wins = (side: "clone" | "original") => RATIO_KEYS.filter((k) => ratios[k].ahead === side).length;
  const leader: Leader = wins("clone") >= 2 ? "clone" : wins("original") >= 2 ? "original" : RATIO_KEYS.filter((k) => ratios[k].ahead !== null).length >= 2 ? "even" : null;
  const ad = { clone: adShare(clone.marketingMinor, agreedAdMinor), original: adShare(original.marketingMinor, agreedAdMinor) };
  const underSpent = (["clone", "original"] as const).filter((s) => ad[s] !== null && ad[s]! < AD_MONEY_SHARE);
  return { ratios, leader, ad, underSpent };
}
