import { z } from "zod";

import { countWords, fillWords } from "./admin-fill";

/**
 * Price lists (wave 6 unit C1, D321, `docs/wave-6-catalogue.md` C.1): what the admin's forms send, checked on the server. A buyer's price is
 * never worked out here: it is only `commerce.buyer_price()` (SQL), read by the cart, checkout and the product page.
 */

export const PRICE_LIST_NAME_MAX = 80;
/** Fixed prices one save may hold; a list may have more, saved a page at a time. */
export const PRICE_ROWS_MAX = 500;

export const priceListInput = z.object({
  name: z.string().trim().min(1, "Give the list a name.").max(PRICE_LIST_NAME_MAX, `Keep the name under ${PRICE_LIST_NAME_MAX} characters.`),
  /** Whole percent off the market price of the products in scope; null for none (only its fixed prices). */
  percent: z.number().int().min(1, "A percentage is at least 1.").max(99, "A percentage is at most 99.").nullable(),
  active: z.boolean(),
});

export type PriceListInput = z.infer<typeof priceListInput>;

/** Who the list is for: the store's own customer groups and companies, by id. */
export const assignmentsInput = z.object({
  tierIds: z.array(z.uuid()).max(100),
  companyIds: z.array(z.uuid()).max(500),
});

/** What its percentage reaches: products and product categories, by id; both empty is every product. */
export const scopeInput = z.object({
  productIds: z.array(z.uuid()).max(500),
  termIds: z.array(z.uuid()).max(100),
});

/** Fixed prices as typed: an amount per variant and currency ("249,00"); an empty amount takes the price away. */
export const pricesInput = z.array(
  z.object({
    variantId: z.uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.string().trim().max(20),
  }),
).max(PRICE_ROWS_MAX);

/** A percentage as typed in a form: empty is none, anything else must be a whole number. */
export function percentFromForm(value: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(value ?? "").trim().replace(/\s*%$/, "");
  if (text === "") return null;
  return /^[0-9]{1,3}$/.test(text) ? Number(text) : "invalid";
}

type LineWords = { percentOff: string; fixedPrices: { one: string; many: string }; noPricing: string; nobody: string; groupsAndCompanies: string };

/** What a list prices, in a line: its percentage and how many fixed prices it holds. */
export function pricingLine(list: { percent: number | null; prices: number }, words: LineWords): string {
  const parts = [
    ...(list.percent !== null ? [fillWords(words.percentOff, { percent: list.percent })] : []),
    ...(list.prices > 0 ? [countWords(list.prices, words.fixedPrices)] : []),
  ];
  return parts.length > 0 ? parts.join(", ") : words.noPricing;
}

/** Who a list is for, in a line. */
export function forWhomLine(list: { groups: number; companies: number }, words: LineWords): string {
  return list.groups + list.companies === 0 ? words.nobody : fillWords(words.groupsAndCompanies, { groups: list.groups, companies: list.companies });
}
