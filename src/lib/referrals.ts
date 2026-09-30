import { z } from "zod";

import { consentCookieName, decodeConsent } from "./cookie-consent";

/**
 * Kaizen's referral program (D131), the platform level of the affiliate program. Decided with the platform's owner:
 * - **Who**: any store owner (an account that belongs to a store as owner) gets a referral code and link the first time
 *   they open Referrals (`/admin/account/referrals`); no approval. Platform admins can block an account.
 * - **Attribution**: a link `/r/{code}` (or `?ref=`) leads to `/sign-up`, the code travelling in the address and the form
 *   and, once the visitor has allowed the category, in a cookie that lasts `cookieDays`; last click wins. The request
 *   keeps the code (`access_requests.referral_code`); approving it makes a `referrals` row for the new store, which
 *   freezes the rate and months. A code of the requester's own account, or of an account with the same email, earns
 *   nothing (no self-referral).
 * - **Reward**: `commissionBps` of the fees the referred store pays Kaizen, for `months` months from when it was created:
 *   its plan invoices (the amount without VAT, when the invoice is paid) and Kaizen's sale fee on its orders
 *   (`payments.kaizen_fee_minor`, when the order is paid). Credit, not money: per currency (never converted), pending
 *   `pendingDays` (fees can be refunded), then put on the referrer's own Kaizen plan invoices as a negative line in
 *   the invoice's currency until used up. Refunds and credit notes take back their share, never below zero.
 * Pure types, checks and arithmetic, shared by the browser and the server, which checks everything again.
 */

export const REFERRAL_COMMISSION_BPS_MAX = 5000;
export const REFERRAL_MONTHS_MAX = 60;
export const REFERRAL_PENDING_DAYS_MAX = 90;
export const REFERRAL_COOKIE_DAYS_MAX = 90;

export type ReferralSettings = {
  enabled: boolean;
  /** The share of the referred store's fees that the referrer earns, in basis points: 1000 is 10%. */
  commissionBps: number;
  /** Months after the referred store was created during which its fees earn commission. */
  months: number;
  /** Days after a fee is paid before its credit can be used. */
  pendingDays: number;
  /** Days the referral cookie lasts once allowed. */
  cookieDays: number;
};

export const REFERRAL_DEFAULTS: ReferralSettings = {
  enabled: false,
  commissionBps: 1000,
  months: 12,
  pendingDays: 30,
  cookieDays: 30,
};

export const referralSettingsInput = z.object({
  enabled: z.boolean(),
  commissionBps: z.number().int().min(0, "Commission cannot be below 0%.").max(REFERRAL_COMMISSION_BPS_MAX, `Keep commission at ${REFERRAL_COMMISSION_BPS_MAX / 100}% or less.`),
  months: z.number().int().min(1, "At least 1 month.").max(REFERRAL_MONTHS_MAX, `Keep it at ${REFERRAL_MONTHS_MAX} months or less.`),
  pendingDays: z.number().int().min(0).max(REFERRAL_PENDING_DAYS_MAX),
  cookieDays: z.number().int().min(1).max(REFERRAL_COOKIE_DAYS_MAX),
});

/** A referral code: lower case letters and digits, 6 to 16. */
export const REFERRAL_CODE = /^[a-z0-9]{6,16}$/;

/** What people type or paste, as a code: trimmed and lower cased; null when it cannot be one. */
export function normalizeReferralCode(text: string | null | undefined): string | null {
  const code = (text ?? "").trim().toLowerCase();
  return REFERRAL_CODE.test(code) ? code : null;
}

/** Letters and digits that are not easily confused (no 0/o, 1/l/i). */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A new code of `length` (8 by default) from `random`, which gives numbers in [0, 1) (Math.random, or a test's). */
export function makeReferralCode(random: () => number = Math.random, length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

/** The address a referral link leads through, relative to Kaizen's own address. */
export const referralPath = (code: string) => `/r/${code}`;

/** The cookie that keeps a referral (D131): kept only after the visitor has allowed it. */
export const REFERRAL_COOKIE = "kaizen_ref";

/** What a fee earns the referrer: rounded down, in the fee's currency. */
export function commissionOn(feeMinor: number, bps: number): number {
  if (!Number.isFinite(feeMinor) || feeMinor <= 0 || bps <= 0) return 0;
  return Number((BigInt(Math.floor(feeMinor)) * BigInt(bps)) / BigInt(10000));
}

/** Whether a fee paid at `paidAt` is inside the referral's months counted from `createdAt`. */
export function withinReferralWindow(createdAt: Date, months: number, paidAt: Date): boolean {
  const end = new Date(createdAt);
  end.setUTCMonth(end.getUTCMonth() + months);
  return paidAt >= createdAt && paidAt < end;
}

export type ReferralEntryKind = "earn" | "apply" | "restore" | "reverse" | "adjust";

export const REFERRAL_KIND_LABELS: Record<ReferralEntryKind, string> = {
  earn: "Earned",
  apply: "Used on an invoice",
  restore: "Returned",
  reverse: "Taken back",
  adjust: "Adjusted by Kaizen",
};

/** An account's referral credit in one currency, in minor units. */
export type ReferralBalance = {
  currency: string;
  availableMinor: number;
  pendingMinor: number;
  /** When the next pending credit becomes usable. */
  pendingAt: string | null;
};

/** One line of the history. */
export type ReferralEntry = {
  id: string;
  kind: ReferralEntryKind;
  currency: string;
  amountMinor: number;
  createdAt: string;
  /** What earned it, e.g. the referred store's name and whether it was a plan fee or a sale fee; never customers. */
  note: string;
};

/** A referred store as its referrer sees it: its name and progress, nothing about its customers. */
export type ReferredStore = {
  storeName: string;
  status: "active" | "void";
  since: string;
  /** Commission earned so far, per currency. */
  earned: { currency: string; minor: number }[];
  /** When its commission window ends. */
  until: string;
};

/** The page /admin/account/referrals draws. */
export type ReferrerOverview = {
  enabled: boolean;
  code: string | null;
  blocked: boolean;
  settings: ReferralSettings;
  visits: number;
  signedUp: number;
  stores: ReferredStore[];
  balances: ReferralBalance[];
  entries: ReferralEntry[];
};

// ---------------------------------------------------------------------------
// The link, and the cookie that keeps it (D58: only after the visitor has allowed marketing)
// ---------------------------------------------------------------------------

/** The full address of a code's link, on Kaizen's own origin. */
export const referralUrl = (origin: string, code: string) => `${origin.replace(/\/+$/, "")}${referralPath(code)}`;

/** Where `/r/{code}` leads: the sign-up form, the code in the address so a visit without any cookie still works. */
export const referralSignUpPath = (code: string | null) => (code ? `/sign-up?ref=${code}` : "/sign-up");

/**
 * Whether the visitor allowed marketing on Kaizen's site, read from the consent cookie. The referral cookie is
 * attribution for a commission, which is marketing, so nothing is kept without it.
 */
export function mayKeepReferral(cookies: string): boolean {
  const name = consentCookieName(null);
  const pair = cookies.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
  return decodeConsent(pair?.slice(name.length + 1))?.choices.marketing === true;
}

/** The code in the referral cookie, when it is one. */
export function readReferralCookie(cookies: string): string | null {
  const pair = cookies.split("; ").find((cookie) => cookie.startsWith(`${REFERRAL_COOKIE}=`));
  return normalizeReferralCode(pair?.slice(REFERRAL_COOKIE.length + 1));
}

/** The `document.cookie` assignment that keeps a code for `days`; null for something that is not a code. */
export function referralCookie(code: string, days: number, secure: boolean): string | null {
  const clean = normalizeReferralCode(code);
  if (!clean || !Number.isFinite(days) || days < 1) return null;
  return `${REFERRAL_COOKIE}=${clean}; Max-Age=${Math.min(Math.floor(days), REFERRAL_COOKIE_DAYS_MAX) * 86400}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * The code a sign-up came with, last click winning: what the address or the form carried (the visitor's latest link),
 * else the cookie (kept only after consent). Null when neither holds one.
 */
export function referralCodeFor(fromAddress: string | null | undefined, fromCookie: string | null | undefined): string | null {
  return normalizeReferralCode(fromAddress) ?? normalizeReferralCode(fromCookie);
}

// ---------------------------------------------------------------------------
// What the admin pages draw
// ---------------------------------------------------------------------------

/** A referrer as the platform sees them (D131): the account, its code and what it has brought in. */
export type AdminReferrer = {
  accountId: string;
  email: string;
  name: string | null;
  code: string;
  blockedAt: string | null;
  blockedReason: string;
  visits: number;
  requests: number;
  stores: number;
  /** Commission earned (before anything taken back) per currency. */
  earned: { currency: string; minor: number }[];
  balances: ReferralBalance[];
};

/** A referred store as the platform sees it: who referred it, and the fees and commission so far. */
export type AdminReferral = {
  id: string;
  storeName: string;
  storeSlug: string;
  referrerEmail: string;
  status: "active" | "void";
  voidReason: string;
  commissionBps: number;
  months: number;
  since: string;
  until: string;
  /** Commission earned per currency, net of what was taken back. */
  earned: { currency: string; minor: number }[];
};

export type AdminReferralTotals = {
  referrers: number;
  referredStores: number;
  /** Commission earned, net, per currency. */
  earned: { currency: string; minor: number }[];
  /** Credit put on invoices, per currency. */
  applied: { currency: string; minor: number }[];
  /** Credit still owed (usable and pending), per currency. */
  outstanding: { currency: string; minor: number }[];
};

/** Sums amounts per currency, never across them, in a stable order. */
export function sumPerCurrency(rows: { currency: string; minor: number }[]): { currency: string; minor: number }[] {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.minor);
  return [...sums].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** A commission rate as people read it: 1000 is "10 %", 250 is "2.5 %". */
export const bpsText = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })} %`;

/** The end of a referral's commission window, `months` after it was made. */
export function referralEnds(createdAt: Date, months: number): Date {
  const end = new Date(createdAt);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}
