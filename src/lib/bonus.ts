import { z } from "zod";

/**
 * The bonus program (D130): a store's signed-in customers earn *credits* on what they pay and use them on a later
 * order. Decided with the owner:
 * - **Money credits**: 1 credit is 1 unit of the store's main currency (`mainCurrency(store)`), kept as integer minor
 *   units in that currency; other currencies are converted at the store's rates when earned and used, never stored.
 *   The owner sets the percentage back (`earnBps`, basis points: 500 is 5%).
 * - **Earned on what was paid online for goods**: the order's total without shipping, without what is due at a venue
 *   (D66) and without the credits used on it, VAT included. Nothing for guests (only signed-in customers have a balance),
 *   nothing on a copied order (D129), nothing on a free gift line.
 * - **Pending, then available**: a grant is pending until the return period has passed (`pendingDays`, 14 by default),
 *   then usable. A refund or cancellation takes back the credits the refunded part earned, never below zero: what was
 *   already used stays used.
 * - **Used as a price reduction**: the customer chooses how much (or all) at checkout; it comes off goods only, last,
 *   on what is left after campaigns (D114), the group's discount (D108) and codes (D31), never above
 *   `maxRedeemPercent` of that, and never so that less than the payment provider's smallest charge is left to pay.
 *   Only what is actually paid earns new credits. Credits used on an order come back (in part, by refunded share) when
 *   that order is cancelled or refunded.
 * - **Expiry** is the owner's choice (`expiresMonths`, none by default), oldest credits first, with a reminder email.
 * Pure types, checks and arithmetic, shared by the browser and the server, which checks everything again.
 */

export const BONUS_EARN_BPS_MAX = 5000;
export const BONUS_PENDING_DAYS_MAX = 90;
export const BONUS_REDEEM_PERCENT_MAX = 90;
export const BONUS_EXPIRY_MONTHS_MAX = 60;

export type BonusSettings = {
  /** The program is off until the owner turns it on. */
  enabled: boolean;
  /** Credits earned per 100 paid, in basis points: 500 is 5%. */
  earnBps: number;
  /** Days after the order is paid before its credits can be used (the return period). */
  pendingDays: number;
  /** The most of an order's goods credits may pay for, in percent. */
  maxRedeemPercent: number;
  /** The least a customer can use at once, in minor units of the credits' currency; 0 for no minimum. */
  minRedeemMinor: number;
  /** Months after which unused credits expire (oldest first); null for never. */
  expiresMonths: number | null;
};

export const BONUS_DEFAULTS: BonusSettings = {
  enabled: false,
  earnBps: 500,
  pendingDays: 14,
  maxRedeemPercent: 50,
  minRedeemMinor: 0,
  expiresMonths: null,
};

export const bonusSettingsInput = z.object({
  enabled: z.boolean(),
  earnBps: z.number().int().min(0, "Credits back cannot be below 0%.").max(BONUS_EARN_BPS_MAX, `Keep credits back at ${BONUS_EARN_BPS_MAX / 100}% or less.`),
  pendingDays: z.number().int().min(0).max(BONUS_PENDING_DAYS_MAX, `Keep the wait at ${BONUS_PENDING_DAYS_MAX} days or less.`),
  maxRedeemPercent: z.number().int().min(1, "Allow at least 1% of an order.").max(BONUS_REDEEM_PERCENT_MAX, `Keep the most at ${BONUS_REDEEM_PERCENT_MAX}% so the order still has something to pay.`),
  minRedeemMinor: z.number().int().min(0).max(1_000_000),
  expiresMonths: z.number().int().min(1).max(BONUS_EXPIRY_MONTHS_MAX).nullable(),
});

/** What the ledger records: a grant, a use, and what undoes or ends one. */
export type BonusEntryKind =
  | "earn" // credits granted for a paid order (pending until `availableAt`)
  | "redeem" // credits used on an order
  | "restore" // used credits returned because the order was cancelled or refunded
  | "reverse" // granted credits taken back because the order was cancelled or refunded
  | "expire" // credits that passed their expiry unused
  | "adjust" // added or removed by staff, with a reason
  | "referral"; // granted to a referrer for a friend's paid order (D131, the affiliate program)

export const BONUS_KIND_LABELS: Record<BonusEntryKind, string> = {
  earn: "Earned",
  redeem: "Used",
  restore: "Returned",
  reverse: "Taken back",
  expire: "Expired",
  adjust: "Adjusted by the store",
  referral: "Referral reward",
};

/** Kinds that are lots: credits granted to be used until they are (earned on an order, or for a friend's order). */
export const isGrantKind = (kind: BonusEntryKind): boolean => kind === "earn" || kind === "referral";

/** One line of a customer's history, amounts in the credits' currency (signed: what was added or taken). */
export type BonusEntry = {
  id: string;
  kind: BonusEntryKind;
  amountMinor: number;
  at: string;
  /** For a grant: when it becomes usable (past means already usable). */
  availableAt: string | null;
  /** For a grant: when what is left of it expires, if ever. */
  expiresAt: string | null;
  /** The order it belongs to, as its number, and its id (for a link where the viewer may open it). */
  orderNumber: string | null;
  orderId: string | null;
  note: string;
};

/** A customer's credits now, in the credits' currency. */
export type BonusBalance = {
  currency: string;
  /** Usable now. */
  availableMinor: number;
  /** Granted but not usable yet. */
  pendingMinor: number;
  /** When the next pending credits become usable, or null when none are pending. */
  pendingAvailableAt?: string | null;
  /** Next credits to expire, or null. */
  expiringSoon: { amountMinor: number; at: string } | null;
};

/** Credits earned on an amount paid: rounded down, never negative. */
export function earnAmount(paidMinor: number, earnBps: number): number {
  if (!Number.isFinite(paidMinor) || paidMinor <= 0 || earnBps <= 0) return 0;
  return Math.floor((paidMinor * earnBps) / 10_000);
}

/**
 * The most credits usable on an order, in the ORDER's currency minor units: no more than the balance, than the owner's
 * percentage of the goods that are left to pay, or than leaves `minPayableMinor` to pay, and none below the owner's
 * minimum. `eligibleMinor` is the goods after campaigns, group discount and codes; `dueMinor` everything still to pay
 * then (goods and shipping).
 */
export function redeemLimit(input: {
  eligibleMinor: number;
  dueMinor: number;
  balanceMinor: number;
  maxPercent: number;
  minRedeemMinor?: number;
  minPayableMinor?: number;
}): number {
  const byPercent = Math.floor((Math.max(0, input.eligibleMinor) * input.maxPercent) / 100);
  const byDue = Math.max(0, input.dueMinor - (input.minPayableMinor ?? 0));
  const limit = Math.max(0, Math.min(input.balanceMinor, byPercent, byDue));
  return limit < (input.minRedeemMinor ?? 0) ? 0 : limit;
}

/** How much of an order's credits come back for a refunded share: `refunded` of `total` (both in the order's currency). */
export function restoreShare(redeemedMinor: number, refundedMinor: number, totalMinor: number): number {
  if (redeemedMinor <= 0 || refundedMinor <= 0 || totalMinor <= 0) return 0;
  if (refundedMinor >= totalMinor) return redeemedMinor;
  return Math.min(redeemedMinor, Math.floor((redeemedMinor * refundedMinor) / totalMinor));
}

// ---------------------------------------------------------------------------
// What the shop's screens show (amounts in what the shopper sees, the market's currency)
// ---------------------------------------------------------------------------

/** The credits in a cart or checkout, for the shopper. */
export type CartBonus = {
  /** The program is on for this store. */
  enabled: boolean;
  /** Signed in: only then is there a balance to use or earn on. */
  signedIn: boolean;
  /** Usable now, in the market's currency. */
  availableMinor: number;
  /** Granted but not usable yet. */
  pendingMinor: number;
  /** When the next pending credits become usable, or null. */
  pendingAvailableAt: string | null;
  /** The most that can be used on this order now (0 when none), and what is used now. */
  maxUsableMinor: number;
  usingMinor: number;
  /** What this order will earn once paid (0 for a guest), and the percentage back. */
  willEarnMinor: number;
  earnPercent: number;
  /** Days before credits earned on this order can be used. */
  pendingDays: number;
};

/** A customer's own credits on My account: balance and history in the market's currency. */
export type ShopperBonus = {
  enabled: boolean;
  currency: string;
  balance: BonusBalance;
  entries: BonusEntry[];
  earnPercent: number;
  pendingDays: number;
  expiresMonths: number | null;
};

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

/** What the program owes and did lately, for the owner's page (the credits' currency, minor units). */
export type BonusOverview = {
  currency: string;
  /** Usable credits across all customers: what the store still owes in price reductions. */
  outstandingMinor: number;
  pendingMinor: number;
  earned30dMinor: number;
  redeemed30dMinor: number;
  expired30dMinor: number;
  customersWithCredits: number;
};

export type BonusResult<T extends object = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

// ---------------------------------------------------------------------------
// Using credits at checkout (D130): shared by the cart page and `placeOrder()`, which must agree to the minor unit
// ---------------------------------------------------------------------------

/**
 * The payment provider's smallest charge per currency, in minor units (Stripe's published minimums): a payment below it
 * is refused, so credits never leave less than this to pay. Unknown currencies get the euro's.
 */
export const MIN_CHARGE_MINOR: Readonly<Record<string, number>> = {
  EUR: 50,
  USD: 50,
  CHF: 50,
  GBP: 30,
  DKK: 250,
  NOK: 300,
  SEK: 300,
  PLN: 200,
  RON: 200,
  CZK: 1500,
  HUF: 17500,
};

export const minChargeMinor = (currency: string): number => MIN_CHARGE_MINOR[currency] ?? 50;

/** Days before credits expire that the customer is reminded by email. */
export const BONUS_EXPIRY_REMINDER_DAYS = 14;

/** The newest entries a customer's history shows. */
export const BONUS_HISTORY_LIMIT = 200;

/**
 * An amount in one currency's minor units as another's at the store's rates (units of each per 1 EUR; euro is 1), rounded
 * down or up and never to a step, so a balance shown in another currency never promises more than it holds. Null when
 * either currency has no rate. Every currency a store can offer has two minor-unit digits, so the rates alone convert.
 */
export function convertCredits(
  amountMinor: number,
  from: string,
  to: string,
  rates: ReadonlyMap<string, { rate: number | null }>,
  rounding: "down" | "up" = "down",
): number | null {
  if (from === to) return amountMinor;
  const rateOf = (currency: string) => (currency === "EUR" ? 1 : (rates.get(currency)?.rate ?? null));
  const a = rateOf(from);
  const b = rateOf(to);
  if (a === null || b === null || !(a > 0) || !(b > 0)) return null;
  // Multiply before dividing: 115 at 11.5 is exactly 10, not 9.999…
  const exact = (amountMinor * b) / a;
  const nearest = Math.round(exact);
  if (Math.abs(exact - nearest) < 1e-7) return nearest;
  return rounding === "down" ? Math.floor(exact) : Math.ceil(exact);
}

/**
 * Spreads `creditMinor` over lines in proportion to what each can take (`capsMinor`: its goods after the other discounts,
 * paid online), by largest remainder so the parts add up to the whole exactly and no line is given more than its cap.
 * The credit is at most the sum of the caps.
 */
export function allocateCredit(capsMinor: readonly number[], creditMinor: number): number[] {
  const total = capsMinor.reduce((sum, cap) => sum + Math.max(0, cap), 0);
  const credit = Math.min(Math.max(0, creditMinor), total);
  if (credit === 0 || total === 0) return capsMinor.map(() => 0);
  const shares = capsMinor.map((cap, index) => {
    const exact = (credit * Math.max(0, cap)) / total;
    return { index, floor: Math.floor(exact), rest: exact - Math.floor(exact), cap: Math.max(0, cap) };
  });
  let left = credit - shares.reduce((sum, share) => sum + share.floor, 0);
  for (const share of [...shares].sort((x, y) => y.rest - x.rest || x.index - y.index)) {
    if (left === 0) break;
    if (share.floor < share.cap) {
      share.floor += 1;
      left -= 1;
    }
  }
  const out = capsMinor.map(() => 0);
  for (const share of shares) out[share.index] = share.floor;
  return out;
}

export type CreditPlan = {
  /** The most that can be used on this order now, and what is used (the request, clamped). */
  maxUsableMinor: number;
  usingMinor: number;
  /** What each line's credit is, in the order of `eligibleMinor`; adds up to `usingMinor`. */
  lines: number[];
};

/**
 * What credits do to an order, in the ORDER's currency. `eligibleMinor` is each line's goods still to pay online after
 * campaigns, the group's discount and codes (nothing for subscriptions, gifts or what is left for a venue); `dueMinor`
 * everything to pay online (goods, shipping and fees); `balanceMinor` the usable credits as the order's currency.
 * `requestMinor` is what the shopper asked for, clamped to `redeemLimit()`.
 */
export function planCredit(input: {
  eligibleMinor: readonly number[];
  dueMinor: number;
  balanceMinor: number;
  requestMinor: number;
  maxPercent: number;
  minRedeemMinor: number;
  minPayableMinor: number;
}): CreditPlan {
  const eligible = input.eligibleMinor.reduce((sum, cap) => sum + Math.max(0, cap), 0);
  const maxUsableMinor = redeemLimit({
    eligibleMinor: eligible,
    dueMinor: input.dueMinor,
    balanceMinor: input.balanceMinor,
    maxPercent: input.maxPercent,
    minRedeemMinor: input.minRedeemMinor,
    minPayableMinor: input.minPayableMinor,
  });
  const usingMinor = Math.min(maxUsableMinor, Math.max(0, Math.floor(input.requestMinor)));
  // Below the owner's minimum nothing is used, however little was asked for.
  const used = usingMinor < input.minRedeemMinor ? 0 : usingMinor;
  return { maxUsableMinor, usingMinor: used, lines: allocateCredit(input.eligibleMinor, used) };
}

/** What the program owes, for the reminder email: credits expiring on one date. `amountMinor` is in the credits' currency. */
export type BonusExpiryReminder = {
  storeId: string;
  customerId: string;
  /** When the first of them expires. */
  firstExpiresAt: string;
  /** What expires within the reminder window, in the credits' currency. */
  amountMinor: number;
  currency: string;
};
