import { z } from "zod";

import { CODE_PATTERN, DISCOUNT_KINDS, GENERATE_MAX, PLATFORM_CODE_PATTERN, PLATFORM_DURATIONS, normalizeCode } from "./discounts";

/**
 * The schemas of discounts.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; discounts.ts imports it as a type alone.
 */

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
    combinesWith: z.array(z.enum(["products", "order", "shipping"])).max(3).default([]),
    /** Whether it may be used beside the store's campaigns (D367). */
    combinesWithCampaigns: z.boolean().default(true),
    /** A segment whose people may use it (D380); the server checks it is the store's. */
    segmentId: z.uuid().nullable().default(null),
  })
  .refine((input) => input.productIds === null || input.productIds.length > 0 || input.termIds.length > 0, {
    message: "Choose at least one product, category or tag, or let the code apply to everything.",
  })
  .refine((input) => !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt), {
    message: "The code must end after it starts.",
  });

export type StoreDiscountInput = z.input<typeof storeDiscountInput>;

export const generateCodesInput = z.object({
  count: z.coerce.number().int().min(1, "Make at least one code.").max(GENERATE_MAX, `Make at most ${GENERATE_MAX.toLocaleString("en-GB")} at a time.`),
  prefix: z
    .string()
    .transform(normalizeCode)
    .refine((value) => value === "" || /^[\p{Lu}\p{N}][\p{Lu}\p{N}_]{0,19}$/u.test(value), "Use up to 20 letters, digits or _ for the prefix.")
    .default(""),
});

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
    /** A campaign's name, start and plans (D524); a code without a name is an ordinary code. */
    campaignName: z.string().trim().max(60, "A campaign's name is at most 60 characters.").nullable().default(null),
    startsAt: z.string().trim().nullable().default(null),
    planIds: z.array(z.uuid()).max(50).default([]),
  })
  .refine((input) => input.duration !== "repeating" || input.durationMonths !== null, {
    message: "Say for how many months the discount lasts.",
  });
