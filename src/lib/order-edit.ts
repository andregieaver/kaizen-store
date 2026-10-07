/**
 * Changing a paid order after purchase (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 4.3 to 4.5): which orders can be changed (`editBlock()`), how a
 * line's quantity is lowered without re-pricing what is kept (`splitLine()`) and what a whole change does to the order's figures (`priceOrderEdit()`). Pure:
 * no database, no `server-only` import, no zod. The server reads the order, the market's prices as shown (`shown()`), the VAT rates
 * (`commerce.vat_rate()`) and passes `decideTax()` in, and applies exactly what this returns (`previewOrderEdit()` and `applyOrderEdit()` call the same
 * function, so the screen never works a total out).
 *
 * Amounts are integer minor units of the order's own currency, VAT included, as the checkout keeps them; nothing is converted here.
 *
 * 1. **Units kept are never re-priced.** A line going from `Q` to `q` units keeps its unit price and rate; its kept total and VAT are D153's cumulative
 *    floor (`paidForUnits()`: the first `q` units carry `floor(T × q / Q)`, the odd minor units go with the units taken off); its kept discount is
 *    `unit × q − kept total`, shared over the discount's parts (group, campaign, credits, welcome, staff, relief and the code's rest) by the largest-remainder
 *    rule in proportion to each, never above it. What is taken off is the line as sold less what is kept, column by column, so the two add up exactly.
 * 2. **Added units are new lines**, priced at the market's list price as shown or a price staff typed, with no discount; their VAT is decided by the injected
 *    `tax()` over the order as it will be (the checkout's `decideTax()`); the decision must stay the standard one.
 * 3. **Shipping** is kept, or set by staff (VAT included, at the order's frozen shipping rate); it cannot be set on an order whose shipping was discounted.
 * 4. The order after: `subtotal` and `discount` (and each part) move by what was added and taken off; `tax` is the lines' VAT and the shipping's;
 *    `total = subtotal + shipping − discount` (the database's `orders_total_adds_up`); the difference is `total after − total before`.
 */
import { vatIncluded } from "./checkout";
import { shareAmount, type DraftTaxOutcome } from "./draft-order";
import { EDIT_ADDED_LINES_MAX, EDIT_PRICE_MAX_MINOR, EDIT_QUANTITY_MAX, EDITS_PER_ORDER_MAX } from "./fulfilment-limits";
import type { OrderEditLineKind, OrderEditReason } from "./order-edit-status";
import { paidForUnits } from "./return-refund";

// ---------------------------------------------------------------------------------------------------------------------
// Which orders can be changed (4.4)
// ---------------------------------------------------------------------------------------------------------------------

/** Why an order cannot be changed, in the words the order page shows in place of *Edit items* (English: the admin). */
export const EDIT_BLOCKS = {
  copied: "A copied order is history and cannot be changed.",
  not_paid: "Only a paid order can be changed: this one is waiting for payment, cancelled or closed.",
  sent: "Something of this order is already sent, so its items cannot be changed. Refund the units that are not sent instead: put them back in stock and tick “These units were not sent”.",
  host: "A host's order is sold and paid on the host's own account, so it cannot be changed here.",
  subscription: "An order with a subscription cannot be changed: its price and schedule are agreed with the subscription.",
  weekly_box: "A subscription box delivery cannot be changed here: change the customer's list instead.",
  booking: "An order with a booked time, stay or rental cannot be changed: move or cancel the booking instead.",
  venue_balance: "Part of this order is paid at the venue, so it cannot be changed.",
  vat_kind: "This order carries reverse charge or IOSS, which a change could alter, so it cannot be changed.",
  return: "This order has a withdrawal or a return, so its items cannot be changed.",
  unsent_closed: "Units of this order were taken off what is still to send (refunded or put back as not sent), so its items cannot be changed.",
  restricted: "The customer's data was erased, so there is nobody to ask or tell: this order cannot be changed.",
  edit_pending: "A change to this order is waiting for the customer's payment. Cancel it or wait for it to be paid or expire.",
  edit_limit: "This order has been changed 20 times, the most an order can be.",
  store_closed: "The store is not open, so its orders cannot be changed.",
  payments_off: "Payments are off for this store, so money for a change cannot be taken or refunded through Stripe.",
  test_mode: "This order was paid in Stripe's test mode and the store is live now (or the other way round), so money for it cannot move.",
} as const;
export type EditBlockReason = keyof typeof EDIT_BLOCKS;
export const editBlockText = (reason: EditBlockReason): string => EDIT_BLOCKS[reason];

export type EditFacts = {
  status: "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";
  copied: boolean;
  host: boolean;
  /** Any parcel was recorded for the order (legacy or not), partly sent included. */
  shipped: boolean;
  subscription: boolean;
  weeklyBox: boolean;
  booking: boolean;
  balanceMinor: number;
  vatKind: "standard" | "reverse_charge" | "ioss";
  /** A withdrawal request was confirmed, or a return exists that is not cancelled. */
  returnOrWithdrawal: boolean;
  /** Units were taken off what is still to send (`commerce.unsent_closures`, D174); absent is false. The database refuses a change then too. */
  unsentClosed?: boolean;
  restricted: boolean;
  editPending: boolean;
  /** The order's changes so far, whatever became of them. */
  editCount: number;
  storeOpen: boolean;
};

/** The first reason the order cannot be changed, or null. The database holds the part it can see (`order_edits_rules()`). */
export function editBlock(f: EditFacts): EditBlockReason | null {
  if (f.copied) return "copied";
  if (f.status === "fulfilled" || f.shipped) return f.status === "paid" || f.status === "fulfilled" ? "sent" : "not_paid";
  if (f.status !== "paid") return "not_paid";
  if (f.host) return "host";
  if (f.subscription) return "subscription";
  if (f.weeklyBox) return "weekly_box";
  if (f.booking) return "booking";
  if (f.balanceMinor > 0) return "venue_balance";
  if (f.vatKind !== "standard") return "vat_kind";
  if (f.returnOrWithdrawal) return "return";
  if (f.unsentClosed) return "unsent_closed";
  if (f.restricted) return "restricted";
  if (f.editPending) return "edit_pending";
  if (f.editCount >= EDITS_PER_ORDER_MAX) return "edit_limit";
  if (!f.storeOpen) return "store_closed";
  return null;
}

/**
 * The money of a change that must move through Stripe (a refund of a card payment, a pay link): refused when the store's payments are off, or when the order
 * was paid in another Stripe mode than the store is in now. A change with nothing to pay or refund, or one paid or refunded outside Kaizen, needs neither.
 */
export function moneyBlock(input: { differenceMinor: number; throughStripe: boolean; paymentsOn: boolean; orderTestMode: boolean; storeTestMode: boolean }): EditBlockReason | null {
  if (input.differenceMinor === 0 || !input.throughStripe) return null;
  if (!input.paymentsOn) return "payments_off";
  if (input.orderTestMode !== input.storeTestMode) return "test_mode";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// A line as it was sold, and lowering it (4.3 point 1)
// ---------------------------------------------------------------------------------------------------------------------

/** The discount of a line, by part, in minor units. `relief` is the VAT not charged (reverse charge; 0 on every order a change is made on). */
export type DiscountParts = { member: number; campaign: number; bonus: number; referral: number; staff: number; relief: number };
export const PART_KEYS = ["member", "campaign", "bonus", "referral", "staff", "relief"] as const satisfies readonly (keyof DiscountParts)[];
export const noParts = (): DiscountParts => ({ member: 0, campaign: 0, bonus: 0, referral: 0, staff: 0, relief: 0 });

/** An order line as sold (`order_lines`). */
export type SoldLine = {
  lineId: string;
  variantId: string | null;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  taxMinor: number;
  taxRate: number;
  discountMinor: number;
  parts: DiscountParts;
  backorderQuantity: number;
  backorderDays: number | null;
  /** Goods with a variant: the only lines a change can lower or take off. Downloads, services and fees stay as they are. */
  goods: boolean;
  /** Shipped (goods). */
  physical: boolean;
  /** A free product a campaign gave (D114): it can be taken off (its value is 0) and is never taken off by itself. */
  gift: boolean;
};

/** What a line carries, or what is taken off it. */
export type LineMoney = {
  quantity: number;
  /** `unit price × quantity`. */
  goodsMinor: number;
  totalMinor: number;
  taxMinor: number;
  discountMinor: number;
  parts: DiscountParts;
  backorderQuantity: number;
};

const sumParts = (p: DiscountParts) => PART_KEYS.reduce((s, k) => s + p[k], 0);

/**
 * A line lowered from `Q` to `keep` units (0 ≤ keep ≤ Q): what it keeps and what is taken off. The kept total and VAT follow D153's cumulative floor, the
 * kept discount is what makes the line's check hold (`total = unit × quantity − discount`), and each discount part is shared over it by the largest-remainder
 * rule (the code's share being the rest of the discount), never above the part; taken off = as sold − kept, column by column. Units on backorder are taken off
 * first (the customer waits for fewer units).
 */
export function splitLine(line: SoldLine, keep: number): { kept: LineMoney; removed: LineMoney } {
  const Q = line.quantity;
  if (!Number.isSafeInteger(Q) || Q < 1) throw new RangeError(`A line has 1 or more units: ${Q}`);
  if (!Number.isSafeInteger(keep) || keep < 0 || keep > Q) throw new RangeError(`A line keeps 0 to ${Q} units: ${keep}`);
  const whole: LineMoney = {
    quantity: Q,
    goodsMinor: line.unitPriceMinor * Q,
    totalMinor: line.totalMinor,
    taxMinor: line.taxMinor,
    discountMinor: line.discountMinor,
    parts: { ...line.parts },
    backorderQuantity: line.backorderQuantity,
  };
  const zero: LineMoney = { quantity: 0, goodsMinor: 0, totalMinor: 0, taxMinor: 0, discountMinor: 0, parts: noParts(), backorderQuantity: 0 };
  if (keep === Q) return { kept: whole, removed: zero };
  if (keep === 0) return { kept: zero, removed: whole };

  const keptTotal = paidForUnits(line.totalMinor, Q, keep);
  const keptTax = paidForUnits(line.taxMinor, Q, keep);
  const keptGoods = line.unitPriceMinor * keep;
  const keptDiscount = keptGoods - keptTotal;
  const named = sumParts(line.parts);
  const code = Math.max(0, line.discountMinor - named);
  const weights = [...PART_KEYS.map((k) => line.parts[k]), code];
  const shares = keptDiscount > 0 ? shareAmount(weights, keptDiscount) : weights.map(() => 0);
  const keptParts = noParts();
  PART_KEYS.forEach((k, i) => (keptParts[k] = shares[i]));
  const keptBackorder = Math.max(0, line.backorderQuantity - (Q - keep));
  const kept: LineMoney = {
    quantity: keep,
    goodsMinor: keptGoods,
    totalMinor: keptTotal,
    taxMinor: keptTax,
    discountMinor: keptDiscount,
    parts: keptParts,
    backorderQuantity: keptBackorder,
  };
  const removedParts = noParts();
  for (const k of PART_KEYS) removedParts[k] = line.parts[k] - keptParts[k];
  return {
    kept,
    removed: {
      quantity: Q - keep,
      goodsMinor: whole.goodsMinor - keptGoods,
      totalMinor: line.totalMinor - keptTotal,
      taxMinor: line.taxMinor - keptTax,
      discountMinor: line.discountMinor - keptDiscount,
      parts: removedParts,
      backorderQuantity: line.backorderQuantity - keptBackorder,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole change (4.3)
// ---------------------------------------------------------------------------------------------------------------------

/** The order as it stands (its money columns and lines). */
export type EditOrderFacts = {
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  memberDiscountMinor: number;
  campaignDiscountMinor: number;
  creditMinor: number;
  referralDiscountMinor: number;
  staffDiscountMinor: number;
  vatReliefMinor: number;
  /** The rate the shipping was charged at, frozen when the order was placed (null on older orders: the tax decision's rate is used). */
  shippingTaxRate: number | null;
  lines: readonly SoldLine[];
};

/** A product added by the change. */
export type EditAddInput = {
  key: string;
  variantId: string;
  sku: string;
  title: string;
  /** The price charged for one unit, VAT included: the market's list price as shown in the order's view, or a price staff typed. */
  unitPriceMinor: number;
  /** The list price as shown, for information (null when not known). */
  listPriceMinor: number | null;
  quantity: number;
  /** `commerce.vat_rate(country, products.vat_category)` of the day of the change. */
  rate: number;
};

export type EditShippingInput = { kind: "keep" } | { kind: "set"; amountMinor: number };

export type OrderEditInput = {
  order: EditOrderFacts;
  /** New quantities of lines of the order (absent: unchanged; 0: taken off). A kept line only goes down. */
  quantities: Readonly<Record<string, number>>;
  added: readonly EditAddInput[];
  shipping: EditShippingInput;
  reason?: OrderEditReason;
};

/** What the injected tax decision is given: the order's lines as they will be (kept ones at their kept totals) and the shipping. */
export type EditTaxBasket = {
  lines: readonly { key: string; totalMinor: number; rate: number; booking: false; physical: boolean; recurring: false; host: false }[];
  shippingMinor: number;
  fees: readonly [];
  currency: string;
};

/** The problems a change can have, by code, in the editor's words. The second group is found by the server, which uses these words too. */
export const ORDER_EDIT_PROBLEMS = {
  // Found here
  no_change: "Nothing is changed yet.",
  unknown_line: "An item is not on this order.",
  not_editable: "Only goods can be changed: downloads, services and fees stay as they are.",
  only_down: "A quantity on the order can only go down. To sell more of an item, add it as a new product.",
  quantity_invalid: "A quantity is a whole number: 0 to take an item off, up to 9,999 for an added product.",
  price_invalid: "A price is 0 or more, and not above the limit.",
  too_many_lines: "A change adds at most 50 products.",
  nothing_left: "Every item would be taken off. Cancel the order instead.",
  total_zero: "The order's total would be 0.",
  shipping_invalid: "The shipping price is not valid.",
  shipping_discounted: "The order's shipping was discounted (a code), so a new shipping price cannot be set: keep the shipping.",
  vat_changed: "The change would alter how VAT is charged on this order (for example IOSS), so it cannot be made.",
  swap_needs_request: "Adding products without the customer paying for them is a swap: choose The customer asked as the reason.",
  // Found by the server
  variant_unavailable: "A product added is not for sale in the order's market.",
  stock: "There is not enough stock of an added product.",
  over_refundable: "The difference is more than is left to refund on this order (earlier refunds took the rest).",
  changed: "The order changed while you edited it: start again.",
  refund_failed: "The refund was refused, so nothing was changed.",
  amount_too_small: "The amount is too small to pay by card: record it as paid outside Kaizen or change the price of what is added.",
} as const;
export type OrderEditProblemCode = keyof typeof ORDER_EDIT_PROBLEMS;
export type OrderEditProblem = { code: OrderEditProblemCode | EditBlockReason; key?: string };
export const orderEditProblemText = (code: OrderEditProblemCode | EditBlockReason): string =>
  code in ORDER_EDIT_PROBLEMS ? ORDER_EDIT_PROBLEMS[code as OrderEditProblemCode] : EDIT_BLOCKS[code as EditBlockReason];

/** The order's money columns. */
export type OrderTotals = {
  subtotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  memberDiscountMinor: number;
  campaignDiscountMinor: number;
  creditMinor: number;
  referralDiscountMinor: number;
  staffDiscountMinor: number;
  vatReliefMinor: number;
  taxMinor: number;
  totalMinor: number;
};

/** A row of `order_edit_lines`, numbered from 1: the lines taken off or lowered in the order's line order, then the products added. */
export type EditLineRow = {
  n: number;
  kind: OrderEditLineKind;
  /** The order line taken off or lowered; for `add`, null until the change is applied (then the new line's id). */
  orderLineId: string | null;
  /** For `add`: the key it was given in the input. */
  key: string | null;
  variantId: string | null;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  listPriceMinor: number | null;
  totalMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxRate: number;
  parts: DiscountParts;
  /** The line as sold, for `remove` and `reduce`. */
  before: SoldLine | null;
};

/** A line the order keeps at fewer units: its new columns. */
export type KeptLine = { lineId: string; before: SoldLine; after: LineMoney; removed: LineMoney };

/** A product added, priced: the new order line's money. */
export type PricedAdd = EditAddInput & { goodsMinor: number; totalMinor: number; taxMinor: number };

export type PricedEdit<T extends DraftTaxOutcome = DraftTaxOutcome> = {
  ok: boolean;
  problems: OrderEditProblem[];
  /** Lines lowered (kept at fewer units). */
  reduced: KeptLine[];
  /** Lines taken off entirely (deleted from the order; their whole row is the edit line's `before`). */
  removed: SoldLine[];
  added: PricedAdd[];
  lines: EditLineRow[];
  before: OrderTotals;
  after: OrderTotals;
  /** `after − before` of the subtotal, shipping, discount and VAT, and the difference of the totals. */
  subtotalDelta: number;
  shippingDelta: number;
  discountDelta: number;
  taxDelta: number;
  differenceMinor: number;
  /** What happens to the money: the customer is asked to pay the difference, it is refunded, or nothing moves. */
  money: "charge" | "refund" | "none";
  /** The customer must be told (they are asked to pay, or units are taken off); staff may not switch the email off then. */
  mustNotify: boolean;
  tax: T | null;
};

const isMinor = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

function totalsOf(order: EditOrderFacts): OrderTotals {
  return {
    subtotalMinor: order.subtotalMinor,
    shippingMinor: order.shippingMinor,
    discountMinor: order.discountMinor,
    memberDiscountMinor: order.memberDiscountMinor,
    campaignDiscountMinor: order.campaignDiscountMinor,
    creditMinor: order.creditMinor,
    referralDiscountMinor: order.referralDiscountMinor,
    staffDiscountMinor: order.staffDiscountMinor,
    vatReliefMinor: order.vatReliefMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
  };
}

/** The part of the order's discount that is on its shipping (a free-shipping code): what the order's discount holds beyond its lines'. */
export const shippingDiscountOf = (order: Pick<EditOrderFacts, "discountMinor" | "lines">): number =>
  Math.max(0, order.discountMinor - order.lines.reduce((s, l) => s + l.discountMinor, 0));

/** The VAT the order's shipping carries now: the order's VAT less its lines'. */
export const shippingVatOf = (order: Pick<EditOrderFacts, "taxMinor" | "lines">): number => Math.max(0, order.taxMinor - order.lines.reduce((s, l) => s + l.taxMinor, 0));

/**
 * Prices a change of an order. `tax` is `decideTax()` over the order's tax facts, given the order's lines as they will be; it is not called when the change
 * cannot be priced (an unknown line, a bad quantity or price). The result is always complete: when something is wrong `ok` is false and `problems` says
 * what; the server adds the problems only it can find (stock, the market, the money) and applies nothing unless `ok`.
 */
export function priceOrderEdit<T extends DraftTaxOutcome>(input: OrderEditInput, tax: (basket: EditTaxBasket) => T): PricedEdit<T> {
  const { order } = input;
  const problems: OrderEditProblem[] = [];
  const add = (code: OrderEditProblem["code"], key?: string) => {
    if (!problems.some((p) => p.code === code && p.key === key)) problems.push(key === undefined ? { code } : { code, key });
  };
  const byId = new Map(order.lines.map((l) => [l.lineId, l]));

  // The new quantities of the order's lines.
  const keepOf = new Map<string, number>();
  for (const [lineId, q] of Object.entries(input.quantities)) {
    const line = byId.get(lineId);
    if (!line) {
      add("unknown_line", lineId);
      continue;
    }
    if (!Number.isSafeInteger(q) || q < 0) {
      add("quantity_invalid", lineId);
      continue;
    }
    if (q === line.quantity) continue;
    if (!line.goods) {
      add("not_editable", lineId);
      continue;
    }
    if (q > line.quantity) {
      add("only_down", lineId);
      continue;
    }
    keepOf.set(lineId, q);
  }
  // The products added.
  if (input.added.length > EDIT_ADDED_LINES_MAX) add("too_many_lines");
  for (const a of input.added) {
    if (!Number.isSafeInteger(a.quantity) || a.quantity < 1 || a.quantity > EDIT_QUANTITY_MAX) add("quantity_invalid", a.key);
    if (!isMinor(a.unitPriceMinor) || a.unitPriceMinor < 0 || a.unitPriceMinor > EDIT_PRICE_MAX_MINOR) add("price_invalid", a.key);
  }
  // Shipping.
  let shippingAfter = order.shippingMinor;
  if (input.shipping.kind === "set") {
    const s = input.shipping.amountMinor;
    if (!isMinor(s) || s < 0 || s > EDIT_PRICE_MAX_MINOR) add("shipping_invalid");
    else if (s !== order.shippingMinor && shippingDiscountOf(order) > 0) add("shipping_discounted");
    else shippingAfter = s;
  }

  const before = totalsOf(order);
  const empty = (): PricedEdit<T> => ({
    ok: false,
    problems,
    reduced: [],
    removed: [],
    added: [],
    lines: [],
    before,
    after: before,
    subtotalDelta: 0,
    shippingDelta: 0,
    discountDelta: 0,
    taxDelta: 0,
    differenceMinor: 0,
    money: "none",
    mustNotify: false,
    tax: null,
  });
  if (problems.some((p) => ["unknown_line", "quantity_invalid", "price_invalid", "too_many_lines", "not_editable", "only_down", "shipping_invalid", "shipping_discounted"].includes(p.code))) return empty();
  if (keepOf.size === 0 && input.added.length === 0 && shippingAfter === order.shippingMinor) {
    add("no_change");
    return empty();
  }

  // Lowered and removed lines, in the order's line order.
  const reduced: KeptLine[] = [];
  const removed: SoldLine[] = [];
  const lines: EditLineRow[] = [];
  const takenOff = { goods: 0, discount: 0, tax: 0, parts: noParts() };
  for (const line of order.lines) {
    const keep = keepOf.get(line.lineId);
    if (keep === undefined) continue;
    const split = splitLine(line, keep);
    if (keep === 0) removed.push(line);
    else reduced.push({ lineId: line.lineId, before: line, after: split.kept, removed: split.removed });
    takenOff.goods += split.removed.goodsMinor;
    takenOff.discount += split.removed.discountMinor;
    takenOff.tax += split.removed.taxMinor;
    for (const k of PART_KEYS) takenOff.parts[k] += split.removed.parts[k];
    lines.push({
      n: lines.length + 1,
      kind: keep === 0 ? "remove" : "reduce",
      orderLineId: line.lineId,
      key: null,
      variantId: line.variantId,
      sku: line.sku,
      title: line.title,
      quantity: split.removed.quantity,
      unitPriceMinor: line.unitPriceMinor,
      listPriceMinor: null,
      totalMinor: split.removed.totalMinor,
      discountMinor: split.removed.discountMinor,
      taxMinor: split.removed.taxMinor,
      taxRate: line.taxRate,
      parts: split.removed.parts,
      before: line,
    });
  }

  // The tax decision over the order as it will be: the lines it keeps at their kept totals, the products added at their prices, the shipping.
  const keptLines = order.lines
    .map((line) => {
      const keep = keepOf.get(line.lineId);
      if (keep === 0) return null;
      const total = keep === undefined ? line.totalMinor : (reduced.find((r) => r.lineId === line.lineId) as KeptLine).after.totalMinor;
      return { key: line.lineId, totalMinor: total, rate: line.taxRate, booking: false as const, physical: line.physical, recurring: false as const, host: false as const };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);
  const outcome = tax({
    lines: [
      ...keptLines,
      ...input.added.map((a) => ({ key: `add:${a.key}`, totalMinor: a.unitPriceMinor * a.quantity, rate: a.rate, booking: false as const, physical: true, recurring: false as const, host: false as const })),
    ],
    shippingMinor: shippingAfter,
    fees: [],
    currency: order.currency,
  });
  if (outcome.decision.kind !== "standard" || outcome.decision.reverseCharge || outcome.reliefMinor !== 0) add("vat_changed");
  const taxOfLine = new Map(outcome.result.lines.map((l) => [l.key, l]));
  const added: PricedAdd[] = input.added.map((a) => {
    const goods = a.unitPriceMinor * a.quantity;
    return { ...a, goodsMinor: goods, totalMinor: goods, taxMinor: taxOfLine.get(`add:${a.key}`)?.taxMinor ?? vatIncluded(goods, a.rate) };
  });
  for (const a of added) {
    lines.push({
      n: lines.length + 1,
      kind: "add",
      orderLineId: null,
      key: a.key,
      variantId: a.variantId,
      sku: a.sku,
      title: a.title,
      quantity: a.quantity,
      unitPriceMinor: a.unitPriceMinor,
      listPriceMinor: a.listPriceMinor,
      totalMinor: a.totalMinor,
      discountMinor: 0,
      taxMinor: a.taxMinor,
      taxRate: a.rate,
      parts: noParts(),
      before: null,
    });
  }

  // The shipping's VAT: as it is when kept; at the order's own shipping rate when set.
  const shippingRate = order.shippingTaxRate ?? outcome.shippingRate;
  const shipVat = shippingAfter === order.shippingMinor ? shippingVatOf(order) : vatIncluded(shippingAfter, shippingRate);
  const addedGoods = added.reduce((s, a) => s + a.goodsMinor, 0);
  const keptTax = order.lines.reduce((s, l) => s + l.taxMinor, 0) - takenOff.tax;
  const after: OrderTotals = {
    subtotalMinor: order.subtotalMinor + addedGoods - takenOff.goods,
    shippingMinor: shippingAfter,
    discountMinor: order.discountMinor - takenOff.discount,
    memberDiscountMinor: order.memberDiscountMinor - takenOff.parts.member,
    campaignDiscountMinor: order.campaignDiscountMinor - takenOff.parts.campaign,
    creditMinor: order.creditMinor - takenOff.parts.bonus,
    referralDiscountMinor: order.referralDiscountMinor - takenOff.parts.referral,
    staffDiscountMinor: order.staffDiscountMinor - takenOff.parts.staff,
    vatReliefMinor: order.vatReliefMinor - takenOff.parts.relief,
    taxMinor: keptTax + added.reduce((s, a) => s + a.taxMinor, 0) + shipVat,
    totalMinor: 0,
  };
  after.totalMinor = after.subtotalMinor + after.shippingMinor - after.discountMinor;

  const keptUnits = order.lines.reduce((s, l) => s + (keepOf.get(l.lineId) ?? l.quantity), 0) + added.reduce((s, a) => s + a.quantity, 0);
  if (keptUnits === 0) add("nothing_left");
  else if (after.totalMinor <= 0) add("total_zero");
  const differenceMinor = after.totalMinor - before.totalMinor;
  if (added.length > 0 && differenceMinor <= 0 && input.reason !== undefined && input.reason !== "customer_request") add("swap_needs_request");

  return {
    ok: problems.length === 0,
    problems,
    reduced,
    removed,
    added,
    lines,
    before,
    after,
    subtotalDelta: after.subtotalMinor - before.subtotalMinor,
    shippingDelta: after.shippingMinor - before.shippingMinor,
    discountDelta: after.discountMinor - before.discountMinor,
    taxDelta: after.taxMinor - before.taxMinor,
    differenceMinor,
    money: differenceMinor > 0 ? "charge" : differenceMinor < 0 ? "refund" : "none",
    mustNotify: differenceMinor > 0 || lines.some((l) => l.kind !== "add"),
    tax: outcome,
  };
}

/** The order's money columns and every line's id and quantity as previewed (`order_edits.base`), compared under the order's lock before applying. */
export function editBase(order: EditOrderFacts): { totals: OrderTotals; lines: { lineId: string; quantity: number; totalMinor: number }[] } {
  return { totals: totalsOf(order), lines: order.lines.map((l) => ({ lineId: l.lineId, quantity: l.quantity, totalMinor: l.totalMinor })) };
}

/** Whether the order still stands as it did when the change was previewed (same money, same lines with the same quantities and totals). */
export function sameBase(a: ReturnType<typeof editBase>, b: ReturnType<typeof editBase>): boolean {
  if (JSON.stringify(a.totals) !== JSON.stringify(b.totals)) return false;
  const key = (l: { lineId: string; quantity: number; totalMinor: number }) => `${l.lineId}:${l.quantity}:${l.totalMinor}`;
  const left = a.lines.map(key).sort();
  const right = b.lines.map(key).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

// ---------------------------------------------------------------------------------------------------------------------
// The summary's sentences (English: the admin)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What happens to the money, in the summary beside the editor. `amount` is the difference already written by `formatMoney()` (never worked out here); `outside`
 * is a payment taken outside Kaizen (D173), which the store pays back itself.
 */
export function moneySentence(money: PricedEdit["money"], amount: string, outside = false): string {
  if (money === "charge") return `The customer will be asked to pay ${amount}. The order stays as it is until they pay.`;
  if (money === "refund") return outside ? `${amount} is recorded as paid back to the customer: the store pays it back itself.` : `${amount} is refunded to the customer's card.`;
  return "Nothing to pay or refund.";
}

/** The documents a change will issue (4.6), for the summary. */
export function documentsSentence(input: { invoiced: boolean; creditMinor: number; invoiceMinor: number; invoiceNumber: string | null }): string {
  if (!input.invoiced) return "This order has no invoice, so the change issues no documents.";
  const ref = input.invoiceNumber ? `, referring to invoice ${input.invoiceNumber}` : "";
  if (input.creditMinor > 0 && input.invoiceMinor > 0) return `A credit note for what is taken off and an additional invoice for what is added${ref}.`;
  if (input.creditMinor > 0) return `A credit note for what is taken off${ref}.`;
  if (input.invoiceMinor > 0) return `An additional invoice for what is added${ref}.`;
  return "No document: nothing of value is added or taken off.";
}
