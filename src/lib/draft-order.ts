/**
 * Pricing a draft order (wave 3, run 2, D173, `docs/wave-3-orders.md` 4.5): the one function that turns a draft's lines, staff discount and shipping choice
 * into what the order will carry. Pure: no database, no network, no `server-only` import. The server passes in what only it can know (the lines'
 * VAT rates read through `commerce.vat_rate()`, the market's flat shipping rate already shown in the draft's currency, and `decideTax()` as a function),
 * so the draft is priced by the same building blocks as a cart (`vatIncluded()`, `basketShipping()`, `decideTax()`), and a test holds a draft of
 * the same goods equal to `cartSummary()` in two currencies.
 *
 * Amounts are integer minor units of the draft's own currency, VAT included, as the checkout shows them. Everything rounds half up to the minor unit;
 * nothing is converted here (the list price was converted by `shown()` when the line was added).
 *
 *  1. `goods = unit price × quantity` per line; `subtotal = Σ goods`.
 *  2. The staff discount takes the goods down: a percent (basis points) per line, half up, the order's discount being the sum of the lines'; or an amount
 *     shared over the lines by the largest-remainder rule (ties to the earlier line), so the lines add up to the amount exactly and none goes below zero.
 *  3. Shipping is the market's flat rate judged on the goods BEFORE the discount (free over its limit as the checkout judges it), or free, or a price staff set;
 *     nothing when no line is shipped.
 *  4. VAT is decided on what is left to pay by the injected `tax()` (`decideTax()` in the server), never by a formula of its own.
 *  5. `discountMinor = Σ staff discount + the VAT not charged` (a reverse-charge order; a draft has no VAT number so this is 0 today), and
 *     `total = subtotal + shipping − discountMinor`, which is what the database's `orders_total_adds_up` checks.
 *
 * A custom price is not a discount: the line's `unitPriceMinor` is what is charged, `listPriceMinor` is information.
 */
import { vatIncluded } from "./checkout";
import { basketShipping } from "./subscriptions";
import {
  DRAFT_DISCOUNT_LABEL_MAX,
  DRAFT_LINES_MAX,
  DRAFT_PRICE_MAX_MINOR,
  DRAFT_QUANTITY_MAX,
  DISCOUNT_BPS_MAX,
  DISCOUNT_BPS_MIN,
} from "./order-limits";
import { vatPerRate, type RateTotal, type ReliefResult } from "./vat-relief";

// ---------------------------------------------------------------------------------------------------------------------
// What goes in
// ---------------------------------------------------------------------------------------------------------------------

export type DraftLineKind = "goods" | "custom";

/** A line as it is priced. `key` tells it apart in the result (the line's id, or its position). */
export type DraftLineInput = {
  key: string;
  kind: DraftLineKind;
  /** The price charged for one unit, VAT included, in the draft's currency (the list price as shown, or the custom price staff typed). */
  unitPriceMinor: number;
  quantity: number;
  /** The VAT rate (a fraction) of the line: a variant's product's through `commerce.vat_rate(country, category)`, a custom item's category's. */
  rate: number;
  /** The line is shipped (goods); a custom item is a service and is not. */
  physical: boolean;
};

export type DraftDiscountInput =
  | { kind: "percent"; /** Basis points (hundredths of a percent): 1 to 10,000. */ bps: number; label: string }
  | { kind: "amount"; /** Minor units of the draft's currency. */ minor: number; label: string }
  | null;

export type DraftShippingRate = { amountMinor: number; freeOverMinor: number | null };

export type DraftShippingInput =
  /** The market's flat rate and its free-over limit, already shown in the draft's currency; null when the market has none. */
  | { kind: "rate"; rate: DraftShippingRate | null }
  | { kind: "free" }
  | { kind: "custom"; amountMinor: number };

/** What the injected `decideTax()` is given: the lines as they stand after the staff discount, and the shipping. */
export type DraftTaxBasket = {
  lines: readonly { key: string; totalMinor: number; rate: number; booking: false; physical: boolean; recurring: false; host: false }[];
  shippingMinor: number;
  fees: readonly [];
  currency: string;
};

/**
 * The part of `TaxOutcome` (`src/server/tax-treatment.ts`) pricing reads. The server's own `TaxOutcome` has these fields, so
 * `(basket) => decideTax(facts, basket)` is the function to pass; the whole outcome (the decision, the treatment the order keeps) is carried through.
 */
export type DraftTaxOutcome = {
  taxMinor: number;
  reliefMinor: number;
  shippingRate: number;
  decision: { kind: string; reverseCharge: boolean };
  result: ReliefResult;
};

export type DraftPricingInput = {
  lines: readonly DraftLineInput[];
  discount: DraftDiscountInput;
  shipping: DraftShippingInput;
  currency: string;
};

// ---------------------------------------------------------------------------------------------------------------------
// What comes out
// ---------------------------------------------------------------------------------------------------------------------

/** One priced line, with every column the order line needs. */
export type PricedDraftLine = {
  key: string;
  quantity: number;
  /** The price charged for one unit (the order line's `unit_price_minor`). */
  unitPriceMinor: number;
  /** `unit price × quantity`. */
  goodsMinor: number;
  /** The line's share of the staff discount (the order line's `staff_discount_minor`). */
  staffDiscountMinor: number;
  /** The VAT not charged on the line (reverse charge; 0 for a draft today). */
  reliefMinor: number;
  /** The order line's `discount_minor`: the staff discount and the relief. */
  discountMinor: number;
  /** The order line's `total_minor`: `goods − discount`. */
  totalMinor: number;
  taxMinor: number;
  rate: number;
};

export type DraftPricing<T extends DraftTaxOutcome = DraftTaxOutcome> = {
  /** True when nothing blocks a send. When the arithmetic cannot start (no lines, a bad quantity or price) the numbers below are all zero. */
  ok: boolean;
  problems: DraftProblem[];
  lines: PricedDraftLine[];
  /** The order's `subtotal_minor`: the goods before the discount. */
  subtotalMinor: number;
  /** The order's `shipping_minor`, VAT included, before any relief. */
  shippingMinor: number;
  /** The order's `discount_minor`: the staff discount and the VAT not charged. */
  discountMinor: number;
  /** The order's `staff_discount_minor`, and the label the buyer sees (null when there is none). */
  staffDiscountMinor: number;
  staffDiscountLabel: string | null;
  /** The VAT not charged (reverse charge): part of `discountMinor`; 0 for a draft today. */
  reliefMinor: number;
  /** The order's `tax_minor`, `total_minor`; what is paid online is all of it (a draft has no venue part). */
  taxMinor: number;
  totalMinor: number;
  dueNowMinor: number;
  /** The VAT per rate, for the summary (the rates with something in them, highest first). */
  vatPerRate: RateTotal[];
  /** The tax decision as the injected function gave it (null when the arithmetic stopped before asking). */
  tax: T | null;
};

// ---------------------------------------------------------------------------------------------------------------------
// Problems, in words
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What is wrong with a draft, by code. The first group is found here (`priceDraft()`, `draftProblems()`); the second group is found by the server, which
 * reads the database (a variant, the stock, the market, the store), and uses these words so the editor says them one way.
 */
export const DRAFT_PROBLEMS = {
  // Found here
  no_lines: "Add at least one line.",
  too_many_lines: "A draft holds at most 100 lines.",
  quantity_invalid: "A quantity is a whole number from 1 to 9,999.",
  price_invalid: "A price is 0 or more, and not above the limit.",
  discount_invalid: "The discount is not valid: a percent from 0.01 to 100, or an amount above 0.",
  discount_label_invalid: "The discount needs a name the buyer sees, up to 60 characters.",
  discount_over_goods: "The discount is more than the goods.",
  shipping_rate_missing: "The market has no shipping rate. Choose free shipping or set a price.",
  shipping_invalid: "The shipping price is not valid.",
  total_zero: "The total is 0, and nothing can be paid.",
  no_email: "Add the customer's email address to send it.",
  invalid_email: "The email address is not valid.",
  no_shipping_address: "Goods are shipped: add a shipping address.",
  shipping_country: "The shipping address is in another country than the market. The VAT of this order is decided for the market, so make the draft in the market of the country it is delivered to.",
  custom_consumer:
    "A custom item cannot be sold to a private customer yet: the right of withdrawal for a service needs a legal decision that is not made. Add the service as a product, or make the draft for a business.",
  // Found by the server
  variant_unavailable: "A product on the draft is no longer for sale in this market.",
  stock_short: "There is not enough stock for a line.",
  backorder: "A line is on backorder: the buyer is told how long it takes.",
  market_gone: "The market of this draft no longer exists.",
  payments_off: "Payments are off for this store, so a draft cannot be sent.",
  store_closed: "This store is not open, so a draft cannot be sent.",
  too_many_open_drafts: "The store has 500 open drafts. Delete or send one first.",
  price_changed: "A price changed when the market was changed: check the lines.",
} as const;
export type DraftProblemCode = keyof typeof DRAFT_PROBLEMS;

/** A problem, with the line it is about when it is about one. `blocking` problems stop a send; a note (a backorder, a changed price) only tells. */
export type DraftProblem = { code: DraftProblemCode; key?: string; blocking: boolean };

const NOTES: readonly DraftProblemCode[] = ["backorder", "price_changed"];
export const isDraftNote = (code: DraftProblemCode): boolean => NOTES.includes(code);
export const problemOf = (code: DraftProblemCode, key?: string): DraftProblem => ({ code, ...(key === undefined ? {} : { key }), blocking: !isDraftNote(code) });
export const draftProblemText = (code: DraftProblemCode): string => DRAFT_PROBLEMS[code];
export const blockingProblems = (problems: readonly DraftProblem[]): DraftProblem[] => problems.filter((p) => p.blocking);

// ---------------------------------------------------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------------------------------------------------

/** `round_half_up(goods × bps / 10,000)` for non-negative `goods`, exact in integers. */
export function percentOff(goodsMinor: number, bps: number): number {
  return Number((BigInt(goodsMinor) * BigInt(bps) + BigInt(5000)) / BigInt(10_000));
}

/**
 * `amount` shared over the lines in proportion to their goods: each gets `floor(amount × goods / Σ goods)`, and the minor units still to give go one each to
 * the lines with the largest remainder, ties to the earlier line. The shares add up to `amount` exactly, no line gets more than its goods, and a line with
 * no goods gets nothing. `amount` must not exceed `Σ goods` (the caller refuses that first); returns zeros otherwise.
 */
export function shareAmount(goods: readonly number[], amount: number): number[] {
  const total = goods.reduce((sum, g) => sum + g, 0);
  if (amount <= 0 || total <= 0 || amount > total) return goods.map(() => 0);
  const bigTotal = BigInt(total);
  const bigAmount = BigInt(amount);
  const parts = goods.map((g) => {
    const product = bigAmount * BigInt(g);
    return { base: Number(product / bigTotal), remainder: product % bigTotal };
  });
  let left = amount - parts.reduce((sum, p) => sum + p.base, 0);
  const order = parts
    .map((p, i) => ({ i, remainder: p.remainder }))
    .filter((p) => p.remainder > BigInt(0))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  const shares = parts.map((p) => p.base);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

const isMinor = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const emptyPricing = <T extends DraftTaxOutcome>(problems: DraftProblem[]): DraftPricing<T> => ({
  ok: false,
  problems,
  lines: [],
  subtotalMinor: 0,
  shippingMinor: 0,
  discountMinor: 0,
  staffDiscountMinor: 0,
  staffDiscountLabel: null,
  reliefMinor: 0,
  taxMinor: 0,
  totalMinor: 0,
  dueNowMinor: 0,
  vatPerRate: [],
  tax: null,
});

/**
 * The shipping the market's flat rate gives this basket: `basketShipping()`, as the cart works it out, on the goods BEFORE the staff discount (so a custom item
 * counts towards the free-over limit as a cart's service line does). Nothing when no line is shipped.
 */
export function rateShipping(lines: readonly DraftLineInput[], goods: readonly number[], rate: DraftShippingRate): number {
  return basketShipping(
    lines.map((line, i) => ({ totalMinor: goods[i], delivery: line.physical ? ("physical" as const) : ("service" as const), recurring: false })),
    rate,
  ).first;
}

/**
 * Prices a draft. `tax` is `decideTax()` over the store's tax facts (never called when the arithmetic cannot start: no lines, a bad amount).
 * The result is always complete: when something is wrong `ok` is false and `problems` says what, and the numbers are those of the lines that could be priced.
 */
export function priceDraft<T extends DraftTaxOutcome>(input: DraftPricingInput, tax: (basket: DraftTaxBasket) => T): DraftPricing<T> {
  const problems: DraftProblem[] = [];
  const add = (code: DraftProblemCode, key?: string) => {
    if (!problems.some((p) => p.code === code && p.key === key)) problems.push(problemOf(code, key));
  };

  if (input.lines.length === 0) add("no_lines");
  if (input.lines.length > DRAFT_LINES_MAX) add("too_many_lines");
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > DRAFT_QUANTITY_MAX) add("quantity_invalid", line.key);
    if (!isMinor(line.unitPriceMinor) || line.unitPriceMinor < 0 || line.unitPriceMinor > DRAFT_PRICE_MAX_MINOR) add("price_invalid", line.key);
  }
  // Nothing can be added up from lines that are not numbers.
  if (problems.some((p) => p.code === "quantity_invalid" || p.code === "price_invalid" || p.code === "too_many_lines" || p.code === "no_lines")) {
    return emptyPricing<T>(problems);
  }

  const goods = input.lines.map((line) => line.unitPriceMinor * line.quantity);
  const subtotalMinor = goods.reduce((sum, g) => sum + g, 0);

  // Staff discount (step 2).
  let off = goods.map(() => 0);
  let label: string | null = null;
  const d = input.discount;
  if (d) {
    const text = d.label.trim();
    if (text.length < 1 || [...text].length > DRAFT_DISCOUNT_LABEL_MAX) add("discount_label_invalid");
    else label = text;
    if (d.kind === "percent") {
      if (!Number.isInteger(d.bps) || d.bps < DISCOUNT_BPS_MIN || d.bps > DISCOUNT_BPS_MAX) add("discount_invalid");
      else off = goods.map((g) => percentOff(g, d.bps));
    } else {
      if (!isMinor(d.minor) || d.minor <= 0) add("discount_invalid");
      else if (d.minor > subtotalMinor) add("discount_over_goods");
      else off = shareAmount(goods, d.minor);
    }
  }
  const staffDiscountMinor = off.reduce((sum, o) => sum + o, 0);

  // Shipping (step 3): only for a basket with something to ship.
  const ships = input.lines.some((line) => line.physical);
  let shippingMinor = 0;
  if (ships) {
    const s = input.shipping;
    if (s.kind === "rate") {
      if (!s.rate) add("shipping_rate_missing");
      else shippingMinor = rateShipping(input.lines, goods, s.rate);
    } else if (s.kind === "custom") {
      if (!isMinor(s.amountMinor) || s.amountMinor < 0 || s.amountMinor > DRAFT_PRICE_MAX_MINOR) add("shipping_invalid");
      else shippingMinor = s.amountMinor;
    }
  }
  if (problems.length > 0) {
    // A bad discount or shipping choice: the lines are still priced at their goods so the editor can show a figure, but the draft is not ok.
    return finish(input, goods, goods.map(() => 0), 0, null, shippingMinor, problems, tax, subtotalMinor);
  }
  return finish(input, goods, off, staffDiscountMinor, label, shippingMinor, problems, tax, subtotalMinor);
}

function finish<T extends DraftTaxOutcome>(
  input: DraftPricingInput,
  goods: number[],
  off: number[],
  staffDiscountMinor: number,
  label: string | null,
  shippingMinor: number,
  problems: DraftProblem[],
  tax: (basket: DraftTaxBasket) => T,
  subtotalMinor: number,
): DraftPricing<T> {
  // VAT (step 4), on what is left to pay.
  const outcome = tax({
    lines: input.lines.map((line, i) => ({
      key: line.key,
      totalMinor: goods[i] - off[i],
      rate: line.rate,
      booking: false as const,
      physical: line.physical,
      recurring: false as const,
      host: false as const,
    })),
    shippingMinor,
    fees: [],
    currency: input.currency,
  });
  const taxOfLine = new Map(outcome.result.lines.map((l) => [l.key, l]));
  const lines: PricedDraftLine[] = input.lines.map((line, i) => {
    const t = taxOfLine.get(line.key);
    const relief = t?.reliefMinor ?? 0;
    return {
      key: line.key,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      goodsMinor: goods[i],
      staffDiscountMinor: off[i],
      reliefMinor: relief,
      discountMinor: off[i] + relief,
      totalMinor: goods[i] - off[i] - relief,
      taxMinor: t?.taxMinor ?? 0,
      rate: line.rate,
    };
  });
  // Step 5: the VAT not charged on shipping and lines is part of the order's discount.
  const discountMinor = staffDiscountMinor + outcome.reliefMinor;
  const totalMinor = subtotalMinor + shippingMinor - discountMinor;
  const out: DraftPricing<T> = {
    ok: problems.length === 0,
    problems,
    lines,
    subtotalMinor,
    shippingMinor,
    discountMinor,
    staffDiscountMinor,
    staffDiscountLabel: staffDiscountMinor > 0 ? label : null,
    reliefMinor: outcome.reliefMinor,
    taxMinor: outcome.taxMinor,
    totalMinor,
    dueNowMinor: totalMinor,
    vatPerRate: vatPerRate(outcome.result, outcome.decision.reverseCharge),
    tax: outcome,
  };
  if (totalMinor <= 0 && !problems.some((p) => p.code === "total_zero")) {
    out.problems = [...problems, problemOf("total_zero")];
    out.ok = false;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks that need no money
// ---------------------------------------------------------------------------------------------------------------------

/** A plain email check: one `@`, something either side, a dot in the domain, no spaces. (Whether it exists is the mail server's to say.) */
export const looksLikeEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.trim().length <= 254;

/** What is missing from a draft that has nothing to do with its prices: no email, an invalid one, goods to ship and no address. */
export function draftProblems(draft: {
  email: string | null;
  shippingAddress: Record<string, unknown> | null;
  ships: boolean;
  /** The market's country (its code): goods are not shipped to another country's address, because the VAT of the order was decided for the market and reports (D161) name the market as the delivery country. */
  marketCode?: string;
  /** The draft holds a custom item (a service staff priced by hand). */
  customItems?: boolean;
  /** The draft is for a business (a company name is given). */
  business?: boolean;
}): DraftProblem[] {
  const out: DraftProblem[] = [];
  const email = draft.email?.trim() ?? "";
  if (email === "") out.push(problemOf("no_email"));
  else if (!looksLikeEmail(email)) out.push(problemOf("invalid_email"));
  const a = draft.shippingAddress ?? {};
  const has = (k: string) => typeof a[k] === "string" && (a[k] as string).trim() !== "";
  if (draft.ships && !(has("line1") && has("postalCode") && has("city"))) out.push(problemOf("no_shipping_address"));
  // A delivery address in another country than the market would be taxed and reported as the market's national sale (nothing on the manual path overwrites the address as Stripe's form does).
  const country = typeof a.country === "string" ? a.country.trim() : "";
  if (draft.ships && draft.marketCode && country !== "" && country.toUpperCase() !== draft.marketCode.trim().toUpperCase()) out.push(problemOf("shipping_country"));
  // A custom item is a service with no statutory withdrawal handling of its own (the withdrawal function would answer it as a booking): not for a private buyer until a person decides.
  if (draft.customItems && !draft.business) out.push(problemOf("custom_consumer"));
  return out;
}

/** The VAT inside a shipping price, for a screen that shows it (the same rounding as everywhere). */
export const shippingVat = (shippingMinor: number, rate: number): number => vatIncluded(shippingMinor, rate);

/** The label a draft's staff discount shows when staff leave it blank. */
export const DEFAULT_DISCOUNT_LABEL = "Discount";

// ---------------------------------------------------------------------------------------------------------------------
// Changing the market of a draft with lines in it
// ---------------------------------------------------------------------------------------------------------------------

/** What changing a draft's market needs to know about a line. */
export type DraftLinePrices = { key: string; kind: DraftLineKind; unitPriceMinor: number; listPriceMinor: number | null };

/** A catalogue line is at a custom price when staff typed one: its price is not the list price it was added at. A custom item has no list price. */
export const hasCustomPrice = (line: Pick<DraftLinePrices, "kind" | "unitPriceMinor" | "listPriceMinor">): boolean =>
  line.kind === "goods" && line.listPriceMinor !== null && line.unitPriceMinor !== line.listPriceMinor;

export type MarketReprice = {
  lines: DraftLinePrices[];
  /** Catalogue lines at the list price that took the new market's: from and to, so staff are told which prices changed. */
  changed: { key: string; from: number; to: number }[];
  /** Lines whose price stays as typed, now in the new market's currency: a custom price, and every custom item. Staff are told to check them. */
  kept: string[];
  /** Catalogue lines with no price in the new market (not sold there): they stay as they are and the draft cannot be sent until they go. */
  unavailable: string[];
};

/**
 * What changing a draft's market does to its lines (docs/wave-3-orders.md 2.4). A catalogue line at the list price is re-priced at the new market's list price as shown
 * (`listPrices`: the server's `shown()` of each variant's price, by line key; null when the variant is not sold there). A catalogue line with a custom price keeps its typed price and
 * learns the new list price; a custom item keeps its price. The new prices are in the new market's currency, so every kept price is flagged: the number is the same, the money may not be.
 * Pure; the amounts are never converted here.
 */
export function repriceForMarket(lines: readonly DraftLinePrices[], listPrices: Readonly<Record<string, number | null>>): MarketReprice {
  const out: MarketReprice = { lines: [], changed: [], kept: [], unavailable: [] };
  for (const line of lines) {
    if (line.kind === "custom") {
      out.lines.push(line);
      out.kept.push(line.key);
      continue;
    }
    const next = listPrices[line.key];
    if (next === null || next === undefined) {
      out.lines.push(line);
      out.unavailable.push(line.key);
      continue;
    }
    if (hasCustomPrice(line)) {
      out.lines.push({ ...line, listPriceMinor: next });
      out.kept.push(line.key);
      continue;
    }
    out.lines.push({ ...line, unitPriceMinor: next, listPriceMinor: next });
    if (next !== line.unitPriceMinor) out.changed.push({ key: line.key, from: line.unitPriceMinor, to: next });
  }
  return out;
}
