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
  /** Categories and tags it reaches (D299 E1), beside `productIds`; with neither, everything. */
  termIds: string[];
  /** The least units of what it reaches, bought once; null for none. */
  minQuantity: number | null;
  /** Only signed-in customers in one of these groups, or these named customers; both empty for everyone. */
  tierIds: string[];
  customerIds: string[];
  /** Its own text is a name only; shoppers use its generated codes. */
  uniqueCodes: boolean;
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
  | "minimum_quantity"
  | "not_eligible"
  | "not_applicable";

/** Whether a code can be used at all right now, before looking at the basket. */
export function availability(
  discount: StoreDiscount,
  context: {
    now: Date;
    used: number;
    usedByCustomer: number;
    signedIn: boolean;
    marketCode: string;
    /** A generated code (D299 E1): how often that one was used; it works once, and the code's own limits do not apply. */
    itemUsed?: number;
    /** The signed-in customer's own id and groups (theirs or their company's), for a code limited to some. */
    customer?: { id: string; tierIds: string[] } | null;
  },
): DiscountProblem | null {
  if (!discount.active) return "inactive";
  if (discount.startsAt && new Date(discount.startsAt) > context.now) return "not_started";
  if (discount.endsAt && new Date(discount.endsAt) <= context.now) return "ended";
  if (context.itemUsed !== undefined) {
    if (context.itemUsed > 0) return "used_up";
  } else {
    if (discount.usageLimit !== null && context.used >= discount.usageLimit) return "used_up";
    if (discount.oncePerCustomer && !context.signedIn) return "sign_in";
    if (discount.oncePerCustomer && context.usedByCustomer > 0) return "already_used";
  }
  if (discount.tierIds.length > 0 || discount.customerIds.length > 0) {
    const customer = context.customer ?? null;
    if (!customer) return "sign_in";
    if (!discount.customerIds.includes(customer.id) && !discount.tierIds.some((id) => customer.tierIds.includes(id))) return "not_eligible";
  }
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
  basket: {
    marketCode: string;
    lines: DiscountLine[];
    shippingMinor: number;
    /** The basket's products in one of the code's categories or tags (or one under them), read by the server (D299 E1). */
    reached?: ReadonlySet<string>;
  },
): { ok: true; applied: AppliedDiscount } | { ok: false; problem: "minimum" | "minimum_quantity" | "not_applicable" | "market" } {
  const subtotal = basket.lines.reduce((sum, line) => sum + line.todayMinor, 0);
  const minimum = discount.minSubtotals[basket.marketCode] ?? 0;
  if (subtotal < minimum) return { ok: false, problem: "minimum" };
  const eligible = basket.lines.filter((line) => reaches(discount, line.productId, basket.reached));
  // The least units of what it reaches, bought once: a subscription and a line costing nothing today do not count.
  if (discount.minQuantity !== null) {
    const units = eligible.filter((line) => !line.recurring && line.todayMinor > 0).reduce((sum, line) => sum + line.quantity, 0);
    if (units < discount.minQuantity) return { ok: false, problem: "minimum_quantity" };
  }
  const applied: AppliedDiscount = { lines: {}, shippingMinor: 0, totalMinor: 0, renewalUnits: {} };

  if (discount.kind === "free_shipping") {
    if (basket.shippingMinor <= 0) return { ok: false, problem: "not_applicable" };
    applied.shippingMinor = basket.shippingMinor;
  } else if (discount.kind === "percent") {
    for (const line of eligible) {
      const lowered = planPrice(line.unitMinor, discount.percent);
      if (line.recurring && discount.recurring) applied.renewalUnits[line.key] = lowered;
      // In a free trial nothing is charged today, so nothing comes off today. A line a campaign has
      // reduced (D114) is no longer whole units at one price: the percentage comes off what is left.
      const campaignReduced = !line.recurring && line.todayMinor > 0 && line.unitMinor * line.quantity !== line.todayMinor;
      const off = line.todayMinor === 0 ? 0 : campaignReduced ? line.todayMinor - planPrice(line.todayMinor, discount.percent) : (line.unitMinor - lowered) * line.quantity;
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

/** Whether a code reaches a product: everything when it names neither products nor terms; else a chosen product or one in a chosen term. */
export function reaches(discount: Pick<StoreDiscount, "productIds" | "termIds">, productId: string, reached?: ReadonlySet<string>): boolean {
  if (discount.productIds === null && discount.termIds.length === 0) return true;
  return Boolean(discount.productIds?.includes(productId)) || Boolean(reached?.has(productId));
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
    termIds: z.array(z.uuid()).max(100).default([]),
    minQuantity: z.coerce.number().int().min(1, "Ask for at least one item, or no minimum.").max(1000, "Ask for at most 1,000 items.").nullable().default(null),
    tierIds: z.array(z.uuid()).max(50).default([]),
    /** The named customers' emails, one per line or separated by commas; the server finds them. */
    customerEmails: z.string().max(20_000).default(""),
    uniqueCodes: z.boolean().default(false),
  })
  .refine((input) => input.productIds === null || input.productIds.length > 0 || input.termIds.length > 0, {
    message: "Choose at least one product, category or tag, or let the code apply to everything.",
  })
  .refine((input) => !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt), {
    message: "The code must end after it starts.",
  });

export type StoreDiscountInput = z.input<typeof storeDiscountInput>;

// ---------------------------------------------------------------------------
// Generated single-use codes (D299 E1)
// ---------------------------------------------------------------------------

/** Characters of a generated code: capitals and digits without look-alikes (no 0, O, 1, I or L). */
export const GENERATED_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const GENERATED_LENGTH = 8;
export const GENERATE_MAX = 10_000;
export const CODE_ITEMS_MAX = 100_000;

/** One generated code: the prefix (if any), a dash and eight random characters, from `random` (crypto's in the server). */
export function generatedCode(prefix: string, random: (n: number) => Uint8Array): string {
  const bytes = random(GENERATED_LENGTH * 2);
  let out = "";
  // Bytes over the largest multiple of the alphabet's length are skipped, so every character is equally likely.
  const limit = 256 - (256 % GENERATED_ALPHABET.length);
  for (let i = 0; out.length < GENERATED_LENGTH; i++) {
    const byte = i < bytes.length ? bytes[i] : random(1)[0];
    if (byte < limit) out += GENERATED_ALPHABET[byte % GENERATED_ALPHABET.length];
  }
  const head = normalizeCode(prefix);
  return head ? `${head}-${out}` : out;
}

export const generateCodesInput = z.object({
  count: z.coerce.number().int().min(1, "Make at least one code.").max(GENERATE_MAX, `Make at most ${GENERATE_MAX.toLocaleString("en-GB")} at a time.`),
  prefix: z
    .string()
    .transform(normalizeCode)
    .refine((value) => value === "" || /^[\p{Lu}\p{N}][\p{Lu}\p{N}_]{0,19}$/u.test(value), "Use up to 20 letters, digits or _ for the prefix.")
    .default(""),
});

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
  /** Changes with what the code gives; a new version is a new coupon in Stripe. */
  updatedAt: string;
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
