/**
 * Exchanges (wave 3, D239, `docs/wave-3-exchanges.md` 4.2 to 4.5): the pure rules. Which returns can be exchanged (`exchangeBlock()`, the same reasons and
 * order as the database's `commerce.exchange_block()` where both know them), how replacements are priced (`priceExchange()`, built on `priceDraft()`, so an
 * exchange of goods at list price with standard shipping is what `cartSummary()` gives a cart of the same goods), what the credit and the replacements come to
 * (`exchangeOutcome()`), and how long a proposal and a pay step may run (`exchangeDeadline()`, capped by a withdrawal's legal refund deadline).
 *
 * Pure: no database, no network, no `server-only`, no zod (the exchange page, a no-extras path, reaches the words). Amounts are integer minor units of the
 * original order's currency, VAT included; nothing is converted here (the list prices were converted by `shown()` in the order's market view).
 */
import { zonedDate, zonedTime } from "./booking-slots";
import {
  priceDraft,
  type DraftLineInput,
  type DraftPricing,
  type DraftShippingRate,
  type DraftShippingInput,
  type DraftTaxBasket,
  type DraftTaxOutcome,
} from "./draft-order";
import {
  EXCHANGE_LINES_MAX,
  EXCHANGE_MIN_HOURS,
  EXCHANGE_PAY_DAYS,
  EXCHANGE_PRICE_MAX_MINOR,
  EXCHANGE_PROPOSAL_DAYS,
  EXCHANGE_QUANTITY_MAX,
  EXCHANGES_PER_RETURN_MAX,
} from "./exchange-limits";

export * from "./exchange-status";

// ---------------------------------------------------------------------------------------------------------------------
// Problems, in words (the staff screens' English; the customer's words are `m.exchange.*`)
// ---------------------------------------------------------------------------------------------------------------------

/** Why an exchange cannot be made, proposed, confirmed or processed, by code. */
export const EXCHANGE_PROBLEMS = {
  // Which returns (4.3); the first group is also the database's (`exchange_block()`).
  copied: "This order was copied from another store: it is history and cannot be exchanged.",
  host: "This is a host's order: it is not exchanged.",
  vat_kind: "This order was sold without the destination's VAT (reverse charge or IOSS): it is not exchanged. Refund instead.",
  restricted: "The customer's data on this order has been erased: it is not exchanged.",
  subscription: "This order holds a subscription: it is not exchanged.",
  weekly_box: "This order is a subscription box delivery: it is not exchanged.",
  booking: "This order holds a booking: it is not exchanged.",
  store_closed: "The store is not open: nothing is exchanged.",
  shop_off: "The online shop is off: nothing is sold, so nothing is exchanged.",
  off: "Exchanges are off in the return settings.",
  ended: "The return has ended.",
  requested: "Approve the return first.",
  refunded: "The return has already been refunded (or a refund of it is under way).",
  not_goods: "A returned line is not goods that are shipped: it is not exchanged.",
  edit_pending: "A change to this order waits for the customer's payment. Wait for it, or cancel the change.",
  // Found by the code only.
  limit: "This return has had 5 exchange proposals. Refund it instead.",
  test_mode: "This order was paid in Stripe's test mode, and the store is live now (or the other way round): it is not exchanged.",
  payments_off: "Payments are off for this store, so an exchange with money to refund or collect cannot be processed.",
  // The proposal (4.2).
  no_lines: "Add at least one replacement.",
  too_many_lines: "An exchange holds at most 20 replacements.",
  quantity: "A quantity is a whole number from 1 to 99.",
  price_invalid: "A price is 0 or more, and not above the limit.",
  price_up: "A replacement's price can be lowered, never raised above its price in the shop.",
  not_offered: "A replacement is not for sale in this order's market.",
  not_goods_replacement: "A replacement is not goods that are shipped.",
  shipping_rate_missing: "The market has no shipping rate. Choose free shipping or set a price.",
  shipping_invalid: "The shipping price is not valid.",
  address_country: "The delivery address is in another country than the order's market.",
  vat_changed: "The VAT of the new order would not be the destination's ordinary VAT: refund instead.",
  total_zero: "The replacements come to 0: refund instead.",
  // Processing (4.4, 4.5).
  stock_short: "There is not enough stock for a replacement. Change the proposal (the customer confirms again) or refund instead.",
  credit_changed: "The inspection lowered the credit, so the customer would pay more than they confirmed. Propose the exchange again.",
  deadline_near: "The withdrawal's refund deadline is less than a day away: refund instead.",
  not_confirmed: "The customer has not confirmed the exchange.",
} as const;
export type ExchangeProblemCode = keyof typeof EXCHANGE_PROBLEMS;
export const exchangeProblemText = (code: ExchangeProblemCode): string => EXCHANGE_PROBLEMS[code];

/** The reasons a return is not exchanged (4.3), in the order they are asked. */
export const EXCHANGE_BLOCKS = [
  "copied",
  "host",
  "vat_kind",
  "restricted",
  "subscription",
  "weekly_box",
  "booking",
  "store_closed",
  "shop_off",
  "off",
  "ended",
  "requested",
  "refunded",
  "not_goods",
  "edit_pending",
  "limit",
  "test_mode",
  "payments_off",
] as const satisfies readonly ExchangeProblemCode[];
export type ExchangeBlock = (typeof EXCHANGE_BLOCKS)[number];
/** The reasons the database asks too (`commerce.exchange_block()`); the rest are the code's. */
export const DATABASE_BLOCKS: readonly ExchangeBlock[] = EXCHANGE_BLOCKS.slice(0, EXCHANGE_BLOCKS.indexOf("edit_pending") + 1);

export type ReturnStatusName = "requested" | "approved" | "in_transit" | "received" | "inspected" | "closed" | "declined" | "cancelled";

/** What `exchangeBlock()` is asked of an order and its return. */
export type ExchangeFacts = {
  /** `return_settings.exchanges` (true without a row). */
  settingOn: boolean;
  copied: boolean;
  host: boolean;
  vatKind: "standard" | "reverse_charge" | "ioss";
  /** The order started or renewed a subscription, or holds a line of a selling plan. */
  subscription: boolean;
  /** The order is a subscription box delivery (`standing_deliveries`). */
  weeklyBox: boolean;
  booking: boolean;
  /** Every accepted line of the return is physical goods. */
  allGoods: boolean;
  /** Restricted or anonymised (D162). */
  restricted: boolean;
  storeOpen: boolean;
  shopOn: boolean;
  returnStatus: ReturnStatusName;
  /** The return's refund is recorded, or claimed by someone else. */
  refunded: boolean;
  /** A D174 change of the order waits for payment. */
  editPending: boolean;
  /** Proposals the return has had (`seq`). */
  proposals: number;
  /** The order was paid in another Stripe mode than the store is in now. */
  testModeMismatch: boolean;
  /** The exchange would refund or charge through Stripe (Δ ≠ 0 and not settled outside); only then do payments need to be on. */
  paymentsNeeded: boolean;
  paymentsOn: boolean;
};

/** The first reason the return is not exchanged, or null when it can be. */
export function exchangeBlock(f: ExchangeFacts): ExchangeBlock | null {
  if (f.copied) return "copied";
  if (f.host) return "host";
  if (f.vatKind !== "standard") return "vat_kind";
  if (f.restricted) return "restricted";
  if (f.subscription) return "subscription";
  if (f.weeklyBox) return "weekly_box";
  if (f.booking) return "booking";
  if (!f.storeOpen) return "store_closed";
  if (!f.shopOn) return "shop_off";
  if (!f.settingOn) return "off";
  if (f.returnStatus === "closed" || f.returnStatus === "declined" || f.returnStatus === "cancelled") return "ended";
  if (f.returnStatus === "requested") return "requested";
  if (f.refunded) return "refunded";
  if (!f.allGoods) return "not_goods";
  if (f.editPending) return "edit_pending";
  if (f.proposals >= EXCHANGES_PER_RETURN_MAX) return "limit";
  if (f.testModeMismatch) return "test_mode";
  if (f.paymentsNeeded && !f.paymentsOn) return "payments_off";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The outcome (4.2 point 6)
// ---------------------------------------------------------------------------------------------------------------------

export type ExchangeOutcomeKind = "refund_due" | "even" | "to_pay";

export type ExchangeOutcome = {
  kind: ExchangeOutcomeKind;
  /** `Δ = T − C`. */
  differenceMinor: number;
  /** The part of the credit applied to the exchange order: `min(C, T)`. */
  transferMinor: number;
  /** Refunded to the original payment: `max(0, C − T)`. */
  refundMinor: number;
  /** Paid by the customer: `max(0, T − C)`. */
  toPayMinor: number;
};

const assertMinor = (name: string, value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number of minor units, 0 or more: ${value}`);
};

/** The credit `C` against the replacement total `T`: integers in, integers out, nothing rounded. */
export function exchangeOutcome(creditMinor: number, totalMinor: number): ExchangeOutcome {
  assertMinor("creditMinor", creditMinor);
  assertMinor("totalMinor", totalMinor);
  const differenceMinor = totalMinor - creditMinor;
  return {
    kind: differenceMinor < 0 ? "refund_due" : differenceMinor === 0 ? "even" : "to_pay",
    differenceMinor,
    transferMinor: Math.min(creditMinor, totalMinor),
    refundMinor: Math.max(0, -differenceMinor),
    toPayMinor: Math.max(0, differenceMinor),
  };
}

/** Whether processing may go on with the credit worked out again: only a difference no higher than the customer confirmed (a lower one only helps them). */
export const creditStillHolds = (confirmedDifferenceMinor: number, differenceNowMinor: number): boolean => differenceNowMinor <= confirmedDifferenceMinor;

// ---------------------------------------------------------------------------------------------------------------------
// Pricing the replacements (4.2)
// ---------------------------------------------------------------------------------------------------------------------

/** A replacement as it is priced: a goods variant, its list price as shown in the order's market view, and the price charged (staff may lower it). */
export type ExchangeLineInput = {
  key: string;
  quantity: number;
  /** `shown(market, list)` in the original order's market view; null when the variant is not offered there. */
  listPriceMinor: number | null;
  /** The price charged for one unit (≤ the list price). */
  unitPriceMinor: number;
  /** `commerce.vat_rate(country, category)` of the day. */
  rate: number;
  /** Physical goods (a service, a download or a booking is not a replacement). */
  goods: boolean;
};

export type ExchangeShippingInput =
  | { kind: "free" }
  /** The market's flat rate and its free-over limit, already shown in the order's currency; null when the market has none. */
  | { kind: "standard"; rate: DraftShippingRate | null }
  /** A price staff set, VAT included. */
  | { kind: "set"; amountMinor: number };

export type ExchangePricingInput = {
  lines: readonly ExchangeLineInput[];
  shipping: ExchangeShippingInput;
  currency: string;
  /** The credit `C` (`refundFor()`'s amount for the return), never adjusted here. */
  creditMinor: number;
};

export type ExchangeProblem = { code: ExchangeProblemCode; key?: string };

export type ExchangePricing<T extends DraftTaxOutcome = DraftTaxOutcome> = {
  ok: boolean;
  problems: ExchangeProblem[];
  /** The draft pricing the exchange order is made from (no discount: an exchange takes no order-level discount). */
  pricing: DraftPricing<T>;
  /** `T`: what the exchange order costs. */
  totalMinor: number;
  outcome: ExchangeOutcome;
};

const DRAFT_TO_EXCHANGE: Partial<Record<string, ExchangeProblemCode>> = {
  no_lines: "no_lines",
  quantity_invalid: "quantity",
  price_invalid: "price_invalid",
  shipping_rate_missing: "shipping_rate_missing",
  shipping_invalid: "shipping_invalid",
  total_zero: "total_zero",
};

const isMinor = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

/**
 * Prices an exchange's replacements with `priceDraft()` (goods lines, no discount, the shipping chosen) and nets them against the credit. `tax` is
 * `decideTax()` over the original order's market and buyer; the decision must be the destination's ordinary VAT (`standard`), or the exchange is refused
 * (`vat_changed`). The result is always complete: when something is wrong `ok` is false and `problems` says what.
 */
export function priceExchange<T extends DraftTaxOutcome>(input: ExchangePricingInput, tax: (basket: DraftTaxBasket) => T): ExchangePricing<T> {
  assertMinor("creditMinor", input.creditMinor);
  const problems: ExchangeProblem[] = [];
  const add = (code: ExchangeProblemCode, key?: string) => {
    if (!problems.some((p) => p.code === code && p.key === key)) problems.push(key === undefined ? { code } : { code, key });
  };
  if (input.lines.length > EXCHANGE_LINES_MAX) add("too_many_lines");
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > EXCHANGE_QUANTITY_MAX) add("quantity", line.key);
    if (!line.goods) add("not_goods_replacement", line.key);
    if (line.listPriceMinor === null) add("not_offered", line.key);
    else if (isMinor(line.unitPriceMinor) && line.unitPriceMinor > line.listPriceMinor) add("price_up", line.key);
    if (!isMinor(line.unitPriceMinor) || line.unitPriceMinor < 0 || line.unitPriceMinor > EXCHANGE_PRICE_MAX_MINOR) add("price_invalid", line.key);
  }
  const s = input.shipping;
  const shipping: DraftShippingInput =
    s.kind === "free" ? { kind: "free" } : s.kind === "standard" ? { kind: "rate", rate: s.rate } : { kind: "custom", amountMinor: s.amountMinor };
  if (s.kind === "set" && (!isMinor(s.amountMinor) || s.amountMinor < 0 || s.amountMinor > EXCHANGE_PRICE_MAX_MINOR)) add("shipping_invalid");

  const lines: DraftLineInput[] = input.lines.map((line) => ({
    key: line.key,
    kind: "goods",
    unitPriceMinor: line.unitPriceMinor,
    quantity: line.quantity,
    rate: line.rate,
    physical: true,
  }));
  const pricing = priceDraft({ lines, discount: null, shipping, currency: input.currency }, tax);
  for (const p of pricing.problems) {
    const code = DRAFT_TO_EXCHANGE[p.code];
    if (code) add(code, p.key);
  }
  if (pricing.tax && pricing.tax.decision.kind !== "standard") add("vat_changed");
  const totalMinor = pricing.totalMinor;
  const outcome = exchangeOutcome(input.creditMinor, Math.max(0, totalMinor));
  return { ok: problems.length === 0, problems, pricing, totalMinor, outcome };
}

// ---------------------------------------------------------------------------------------------------------------------
// Deadlines (4.5)
// ---------------------------------------------------------------------------------------------------------------------

export type DeadlineInput = {
  /** `withdrawal` is capped by its legal refund deadline; `return` (a voluntary return) is not. */
  kind: "withdrawal" | "return";
  /** `proposal` (waiting for the customer's confirmation) or `pay` (the pay step of a difference). */
  step: "proposal" | "pay";
  now: Date;
  /** `returns.refund_deadline` (a withdrawal's; null for a voluntary return). */
  refundDeadline: Date | null;
  /** The store's time zone. */
  timeZone: string;
};

export type ExchangeDeadline = { ok: true; expiresAt: Date; capped: boolean } | { ok: false; code: "deadline_near"; capAt: Date };

/**
 * When a proposal's or a pay step's link ends: `now + EXCHANGE_PROPOSAL_DAYS` (or `EXCHANGE_PAY_DAYS`), and for a withdrawal return never later than the end of
 * the store day before its refund deadline (local midnight starting the deadline's day). When that cap is less than `EXCHANGE_MIN_HOURS` away the exchange is
 * refused (`deadline_near`: refund instead).
 */
export function exchangeDeadline(input: DeadlineInput): ExchangeDeadline {
  const days = input.step === "proposal" ? EXCHANGE_PROPOSAL_DAYS : EXCHANGE_PAY_DAYS;
  const natural = new Date(input.now.getTime() + days * 86_400_000);
  if (input.kind !== "withdrawal" || !input.refundDeadline) return { ok: true, expiresAt: natural, capped: false };
  const deadlineDay = zonedDate(input.refundDeadline.getTime(), input.timeZone);
  const capAt = new Date(zonedTime(deadlineDay, "00:00", input.timeZone));
  if (capAt.getTime() - input.now.getTime() < EXCHANGE_MIN_HOURS * 3_600_000) return { ok: false, code: "deadline_near", capAt };
  return capAt < natural ? { ok: true, expiresAt: capAt, capped: true } : { ok: true, expiresAt: natural, capped: false };
}

/** The store day an end falls on (for the words "If you do not confirm by {date}"): the last day the link still works. */
export function lastDayOf(expiresAt: Date, timeZone: string): string {
  // A link that ends at local midnight works until the end of the day before.
  const ms = expiresAt.getTime() - 1;
  return zonedDate(ms, timeZone);
}

