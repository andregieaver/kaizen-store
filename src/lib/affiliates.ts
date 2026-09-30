import { z } from "zod";

import { allocateCredit } from "./bonus";
import { consentCookieName, decodeConsent } from "./cookie-consent";
import { REFERRAL_CODE, makeReferralCode, normalizeReferralCode } from "./referrals";

/**
 * A store's affiliate program (D131), the store level: signed-in customers refer friends. Decided with the owner:
 * - **Who**: any signed-in customer gets a code and link the first time they open Refer a friend (`/account/referrals`);
 *   no approval. Staff can block one. Needs the bonus program (D130) on, because the reward is bonus credits.
 * - **Attribution**: `?ref={code}` on any page of the store sets the cookie (only once the visitor has allowed it;
 *   `cookieDays`, last click wins) and is kept on the cart; a friend who registers carries the referrer
 *   (`customers.referred_by_customer_id`). An order is attributed when it is placed with a valid code.
 * - **Friend**: `friendPercent` off the goods of their *first paid order* (signed in, never paid an order in this store
 *   before), at most `friendMaxMinor`; applied after campaigns and the group's discount, before codes and credits.
 * - **Referrer**: bonus credits (`bonus_entries.kind = 'referral'`), `rewardBps` of what the friend paid online for goods,
 *   as the bonus program counts it, for the friend's first `rewardOrders` paid orders (every one when null), pending for
 *   the bonus program's `pendingDays`, expiring as its settings say, at most `monthlyCapMinor` a month per referrer.
 * - **Guards**: never to oneself (same customer, same email), never when the friend is not new to the store (an earlier
 *   paid order), never for a blocked referrer, never on a copied order (D129) or a host's (D71), and taken back with a
 *   refund or cancellation by the refunded share (never below zero), like the bonus program. They are enforced in SQL
 *   (`commerce.affiliate_resolve()`, `affiliate_order_paid()`), so a screen or a job cannot skip one.
 * Pure types, checks and arithmetic, shared by the browser and the server, which checks everything again.
 */

export const AFFILIATE_REWARD_BPS_MAX = 5000;
export const AFFILIATE_FRIEND_PERCENT_MAX = 50;
export const AFFILIATE_COOKIE_DAYS_MAX = 90;

export type AffiliateSettings = {
  enabled: boolean;
  /** The referrer's credits per 100 the friend pays for goods, in basis points: 500 is 5%. */
  rewardBps: number;
  /** How many of the friend's paid orders earn the referrer credits; null for every one. */
  rewardOrders: number | null;
  /** The friend's welcome discount on their first order, in percent of goods; 0 for none. */
  friendPercent: number;
  /** The most the welcome discount takes off, in minor units of the store's main currency; null for no limit. */
  friendMaxMinor: number | null;
  /** The most one referrer can earn in a calendar month, in minor units of the credits' currency; null for no limit. */
  monthlyCapMinor: number | null;
  /** Days the link's cookie lasts once allowed. */
  cookieDays: number;
};

export const AFFILIATE_DEFAULTS: AffiliateSettings = {
  enabled: false,
  rewardBps: 500,
  rewardOrders: 1,
  friendPercent: 10,
  friendMaxMinor: null,
  monthlyCapMinor: null,
  cookieDays: 30,
};

export const affiliateSettingsInput = z.object({
  enabled: z.boolean(),
  rewardBps: z.number().int().min(0, "The reward cannot be below 0%.").max(AFFILIATE_REWARD_BPS_MAX, `Keep the reward at ${AFFILIATE_REWARD_BPS_MAX / 100}% or less.`),
  rewardOrders: z.number().int().min(1).max(100).nullable(),
  friendPercent: z.number().int().min(0).max(AFFILIATE_FRIEND_PERCENT_MAX, `Keep the friend's discount at ${AFFILIATE_FRIEND_PERCENT_MAX}% or less.`),
  friendMaxMinor: z.number().int().min(0).max(100_000_000).nullable(),
  monthlyCapMinor: z.number().int().min(0).max(1_000_000_000).nullable(),
  cookieDays: z.number().int().min(1).max(AFFILIATE_COOKIE_DAYS_MAX),
});

/** A code: lower case letters and digits, 6 to 16 (the same shape as Kaizen's referral codes). */
export const AFFILIATE_CODE = REFERRAL_CODE;
export const makeAffiliateCode = makeReferralCode;
export const normalizeAffiliateCode = normalizeReferralCode;

/** The query parameter a store's referral link carries. */
export const AFFILIATE_PARAM = "ref";

/** The cookie that keeps a store's referral (D131), per store: `kaizen_aff_{storeId}`; only after the visitor allowed it. */
export const affiliateCookie = (storeId: string) => `kaizen_aff_${storeId}`;

/** What the friend's welcome discount is on `goodsMinor` (goods after campaigns and the group's discount), rounded down and capped. */
export function friendDiscount(goodsMinor: number, settings: Pick<AffiliateSettings, "friendPercent" | "friendMaxMinor">): number {
  if (goodsMinor <= 0 || settings.friendPercent <= 0) return 0;
  const off = Math.floor((goodsMinor * settings.friendPercent) / 100);
  return Math.max(0, settings.friendMaxMinor === null ? off : Math.min(off, settings.friendMaxMinor));
}

/** What the referrer earns on `paidGoodsMinor` (what the friend paid online for goods): rounded down. */
export function referrerReward(paidGoodsMinor: number, rewardBps: number): number {
  if (paidGoodsMinor <= 0 || rewardBps <= 0) return 0;
  return Number((BigInt(Math.floor(paidGoodsMinor)) * BigInt(rewardBps)) / BigInt(10000));
}

/** Why a reward was not given. */
export type AffiliateRejection = "self" | "not_new" | "blocked" | "cap" | "limit" | "off" | "zero";

export const AFFILIATE_REJECTION_LABELS: Record<AffiliateRejection, string> = {
  self: "The friend is the referrer",
  not_new: "The friend had ordered before",
  blocked: "The referrer is blocked",
  cap: "The referrer's monthly limit was reached",
  limit: "The friend's earlier orders already earned a reward",
  off: "The program was off",
  zero: "The order earned nothing",
};

export type AffiliateStatus = "pending" | "rewarded" | "reversed" | "rejected";

/** The page /account/referrals draws: the shopper's link and what their friends did, never who they are. */
export type ShopperReferrals = {
  enabled: boolean;
  code: string | null;
  blocked: boolean;
  /** The rules, with the amounts in `currency` (converted for the market shown). */
  settings: AffiliateSettings;
  /** The bonus program's wait before credits can be used, in days. */
  pendingDays: number;
  /** The currency the amounts are in: the market's, or the credits' own when the store has no rate between them. */
  currency: string;
  visits: number;
  /** Friends who ordered through the link: a first name at most, the date and what it earned. */
  friends: { label: string; at: string; status: AffiliateStatus; rewardMinor: number }[];
  earnedMinor: number;
  pendingMinor: number;
};

/** What the store's owner sees for one referrer. */
export type AffiliateRow = {
  customerId: string;
  name: string;
  email: string;
  code: string;
  blocked: boolean;
  friends: number;
  earnedMinor: number;
};

// ---------------------------------------------------------------------------
// Which order is whose: the verdict of `commerce.affiliate_resolve()` and what the cart shows of it
// ---------------------------------------------------------------------------

/** What the database says of an order and a code: see `affiliate_resolve()` in the affiliate_rules migration. */
export type AffiliateVerdict = "none" | "off" | "guest" | "self" | "blocked" | "not_new" | "limit" | "ok";

/**
 * The welcome discount in a cart or checkout, for the shopper, in the market's currency: `applied` when the friend's
 * first order gets it, `guest` when a code is in play but nobody is signed in (the cart says to sign in), else
 * `none` (no code, a program that is off, or someone the discount is not for: nothing is said, so the cart never
 * tells a shopper why a guard stopped them).
 */
export type CartAffiliate = {
  state: "applied" | "guest" | "none";
  /** The store's welcome discount in percent, as set (0: the program gives friends nothing). */
  percent: number;
  /** What it takes off the goods of this order, in the market's currency; 0 unless `applied`. */
  discountMinor: number;
};

export const NO_CART_AFFILIATE: CartAffiliate = { state: "none", percent: 0, discountMinor: 0 };

/**
 * What the welcome discount is on a basket: `eligibleMinor` per line (goods bought once after campaigns and the group's
 * discount), the discount on their sum rounded down and capped at `maxMinor` (in the same currency; null for no cap),
 * spread over the lines by largest remainder so the parts add up exactly and no line is given more than it holds.
 * Used by `cartSummary()` and `placeOrder()`, which must agree to the minor unit.
 */
export function planWelcome(
  eligibleMinor: readonly number[],
  settings: Pick<AffiliateSettings, "friendPercent">,
  maxMinor: number | null,
): { totalMinor: number; lines: number[] } {
  const goods = eligibleMinor.reduce((sum, minor) => sum + Math.max(0, minor), 0);
  const totalMinor = friendDiscount(goods, { friendPercent: settings.friendPercent, friendMaxMinor: maxMinor });
  return { totalMinor, lines: allocateCredit(eligibleMinor, totalMinor) };
}

// ---------------------------------------------------------------------------
// Keeping the code: in memory always, in a cookie only when the visitor allowed it (D58)
// ---------------------------------------------------------------------------

/** Whether the visitor allowed the marketing category on this store (the consent cookie says so): nothing is kept without it. */
export function mayKeepAffiliate(cookies: string, storeId: string): boolean {
  const name = consentCookieName(storeId);
  const pair = cookies.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
  return decodeConsent(pair?.slice(name.length + 1))?.choices.marketing === true;
}

/** The code in the store's referral cookie, or null. */
export function readAffiliateCookie(cookies: string, storeId: string): string | null {
  const name = affiliateCookie(storeId);
  const pair = cookies.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
  return normalizeAffiliateCode(pair?.slice(name.length + 1) ?? null);
}

/** The `Set-Cookie` text for the store's referral cookie: `days` long, null for a code that cannot be one. */
export function writeAffiliateCookie(storeId: string, code: string, days: number, secure: boolean): string | null {
  const clean = normalizeAffiliateCode(code);
  if (!clean) return null;
  const age = Math.max(1, Math.min(AFFILIATE_COOKIE_DAYS_MAX, Math.floor(days))) * 86_400;
  return `${affiliateCookie(storeId)}=${clean}; Max-Age=${age}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The code a link's address carries (`?ref=`), or null. */
export function codeFromSearch(search: string): string | null {
  return normalizeAffiliateCode(new URLSearchParams(search).get(AFFILIATE_PARAM));
}

/**
 * Whether a click on a link should carry the code in its address: a link to another page of the same store that leaves the
 * market's own pages (the country chooser to a market, a market to another: each is its own root layout, so the page
 * loads again and memory is gone), and has no `ref` of its own. `base` is the market's own path (null on the chooser) and
 * `scope` the store's (`/s/{store}`, or `/` on its own host): links out of the store are left alone.
 */
export function shouldCarry(
  href: string,
  here: { origin: string; pathname: string },
  base: string | null,
  scope: string,
): boolean {
  let url: URL;
  try {
    url = new URL(href, here.origin);
  } catch {
    return false;
  }
  if (url.origin !== here.origin || url.searchParams.has(AFFILIATE_PARAM)) return false;
  if (url.pathname === here.pathname && url.hash !== "") return false;
  const inStore = scope === "/" || url.pathname === scope || url.pathname.startsWith(`${scope}/`);
  if (!inStore) return false;
  if (base === null) return true;
  return url.pathname !== base && !url.pathname.startsWith(`${base}/`);
}

/** The address with the code added. */
export function withAffiliate(href: string, origin: string, code: string): string {
  const url = new URL(href, origin);
  url.searchParams.set(AFFILIATE_PARAM, code);
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

// ---------------------------------------------------------------------------
// What the pages show of people: never more than a neutral label
// ---------------------------------------------------------------------------

/** A friend as the referrer reads them: a first name at most, never an email. Null when there is no name to show. */
export function friendLabel(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (first === "" || first.includes("@")) return null;
  return first.length > 20 ? `${first.slice(0, 19)}…` : first;
}

/** Where an attributed order stands, as a status the screens word. */
export function statusOf(status: AffiliateStatus, orderCancelled: boolean): AffiliateStatus | "unpaid" {
  return status === "pending" && orderCancelled ? "unpaid" : status;
}

export const AFFILIATE_STATUS_LABELS: Record<AffiliateStatus | "unpaid", string> = {
  pending: "Waiting for payment",
  unpaid: "Not paid",
  rewarded: "Rewarded",
  reversed: "Taken back",
  rejected: "No reward",
};

/** One attributed order for the store's owner: who, what the friend got and what the referrer earned. */
export type AffiliateAttributionRow = {
  id: string;
  at: string;
  orderId: string;
  orderNumber: string;
  friendId: string | null;
  friendName: string;
  friendEmail: string;
  affiliateId: string;
  affiliateName: string;
  code: string;
  status: AffiliateStatus | "unpaid";
  reason: AffiliateRejection | null;
  /** In the order's currency (the welcome discount) and the credits' currency (the reward). */
  discountMinor: number;
  orderCurrency: string;
  rewardMinor: number;
  /** The credits' currency, which the reward is in. */
  creditsCurrency: string;
};

/** The owner's overview of the program, amounts in the credits' currency. */
export type AffiliateOverview = {
  currency: string;
  affiliates: number;
  visits30d: number;
  orders30d: number;
  rewarded30dMinor: number;
  /** Credits from referrals that are usable now, and those still waiting for the return period. */
  outstandingMinor: number;
  pendingMinor: number;
  rejected30d: number;
};

/** A customer's side of the program, for the store's staff: their own link, and who referred them. */
export type CustomerAffiliate = {
  code: string | null;
  blocked: boolean;
  blockedReason: string;
  friends: number;
  earnedMinor: number;
  currency: string;
  referredBy: { customerId: string; name: string; email: string; code: string } | null;
  /** What their own first order got, if an affiliate's link led to it. */
  attributions: AffiliateAttributionRow[];
};

export type AffiliateResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };
