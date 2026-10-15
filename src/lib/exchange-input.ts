/**
 * What staff send to the exchange's server actions (wave 3, D239, `docs/wave-3-exchanges.md` 2.2): the builder (replacements, shipping, the delivery
 * address), the customer's recorded agreement (voluntary returns only; the database refuses it for a withdrawal) and the wish. Shared by the admin's form
 * and the server, which checks everything again and prices only with `priceExchange()`. zod lives here only: the customer's wish field on a visitor's page
 * uses `exchange-input-browser.ts`.
 */
import { z } from "zod";

import { cleanExchangeWish } from "./exchange-input-browser";
import { EXCHANGE_AGREEMENT_NOTE_MAX, EXCHANGE_LINES_MAX, EXCHANGE_PRICE_MAX_MINOR, EXCHANGE_QUANTITY_MAX } from "./exchange-limits";
import { STAFF_EXCHANGE_CHANNELS } from "./exchange-status";

const minor = z.number().int().min(0).max(EXCHANGE_PRICE_MAX_MINOR);
const text = (max: number) => z.string().trim().min(1).max(max);

export const exchangeLineInput = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(EXCHANGE_QUANTITY_MAX),
  /** The price charged for one unit in the order's currency, VAT included; the server refuses one above the list price as shown (`price_up`). */
  unitPriceMinor: minor,
});

export const exchangeShippingInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free") }),
  z.object({ kind: z.literal("standard") }),
  z.object({ kind: z.literal("set"), amountMinor: minor }),
]);

export const exchangeAddressInput = z.object({
  name: text(200),
  street: text(200),
  postalCode: text(20),
  city: text(100),
  /** The market's country (the server refuses another, `address_country`). */
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  phone: z.string().trim().max(40).optional().nullable(),
});

export const exchangeBuilderInput = z.object({
  lines: z.array(exchangeLineInput).min(1).max(EXCHANGE_LINES_MAX),
  shipping: exchangeShippingInput,
  deliveryAddress: exchangeAddressInput,
});
export type ExchangeBuilderInput = z.infer<typeof exchangeBuilderInput>;

/** Staff record a customer's agreement given another way (voluntary returns only): how, the store day, a note kept only in the history event. */
export const exchangeAgreementInput = z.object({
  channel: z.enum(STAFF_EXCHANGE_CHANNELS),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(EXCHANGE_AGREEMENT_NOTE_MAX).optional().nullable(),
});
export type ExchangeAgreementInput = z.infer<typeof exchangeAgreementInput>;

/** The customer's wish, as the server reads it: the browser's own check, so the two can never disagree. */
export const exchangeWishInput = z.object({ note: z.string() }).transform((value, ctx) => {
  const r = cleanExchangeWish(value.note);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.problem });
    return z.NEVER;
  }
  return { note: r.note };
});
