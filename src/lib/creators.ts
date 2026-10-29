/**
 * Creators (wave 11 unit G, D386): people with a channel of their own who apply to sell a store's goods with a code and a link, and earn a
 * percentage of what their orders paid for goods, without VAT, in each order's own currency. The rules are the database's
 * (`creator_order_paid()`, `creator_settle_refunds()`, `creator_order_cancelled()`, the append-only `creator_commissions` and
 * `creator_payouts`); this module is the plain part both the server and the browser read. No zod here: the schemas are
 * `creators-schema.ts`.
 */

export type CreatorStatus = "applied" | "approved" | "declined" | "stopped";
export const CREATOR_STATUSES: readonly CreatorStatus[] = ["applied", "approved", "declined", "stopped"];

export type CreatorSettings = {
  enabled: boolean;
  /** The programme's rate, in basis points of goods without VAT (1000 = 10 %). */
  commissionBps: number;
  /** A rate of its own for products in one of the store's product categories (term id → basis points); the highest applies. */
  categoryBps: Record<string, number>;
  /** How long a creator's link is remembered, once the visitor allows marketing cookies. */
  cookieDays: number;
};

export const CREATOR_DEFAULTS: CreatorSettings = { enabled: false, commissionBps: 1000, categoryBps: {}, cookieDays: 30 };

/** The most a rate may be: half of what was paid for the goods. */
export const CREATOR_MAX_BPS = 5000;
/** At most this many categories with a rate of their own. */
export const CREATOR_CATEGORIES_MAX = 100;

/** What the store owes a creator in one currency, never converted: earned, less taken back, less paid out. */
export type CreatorBalance = { currency: string; earnedMinor: number; reversedMinor: number; paidMinor: number; owedMinor: number };

export type CreatorRow = {
  id: string;
  status: CreatorStatus;
  name: string;
  channelUrl: string;
  /** Who applied; null once they were erased. */
  email: string | null;
  code: string | null;
  commissionBps: number | null;
  appliedAt: string;
  decidedAt: string | null;
  orders: number;
  visits: number;
  balances: CreatorBalance[];
};

export type CreatorPayoutRow = {
  id: string;
  creatorId: string;
  creatorName: string;
  currency: string;
  amountMinor: number;
  paidOn: string;
  reference: string;
  recordedAt: string;
};

/** The creator's own page: what their code did, in counts and money, never who bought. */
export type CreatorDashboard = {
  status: CreatorStatus;
  name: string;
  channelUrl: string;
  code: string | null;
  /** Visits to their link in the last 30 days. */
  visits: number;
  orders: { pending: number; earned: number; reversed: number; rejected: number };
  balances: CreatorBalance[];
  payouts: { currency: string; amountMinor: number; paidOn: string }[];
  /** The rate their goods earn, the programme's when they have none of their own (a category's may be higher). */
  commissionBps: number;
};

/** Why a change was refused, as a code the screens put in their own words. */
export type CreatorProblem =
  | "owner_only"
  | "no_access"
  | "invalid"
  | "channel"
  | "category"
  | "not_found"
  | "status"
  | "off"
  | "unverified"
  | "already"
  | "payout_over"
  | "code";
export const CREATOR_PROBLEMS: readonly CreatorProblem[] = [
  "owner_only", "no_access", "invalid", "channel", "category", "not_found", "status", "off", "unverified", "already", "payout_over", "code",
];

export type CreatorResult = { ok: true } | { ok: false; problem: CreatorProblem };

/** A balance from its three sums. */
export function balanceOf(currency: string, earnedMinor: number, reversedMinor: number, paidMinor: number): CreatorBalance {
  return { currency, earnedMinor, reversedMinor, paidMinor, owedMinor: earnedMinor - reversedMinor - paidMinor };
}

/** A percentage as the owner types it (12.5) in basis points, or null when it is not one the programme allows. */
export function percentToBps(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const bps = Math.round(Number(text) * 100);
  return bps >= 0 && bps <= CREATOR_MAX_BPS ? bps : null;
}

/** Basis points as a percentage to show (1250 → "12.5"). */
export function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

/**
 * A channel's address as typed, kept only when it is a web address (http or https) of a reasonable length; null otherwise. It is shown to
 * staff as text and as a link with `rel="noopener noreferrer nofollow"`.
 */
export function cleanChannelUrl(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 300) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
