import { z } from "zod";

import {
  BUY_MIN_MAX,
  CAMPAIGN_KINDS,
  CAMPAIGN_NAME_MAX,
  GET_KINDS,
  GET_QUANTITY_MAX,
  GIFT_QUANTITY_MAX,
  MULTI_BUY_MAX,
  TIERS_MAX,
  TIERS_MIN,
  TIER_BASES,
  TIER_QUANTITY_MAX,
  USES_PER_ORDER_MAX,
} from "./campaigns";

/**
 * The schemas of campaigns.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; campaigns.ts imports it as a type alone.
 */

const whole = (min: number, max: number, message: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().int(message).min(min, message).max(max, message));

/** A campaign as the admin sends it; amounts are typed text, converted per market. */
export const campaignInput = z
  .object({
    name: z.string().trim().min(1, "Give the campaign a name shoppers will recognise.").max(CAMPAIGN_NAME_MAX, `Keep the name to ${CAMPAIGN_NAME_MAX} characters.`),
    kind: z.enum(CAMPAIGN_KINDS),
    percent: whole(1, 100, "Take off between 1 and 100 %.").default(10),
    buyQuantity: whole(2, MULTI_BUY_MAX, `Buy between 2 and ${MULTI_BUY_MAX} items.`).default(3),
    payQuantity: whole(1, MULTI_BUY_MAX, "Pay for at least 1 item.").default(2),
    giftVariantId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
    giftQuantity: whole(1, GIFT_QUANTITY_MAX, `Give between 1 and ${GIFT_QUANTITY_MAX} of the product.`).default(1),
    thresholds: z.record(z.string(), z.string().trim()).default({}),
    /** What an amount campaign takes off, typed per market (D299 E3). */
    amounts: z.record(z.string(), z.string().trim()).default({}),
    /** A tiered campaign's basis and its steps, amounts typed per market. */
    tierBasis: z.enum(TIER_BASES).default("quantity"),
    /** What every step of a tiered campaign gives: a percentage off, or an amount off per market (D392). */
    tierGive: z.enum(["percent", "amount"]).default("percent"),
    /** Buy X get Y (D299 E4): the buy measure (`items` or `spend`), the get set (`same` or chosen), what each given unit gets. */
    buyBasis: z.enum(["items", "spend"]).default("items"),
    buyMinQuantity: whole(1, BUY_MIN_MAX, `Ask for between 1 and ${BUY_MIN_MAX} items.`).default(2),
    buyMinAmounts: z.record(z.string(), z.string().trim()).default({}),
    getScope: z.enum(["same", "some"]).default("same"),
    getProductIds: z.array(z.uuid()).default([]),
    getTermIds: z.array(z.uuid()).default([]),
    getQuantity: whole(1, GET_QUANTITY_MAX, `Give between 1 and ${GET_QUANTITY_MAX} items.`).default(1),
    getKind: z.enum(GET_KINDS).default("free"),
    getPercent: whole(1, 100, "Take off between 1 and 100 %.").default(50),
    getAmounts: z.record(z.string(), z.string().trim()).default({}),
    usesPerOrder: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole uses, please.").min(1, "Allow at least one use, or no limit.").max(USES_PER_ORDER_MAX).nullable()).default(null),
    tiers: z
      .array(
        z.object({
          quantity: z.preprocess((v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole items, please.").min(1, "A step asks for at least 1 item.").max(TIER_QUANTITY_MAX, `A step asks for at most ${TIER_QUANTITY_MAX} items.`).nullable()).default(null),
          amounts: z.record(z.string(), z.string().trim()).default({}),
          // A percentage step takes 1 to 100 %; an amount step (`tierGive` "amount") takes its amounts per market instead (D392).
          percent: z.preprocess((v) => (v === "" || v === undefined || v === null ? 0 : typeof v === "string" ? Number(v) : v), z.number().int("Whole percentages, please.").min(0).max(100, "Each step takes off between 1 and 100 %.")).default(0),
          off: z.record(z.string(), z.string().trim()).default({}),
        }),
      )
      .max(TIERS_MAX, `Give at most ${TIERS_MAX} steps.`)
      .default([]),
    /** "all": everything in the store; "some": only the chosen products and the products in the chosen categories and tags. */
    scope: z.enum(["all", "some"]).default("all"),
    productIds: z.array(z.uuid()).default([]),
    termIds: z.array(z.uuid()).default([]),
    /** Customer groups it is for (D108); none for everyone. */
    tierIds: z.array(z.uuid()).default([]),
    /** Orders that may get it in all; empty for no limit. */
    usageLimit: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole orders, please.").min(1, "Allow at least one order, or no limit.").max(1_000_000).nullable()).default(null),
    /** Orders one signed-in customer may get it on; empty for no limit. */
    perCustomerLimit: z.preprocess((v) => (v === "" || v === undefined ? null : typeof v === "string" ? Number(v) : v), z.number().int("Whole orders, please.").min(1, "Allow at least one order each, or no limit.").max(1000).nullable()).default(null),
    /** The countries (market codes) it runs in; none for all. */
    markets: z.array(z.string().regex(/^[A-Z]{2}$/)).default([]),
    /** A percentage or "buy N pay for M" also applied on top of other campaigns. */
    stacks: z.boolean().default(false),
    /** Whether discount codes may be used beside it (D367). */
    combinesWithCodes: z.boolean().default(true),
    /** A segment whose people get it (D380); the server checks it is the store's. */
    segmentId: z.uuid().nullable().default(null),
    startsAt: z.string().trim().nullable().default(null),
    endsAt: z.string().trim().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((input) => input.kind !== "multi_buy" || input.payQuantity < input.buyQuantity, {
    message: "Shoppers must pay for fewer items than they buy: 3 for 2, not 2 for 3.",
  })
  .refine((input) => !input.stacks || input.kind !== "gift", { message: "A free product cannot be added on top of other campaigns: it is given whatever else applies." })
  .refine((input) => !input.stacks || (input.kind !== "amount" && input.kind !== "free_shipping"), {
    message: "An amount off or free shipping cannot be added on top of other campaigns.",
  })
  .refine((input) => input.kind !== "bxgy" || input.getScope === "same" || input.getProductIds.length + input.getTermIds.length > 0, {
    message: "Choose what shoppers get: products, categories or tags, or the same as what they buy.",
  })
  .refine((input) => !input.stacks || input.kind !== "bxgy", { message: "Buy one thing, get another cannot be added on top of other campaigns." })
  .refine((input) => input.kind !== "tiered" || input.tiers.length >= TIERS_MIN, { message: `Give at least ${TIERS_MIN} steps.` })
  .refine((input) => input.kind !== "tiered" || input.tierGive !== "percent" || input.tiers.every((tier) => tier.percent >= 1), {
    message: "Each step takes off between 1 and 100 %.",
  })
  .refine((input) => !input.stacks || input.kind !== "tiered" || input.tierGive !== "amount", { message: "Steps that take an amount off cannot be added on top of other campaigns." })
  .refine((input) => input.kind !== "tiered" || input.tierBasis !== "quantity" || input.tiers.every((tier) => tier.quantity !== null), {
    message: "Say how many items each step asks for.",
  })
  .refine((input) => input.kind !== "gift" || input.giftVariantId !== null, { message: "Choose the product to give." })
  .refine((input) => input.scope === "all" || input.productIds.length + input.termIds.length > 0, {
    message: "Choose at least one product, category or tag, or let the campaign apply to everything.",
  })
  .refine((input) => !input.startsAt || !input.endsAt || new Date(input.startsAt) < new Date(input.endsAt), {
    message: "The campaign must end after it starts.",
  });

export type CampaignInput = z.input<typeof campaignInput>;
