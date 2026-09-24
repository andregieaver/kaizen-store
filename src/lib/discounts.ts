import { z } from "zod";

import { planPrice } from "./subscriptions";

/**
 * Discount codes (D31): shoppers' codes at a store's checkout, and Kaizen's
 * own codes for stores' plans. The rules here need no database, so the cart
 * shows exactly what checkout will charge.
 */

/** A store's code: letters (Æ, Ø and Å too), digits, - and _. */
export const CODE_PATTERN = /^[\p{Lu}\p{N}][\p{Lu}\p{N}_-]{2,39}$/u;
/** Kaizen's codes live in Stripe, which takes plain letters and digits. */
export const PLATFORM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

/** Codes are case-insensitive: stored and compared in capitals, without spaces. */
export function normalizeCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export const DISCOUNT_KINDS = ["percent", "fixed", "free_shipping"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export type StoreDiscount = {
  id: string;
  code: string;
  kind: DiscountKind;
  /** Percent off, for `percent`. */
  percent: number;
  /** Amount off in each market's currency, in minor units, for `fixed`: `{"NO": 5000}`. */
  amounts: Record<string, number>;
  /** The least the items must come to in each market; a missing market has none. */
  minSubtotals: Record<string, number>;
  /** The products it applies to; null for everything in the store. */
  productIds: string[] | null;
  /** A percentage that also lowers every renewal of a subscription, not just the first payment. */
  recurring: boolean;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  /** Only signed-in customers, once each (the email is not known before payment otherwise). */
  oncePerCustomer: boolean;
  active: boolean;
};

export type DiscountProblem =
  | "unknown"
  | "inactive"
  | "not_started"
  | "ended"
  | "used_up"
  | "sign_in"
  | "already_used"
  | "market"
  | "minimum"
  | "not_applicable";

/** Whether a code can be used at all right now, before looking at the basket. */
export function availability(
  discount: StoreDiscount,
  context: { now: Date; used: number; usedByCustomer: number; signedIn: boolean; marketCode: string },
): DiscountProblem | null {
  if (!discount.active) return "inactive";
  if (discount.startsAt && new Date(discount.startsAt) > context.now) return "not_started";
  if (discount.endsAt && new Date(discount.endsAt) <= context.now) return "ended";
  if (discount.usageLimit !== null && context.used >= discount.usageLimit) return "used_up";
  if (discount.oncePerCustomer && !context.signedIn) return "sign_in";
  if (discount.oncePerCustomer && context.usedByCustomer > 0) return "already_used";
  if (discount.kind === "fixed" && !(discount.amounts[context.marketCode] > 0)) return "market";
  return null;
}

export type DiscountLine = {
  key: string;
  productId: string;
  /** The price of one unit before the code (the subscriber's price, for a subscription). */
  unitMinor: number;
  quantity: number;
  /** What the line costs today before the code: 0 for a subscription in a free trial. */
  todayMinor: number;
  recurring: boolean;
};

export type AppliedDiscount = {
  /** Off each line today, by key. */
  lines: Record<string, number>;
  /** Off today's shipping. */
  shippingMinor: number;
  totalMinor: number;
  /**
   * Lines whose renewals are lowered too (a recurring percentage), with
   * their new unit price. Their discount today is in the lowered price.
   */
  renewalUnits: Record<string, number>;
};

/**
 * What a code takes off a basket. A percentage comes off each unit (so a
 * subscription's lowered price renews the same); a fixed amount is spread
 * over the lines it applies to, in proportion, never below zero; free
 * shipping takes off today's shipping.
 */
export function applyDiscount(
  discount: StoreDiscount,
  basket: { marketCode: string; lines: DiscountLine[]; shippingMinor: number },
): { ok: true; applied: AppliedDiscount } | { ok: false; problem: "minimum" | "not_applicable" | "market" } {
  const subtotal = basket.lines.reduce((sum, line) => sum + line.todayMinor, 0);
  const minimum = discount.minSubtotals[basket.marketCode] ?? 0;
  if (subtotal < minimum) return { ok: false, problem: "minimum" };
  const eligible = basket.lines.filter(
    (line) => discount.productIds === null || discount.productIds.includes(line.productId),
  );
  const applied: AppliedDiscount = { lines: {}, shippingMinor: 0, totalMinor: 0, renewalUnits: {} };

  if (discount.kind === "free_shipping") {
    if (basket.shippingMinor <= 0) return { ok: false, problem: "not_applicable" };
    applied.shippingMinor = basket.shippingMinor;
  } else if (discount.kind === "percent") {
    for (const line of eligible) {
      const lowered = planPrice(line.unitMinor, discount.percent);
      if (line.recurring && discount.recurring) applied.renewalUnits[line.key] = lowered;
      // In a free trial nothing is charged today, so nothing comes off today.
      const off = line.todayMinor === 0 ? 0 : (line.unitMinor - lowered) * line.quantity;
      if (off > 0) applied.lines[line.key] = off;
    }
    if (Object.keys(applied.lines).length === 0 && Object.keys(applied.renewalUnits).length === 0) {
      return { ok: false, problem: "not_applicable" };
    }
  } else {
    const amount = discount.amounts[basket.marketCode];
    if (!(amount > 0)) return { ok: false, problem: "market" };
    const base = eligible.filter((line) => line.todayMinor > 0);
    const eligibleTotal = base.reduce((sum, line) => sum + line.todayMinor, 0);
    if (eligibleTotal === 0) return { ok: false, problem: "not_applicable" };
    const off = Math.min(amount, eligibleTotal);
    // Largest remainder, so the parts add up to the whole exactly.
    const shares = base.map((line) => {
      const exact = (off * line.todayMinor) / eligibleTotal;
      return { key: line.key, floor: Math.floor(exact), rest: exact - Math.floor(exact), cap: line.todayMinor };
    });
    let left = off - shares.reduce((sum, s) => sum + s.floor, 0);
    for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
      if (left === 0) break;
      if (share.floor < share.cap) {
        share.floor += 1;
        left -= 1;
      }
    }
    for (const share of shares) if (share.floor > 0) applied.lines[share.key] = share.floor;
  }

  applied.totalMinor = Object.values(applied.lines).reduce((sum, off) => sum + off, 0) + applied.shippingMinor;
  return { ok: true, applied };
}

/** What a store's code gives, in English for the admin: "20 % off", "NOK 50.00 off", "Free shipping". */
export function describeDiscount(
  discount: Pick<StoreDiscount, "kind" | "percent" | "amounts" | "recurring">,
  money: (minor: number, marketCode: string) => string,
): string {
  if (discount.kind === "free_shipping") return "Free shipping";
  if (discount.kind === "percent") return `${discount.percent} % off${discount.recurring ? ", every renewal" : ""}`;
  return `${Object.entries(discount.amounts)
    .map(([market, minor]) => money(minor, market))
    .join(" / ")} off`;
}

/** Where a code stands today, for the admin's list. */
export function discountStatus(
  discount: Pick<StoreDiscount, "active" | "startsAt" | "endsAt" | "usageLimit">,
  used: number,
  now = new Date(),
): "active" | "off" | "scheduled" | "ended" | "used_up" {
  if (!discount.active) return "off";
  if (discount.endsAt && new Date(discount.endsAt) <= now) return "ended";
  if (discount.usageLimit !== null && used >= discount.usageLimit) return "used_up";
  if (discount.startsAt && new Date(discount.startsAt) > now) return "scheduled";
  return "active";
}

// ---------------------------------------------------------------------------
// The admin's form
// ---------------------------------------------------------------------------

const code = z
  .string()
  .transform(normalizeCode)
  .refine((value) => CODE_PATTERN.test(value), "Use 3–40 letters, digits, - or _ for the code.");

const platformCode = z
  .string()
  .transform(normalizeCode)
  .refine((value) => PLATFORM_CODE_PATTERN.test(value), "Use 3–40 letters A–Z, digits, - or _ for the code.");

/** A store's code as the admin sends it; amounts are typed text, converted per market. */
export const storeDiscountInput = z
  .object({
    code,
    kind: z.enum(DISCOUNT_KINDS),
    percent: z.coerce.number().int().min(1, "Take off at least 1 %.").max(100, "Take off at most 100 %.").default(10),
    amounts: z.record(z.string(), z.string().trim()).default({}),
    minSubtotals: z.record(z.string(), z.string().trim()).default({}),
    productIds: z.array(z.uuid()).nullable().default(null),
    recurring: z.boolean().default(false),
    startsAt: z.string().trim().nullable().default(null),
    endsAt: z.string().trim().nullable().default(null),
    usageLimit: z.coerce.number().int().min(1, "Allow at least one use, or no limit.").max(1_000_000).nullable().default(null),
    oncePerCustomer: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((input) => input.productIds === null || input.productIds.length > 0, {
    message: "Choose at least one product, or let the code apply to everything.",
  })
  .refine((input) => !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt), {
    message: "The code must end after it starts.",
  });

export type StoreDiscountInput = z.input<typeof storeDiscountInput>;

// ---------------------------------------------------------------------------
// Kaizen's codes for plans
// ---------------------------------------------------------------------------

export const PLATFORM_DURATIONS = ["once", "repeating", "forever"] as const;
export type PlatformDuration = (typeof PLATFORM_DURATIONS)[number];

export type PlatformDiscount = {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  percent: number;
  /** Amount off per plan currency, lower-case as Stripe writes it: `{"nok": 10000}`. */
  amounts: Record<string, number>;
  duration: PlatformDuration;
  durationMonths: number | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  active: boolean;
  createdAt: string;
};

export const platformDiscountInput = z
  .object({
    code: platformCode,
    kind: z.enum(["percent", "fixed"]),
    percent: z.coerce.number().int().min(1).max(100).default(10),
    amounts: z.record(z.string(), z.string().trim()).default({}),
    duration: z.enum(PLATFORM_DURATIONS),
    durationMonths: z.coerce.number().int().min(1).max(36).nullable().default(null),
    expiresAt: z.string().trim().nullable().default(null),
    maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).nullable().default(null),
  })
  .refine((input) => input.duration !== "repeating" || input.durationMonths !== null, {
    message: "Say for how many months the discount lasts.",
  });

/** "20 % off for 3 months", in English for store owners (the admin is in English). */
export function platformDiscountSummary(
  discount: Pick<PlatformDiscount, "kind" | "percent" | "amounts" | "duration" | "durationMonths">,
  money: (minor: number, currency: string) => string,
): string {
  const off =
    discount.kind === "percent"
      ? `${discount.percent} % off`
      : `${Object.entries(discount.amounts)
          .map(([currency, minor]) => money(minor, currency.toUpperCase()))
          .join(" / ")} off`;
  const how =
    discount.duration === "once"
      ? "the first payment"
      : discount.duration === "forever"
        ? "every payment"
        : `${discount.durationMonths} ${discount.durationMonths === 1 ? "month" : "months"}`;
  return discount.duration === "repeating" ? `${off} for ${how}` : `${off} ${how}`;
}
