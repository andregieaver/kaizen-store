/**
 * A draft order as the editor sends it and the server saves it (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.4): one schema, shared by the browser (which
 * builds it and shows the problems) and the server (`saveDraft()`, the AI manager's `create_draft_order`). Money is typed text in major units ("249,00", "10,5"),
 * read with `parsePrice()` for the draft's currency and `parsePercentBps()`, never a float; the server prices a draft only through `priceDraft()` and never trusts a
 * number from the browser for a total. This is an admin schema (zod is fine here; the cart page's gift fields are `src/lib/gift.ts`, which has none).
 */
import { z } from "zod";

import { cleanShopperText } from "./gift";
import {
  DISCOUNT_BPS_MAX,
  DISCOUNT_BPS_MIN,
  DRAFT_DISCOUNT_LABEL_MAX,
  DRAFT_INTERNAL_NOTE_MAX,
  DRAFT_LINES_MAX,
  DRAFT_NOTE_TO_BUYER_MAX,
  DRAFT_QUANTITY_MAX,
  DRAFT_REFERENCE_MAX,
  DRAFT_TITLE_MAX,
  DRAFT_VALID_DAYS_MAX,
  DRAFT_VALID_DAYS_MIN,
  TAGS_PER_ORDER,
} from "./order-limits";
import { tagsOf } from "./order-tags";

/** The note lines a buyer reads: a few short paragraphs. */
export const NOTE_TO_BUYER_LINES = 12;

const text = (max: number) => z.string().trim().max(max);
/** A text that may be left empty: empty becomes null. */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null))
    .pipe(z.string().max(max).nullable());

/** Text that goes to the buyer or is typed freely: cleaned like any shopper text (no control or disguising characters), refused (not cut) when too long. */
function cleanedText(max: number, lines: number, what: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value, ctx) => {
      const result = cleanShopperText(value ?? "", { maxChars: max, maxLines: lines });
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.problem === "too_long" ? `${what} is ${result.over} characters too long (at most ${max}).` : `${what} has too many lines (at most ${lines}).` });
        return z.NEVER;
      }
      return result.value;
    });
}

/** The address as orders keep it (`orders.shipping_address`): all parts optional text; the country is the market's unless typed. */
export const draftAddress = z
  .object({
    name: optionalText(120),
    line1: optionalText(120),
    line2: optionalText(120),
    postalCode: optionalText(20),
    city: optionalText(80),
    country: optionalText(2),
  })
  .default({ name: null, line1: null, line2: null, postalCode: null, city: null, country: null });
export type DraftAddress = z.infer<typeof draftAddress>;

// ---------------------------------------------------------------------------------------------------------------------
// Typed numbers
// ---------------------------------------------------------------------------------------------------------------------

/** A typed percent ("10", "10,5", "0.25", "12.50 %") as basis points: 0.01 % to 100.00 %, at most two decimals; null when it is not one. */
export function parsePercentBps(value: string): number | null {
  const compact = value.replace(/[\s\u00a0%]/g, "");
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(compact);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps >= DISCOUNT_BPS_MIN && bps <= DISCOUNT_BPS_MAX ? bps : null;
}

/** Basis points as the text of the field: 1050 is "10,5", 10000 is "100". */
export function formatPercentBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole},${fraction}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A line. A catalogue line names a variant of goods and has an optional custom price (typed text; null or empty is the market's list price as shown); a custom item has
 * a title, a price and a VAT category (a service: no stock, no shipping). `id` is the saved line's id when it already exists.
 */
export const draftLineInput = z
  .object({
    id: z.uuid().nullish(),
    kind: z.enum(["goods", "custom"]),
    variantId: z.uuid().nullish(),
    title: text(DRAFT_TITLE_MAX).default(""),
    quantity: z.number().int().min(1).max(DRAFT_QUANTITY_MAX),
    /** Typed in major units, VAT included, in the draft's currency. Goods: null or "" for the list price. Custom: required. */
    price: z.string().trim().max(24).nullish(),
    /** A custom item's VAT category (`commerce.vat_categories`). */
    vatCategory: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/).nullish(),
  })
  .superRefine((line, ctx) => {
    if (line.kind === "goods") {
      if (!line.variantId) ctx.addIssue({ code: "custom", message: "Choose a product for this line.", path: ["variantId"] });
    } else {
      if (line.title.trim() === "") ctx.addIssue({ code: "custom", message: "A custom item needs a title.", path: ["title"] });
      if (!line.price || line.price.trim() === "") ctx.addIssue({ code: "custom", message: "A custom item needs a price.", path: ["price"] });
      if (!line.vatCategory) ctx.addIssue({ code: "custom", message: "Choose the VAT category of a custom item.", path: ["vatCategory"] });
    }
  });
export type DraftLineInput = z.infer<typeof draftLineInput>;

export const draftDiscountInput = z
  .object({
    kind: z.enum(["percent", "amount"]),
    /** A percent ("10", "10,5") or an amount in major units of the draft's currency. */
    value: z.string().trim().min(1).max(24),
    /** What the buyer sees on the pay page, the order and the invoice. */
    label: z.string().trim().min(1, "Name the discount: the buyer sees it.").max(DRAFT_DISCOUNT_LABEL_MAX),
  })
  .nullable()
  .default(null);

export const draftShippingInput = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("rate") }),
    z.object({ kind: z.literal("free") }),
    z.object({ kind: z.literal("custom"), /** Major units, VAT included. */ price: z.string().trim().min(1, "Set the shipping price.").max(24) }),
  ])
  .default({ kind: "rate" });

/** The draft as saved. `version` is the version the editor was showing: a save of an old version is refused (two staff at once). */
export const draftInput = z.object({
  version: z.number().int().min(1),
  /** The market's address as shown (`no`, `no-en-eur`); the server resolves it with `resolveShop()` and refuses one the store does not have. */
  marketSlug: z.string().trim().regex(/^[a-z]{2}(?:-[a-z]{2,3}){0,2}$/, "Choose a market."),
  customerId: z.uuid().nullish(),
  email: optionalText(254),
  phone: optionalText(40),
  shippingAddress: draftAddress,
  billingAddress: draftAddress,
  companyName: optionalText(120),
  organisationNumber: optionalText(30),
  noteToBuyer: cleanedText(DRAFT_NOTE_TO_BUYER_MAX, NOTE_TO_BUYER_LINES, "The note to the buyer"),
  internalNote: cleanedText(DRAFT_INTERNAL_NOTE_MAX, 30, "The internal note"),
  /** Tags as typed (labels); validated by `tagsOf()` on the server and carried to the order when the draft is sent. */
  tags: z.array(z.string().max(120)).max(TAGS_PER_ORDER).default([]),
  discount: draftDiscountInput,
  shipping: draftShippingInput,
  lines: z.array(draftLineInput).max(DRAFT_LINES_MAX).default([]),
});
export type DraftInput = z.infer<typeof draftInput>;

/** Checks the typed tags once; the first problem is the one shown. */
export function draftTagProblems(tags: readonly string[]): string | null {
  const parsed = tagsOf(tags);
  return parsed.problems.length > 0 ? `The tag “${parsed.problems[0].input}” is not valid.` : null;
}

/** Sending: how long the link is valid (days, 1 to 30; omitted is the store's default). `createLink` makes a link to share instead of an email. */
export const draftSendInput = z.object({
  version: z.number().int().min(1),
  validDays: z.number().int().min(DRAFT_VALID_DAYS_MIN).max(DRAFT_VALID_DAYS_MAX).optional(),
  createLink: z.boolean().default(false),
});
export type DraftSendInput = z.infer<typeof draftSendInput>;

/** How money taken outside Kaizen was received. */
export const MANUAL_PAYMENT_METHODS = ["bank_transfer", "cash", "other"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const MANUAL_METHOD_LABELS: Record<ManualPaymentMethod, string> = { bank_transfer: "Bank transfer", cash: "Cash", other: "Other" };

/** Marking a draft paid outside Kaizen: the method (required) and a reference (kept in the order event's `data.note`, never in the audit entry). */
export const draftPaidOutsideInput = z.object({
  version: z.number().int().min(1),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  /**
   * The store day the money was received (`YYYY-MM-DD`), when it is not today: it decides the invoice's supply date and so the VAT and OSS period. Not in the future and at most `MANUAL_RECEIVED_DAYS_MAX` days back,
   * which the server checks against the store's own day.
   */
  receivedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v))
    .optional(),
  reference: z
    .string()
    .trim()
    .max(DRAFT_REFERENCE_MAX)
    .optional()
    .transform((v) => (v ? v : null)),
});
export type DraftPaidOutsideInput = z.infer<typeof draftPaidOutsideInput>;

/** Recording a refund of money that was taken outside Kaizen: the amount in major units and why; staff paid the customer back themselves. */
export const manualRefundInput = z.object({
  amount: z.string().trim().min(1).max(24),
  reason: z.string().trim().min(1, "Say why.").max(200),
  restock: z.boolean().default(true),
});
export type ManualRefundInput = z.infer<typeof manualRefundInput>;
