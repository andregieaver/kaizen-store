/**
 * The order file (D165, `docs/wave-2-data.md` 2.3, 4.2), pure: plain rows from the server's reads turned into the cells of a CSV. No SQL
 * here; the server reads one store's orders (the store id on every statement, `PAID`, `copied_from`, `host_id` and `restricted_at` rules
 * in one place) and passes them in.
 *
 * Every amount is an integer of minor units written by `amountCell()` in the ORDER's own currency; the main-currency block is converted
 * at the store's rates when the file is made (`convertMinor()`), carries the rate used, and is blank with `main_converted = no_rate` for
 * a currency the store has no rate for. It is indicative, never for a tax return (OSS and IOSS use the ECB rate and the documents, D161).
 * The order's amounts are on its FIRST line row only, so a column sums correctly; the lines layout has a row per line, the orders layout
 * a row per order. VAT is as stored: a line's rate, net and VAT, and the shipping VAT is the order's VAT less the lines', never recomputed.
 *
 * Personal data: the Accounting profile (default) has no contact details; Full adds the email and the addresses. An order whose person
 * was erased (`erased`) is exported WITHOUT any personal field in either profile (`[removed]`, the country stays). Nothing here can hold
 * a secret: the input has no field for a client secret, the order page's key, a token or card data.
 */
import { amountCell, type Cell } from "./csv";
import { conversionFactor, convertMinor, type Rates } from "./currency";
import { minorUnitDigits } from "./money";

export const ORDER_PROFILES = ["accounting", "full"] as const;
export type OrderProfile = (typeof ORDER_PROFILES)[number];
export const ORDER_LAYOUTS = ["lines", "orders"] as const;
export type OrderLayout = (typeof ORDER_LAYOUTS)[number];

export const REMOVED = "[removed]";

export type Address = { name: string | null; line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null; phone?: string | null };

export type ExportLine = {
  lineNumber: number;
  sku: string;
  title: string;
  quantity: number;
  /** As sold, VAT included, in the order's currency. */
  unitPriceMinor: number;
  discountMinor: number;
  totalMinor: number;
  taxMinor: number;
  /** The VAT rate as a fraction (0.25), as stored on the line. */
  taxRate: number;
  /** What one unit cost the store when sold, in the store's main currency; null when not known. */
  unitCostMinor: number | null;
  gift: boolean;
  delivery: "physical" | "digital" | "service";
};

export type ExportOrder = {
  number: string;
  /** An ISO moment (UTC). */
  placedAt: string;
  /** The store's day it was placed (`2026-10-05`), by the store's time zone. */
  placedOn: string;
  status: string;
  /** The payment's status (`captured`, ...), empty when none. */
  paymentStatus: string | null;
  paidAt: string | null;
  market: string;
  currency: string;
  locale: string;
  copied: boolean;
  hostOrder: boolean;
  /** Paid in Stripe's test mode (a test account, or a venue payment made while the store was in test mode): a try-out, not a sale. Marked, never left out. */
  testPayment: boolean;
  invoiceNumber: string | null;
  customerType: "private" | "business";
  companyName: string | null;
  buyerVatNumber: string | null;
  /** The person was erased (D162): `restricted_at` or `anonymised_at` is set. */
  erased: boolean;
  email: string | null;
  billing: Address;
  shipping: Address;
  discountCode: string | null;
  subtotalMinor: number;
  shippingMinor: number;
  discountMinor: number;
  memberDiscountMinor: number;
  campaignDiscountMinor: number;
  creditMinor: number;
  referralDiscountMinor: number;
  vatReliefMinor: number;
  vatKind: string;
  taxMinor: number;
  totalMinor: number;
  /** Succeeded refunds only. */
  refundedMinor: number;
  refundCount: number;
  lastRefundAt: string | null;
  balanceMinor: number;
  commissionMinor: number;
  deliveryService: string | null;
  /** The staff's tags on the order (D173), as written; empty when none. Absent in older callers: read as none. */
  tags?: readonly string[];
  /** Archived (D173): a visibility state only. */
  archived?: boolean;
  /** `draft`: staff made it from a draft order (D173); `checkout` otherwise. Copied history is `copied` in the file whatever it was. */
  source?: "checkout" | "draft";
  /** The order is a gift (D173). The words are personal data of a third party: the Full profile only. */
  isGift?: boolean;
  giftTo?: string | null;
  giftFrom?: string | null;
  giftMessage?: string | null;
  /** The payment provider's reference of the captured payment (a Stripe `pi_...`: a reference, not a credential). */
  paymentReference: string | null;
  lines: ExportLine[];
};

export type MainConversion = { currency: string; rates: Rates };

const IDENTITY = ["order_number", "placed_at", "placed_on", "status", "payment_status", "paid_at", "market", "currency", "locale", "copied", "host_order", "test_payment", "invoice_number"] as const;
const BUYER_ACCOUNTING = ["customer_type", "company_name", "buyer_vat_number", "billing_country", "shipping_country"] as const;
const BUYER_FULL = ["email", "billing_name", "billing_line1", "billing_line2", "billing_postal_code", "billing_city", "shipping_name", "shipping_line1", "shipping_line2", "shipping_postal_code", "shipping_city", "shipping_phone", "discount_code"] as const;
const AMOUNTS = [
  "subtotal", "shipping", "shipping_vat", "discount_total", "member_discount", "campaign_discount", "credit_used", "referral_discount", "vat_relief", "vat_kind", "tax_total", "total",
  "refunded", "refund_count", "last_refund_at", "balance_due_at_venue", "commission", "delivery_service",
  "main_currency", "main_rate", "main_converted", "subtotal_main", "tax_total_main", "total_main", "refunded_main",
] as const;
/** What staff and shoppers added to an order in wave 3 (D173): in both profiles, after the amounts (so the line columns and the payment reference still end the lines layout). `gift_order` is the ORDER's gift (the line column `gift` is a free gift line). */
const OPS = ["tags", "archived", "source", "gift_order"] as const;
/** The words of a gift: a third party's name and a message, so the Full profile only (and blanked for an erased person's order). */
const GIFT_FULL = ["gift_to", "gift_from", "gift_message"] as const;
const LINE = ["line_number", "sku", "title", "quantity", "unit_price", "line_discount", "line_total", "line_tax_rate", "line_net", "line_tax", "unit_cost_main", "gift", "line_delivery"] as const;

/** The header row of a layout and profile, in the contract's order (4.2). */
export function orderColumns(layout: OrderLayout, profile: OrderProfile): string[] {
  const buyer = profile === "full" ? [...BUYER_ACCOUNTING, ...BUYER_FULL] : [...BUYER_ACCOUNTING];
  const ops = profile === "full" ? [...OPS, ...GIFT_FULL] : [...OPS];
  if (layout === "orders") return [...IDENTITY, ...buyer, "line_count", ...AMOUNTS, ...ops];
  return [...IDENTITY, ...buyer, ...AMOUNTS, ...ops, ...LINE, "payment_reference"];
}

/** The columns that hold a person's data: in the Full profile only, and blanked for an erased person's order. */
export const PERSONAL_ORDER_COLUMNS: readonly string[] = ["company_name", "buyer_vat_number", ...BUYER_FULL.filter((c) => c !== "discount_code"), ...GIFT_FULL];

/** Every column name an order file can have, for the tests of secrets. */
export const ALL_ORDER_COLUMNS: readonly string[] = [...new Set([...orderColumns("lines", "full"), ...orderColumns("orders", "full")])];

const iso = (at: string | null): string | null => (at ? new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z") : null);
const text = (v: string | null | undefined): Cell => (v === null || v === undefined || v === "" ? null : v);
const bool = (b: boolean) => (b ? "true" : "false");

/** A VAT rate as a percentage text with the decimals it needs ("25", "12.5", "0"), from the fraction, through basis points. */
export function ratePercentText(rate: number): string {
  const bp = Math.round(rate * 10_000);
  const whole = Math.floor(Math.abs(bp) / 100);
  const frac = String(Math.abs(bp) % 100).padStart(2, "0").replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** The rate used to convert `from` into the main currency: main units per one unit, six decimals at most; null without a rate. */
export function mainRateText(from: string, main: string, rates: Rates): string | null {
  if (from === main) return "1";
  const c = conversionFactor(from, main, rates);
  if (!c) return null;
  const rate = c.factor * 10 ** (minorUnitDigits(from) - minorUnitDigits(main));
  return String(Number(rate.toFixed(6)));
}

/** What is wrong with an order's own figures, in plain words: none for a consistent one. A file never "fixes" them. */
export function orderTotalsProblems(order: ExportOrder): string[] {
  const out: string[] = [];
  const lineTax = order.lines.reduce((sum, l) => sum + l.taxMinor, 0);
  if (order.taxMinor - lineTax < 0) out.push(`${order.number}: the lines carry more VAT than the order.`);
  if (order.subtotalMinor - order.discountMinor + order.shippingMinor !== order.totalMinor) out.push(`${order.number}: goods less discounts plus shipping is not the total.`);
  return out;
}

/** The order's VAT that is not on its lines: the shipping's, as stored. */
export const shippingVatOf = (order: ExportOrder): number => order.taxMinor - order.lines.reduce((sum, l) => sum + l.taxMinor, 0);

function personal(order: ExportOrder, value: string | null | undefined): Cell {
  if (value === null || value === undefined || value === "") return null;
  return order.erased ? REMOVED : value;
}

function orderCells(order: ExportOrder, profile: OrderProfile, main: MainConversion): Record<string, Cell> {
  const cur = order.currency;
  const m = (minor: number): Cell => {
    const converted = convertMinor(minor, cur, main.currency, main.rates);
    return converted === null ? null : amountCell(converted, main.currency);
  };
  const rate = mainRateText(cur, main.currency, main.rates);
  const cells: Record<string, Cell> = {
    order_number: order.number,
    placed_at: iso(order.placedAt),
    placed_on: order.placedOn,
    status: order.status,
    payment_status: text(order.paymentStatus),
    paid_at: iso(order.paidAt),
    market: order.market,
    currency: cur,
    locale: order.locale,
    copied: bool(order.copied),
    host_order: bool(order.hostOrder),
    test_payment: bool(order.testPayment),
    invoice_number: text(order.invoiceNumber),
    customer_type: order.customerType,
    company_name: personal(order, order.companyName),
    buyer_vat_number: personal(order, order.buyerVatNumber),
    // The country stays, even for an erased person's order.
    billing_country: text(order.billing.country),
    shipping_country: text(order.shipping.country),
    subtotal: amountCell(order.subtotalMinor, cur),
    shipping: amountCell(order.shippingMinor, cur),
    shipping_vat: amountCell(shippingVatOf(order), cur),
    discount_total: amountCell(order.discountMinor, cur),
    member_discount: amountCell(order.memberDiscountMinor, cur),
    campaign_discount: amountCell(order.campaignDiscountMinor, cur),
    credit_used: amountCell(order.creditMinor, cur),
    referral_discount: amountCell(order.referralDiscountMinor, cur),
    vat_relief: amountCell(order.vatReliefMinor, cur),
    vat_kind: order.vatKind,
    tax_total: amountCell(order.taxMinor, cur),
    total: amountCell(order.totalMinor, cur),
    refunded: amountCell(order.refundedMinor, cur),
    refund_count: order.refundCount,
    last_refund_at: iso(order.lastRefundAt),
    balance_due_at_venue: amountCell(order.balanceMinor, cur),
    commission: order.hostOrder ? amountCell(order.commissionMinor, cur) : null,
    delivery_service: text(order.deliveryService),
    main_currency: main.currency,
    main_rate: rate === null ? null : { num: rate },
    main_converted: cur === main.currency ? "true" : rate === null ? "no_rate" : "true",
    subtotal_main: rate === null ? null : m(order.subtotalMinor),
    tax_total_main: rate === null ? null : m(order.taxMinor),
    total_main: rate === null ? null : m(order.totalMinor),
    refunded_main: rate === null ? null : m(order.refundedMinor),
    line_count: order.lines.length,
    // Staff's tags are free text a person typed, so an erased person's order carries none of them (the tags are deleted when the order is anonymised, D162).
    tags: personal(order, (order.tags ?? []).join(", ")),
    archived: bool(order.archived === true),
    source: order.copied ? "copied" : order.source === "draft" ? "draft" : "checkout",
    gift_order: bool(order.isGift === true),
  };
  if (profile === "full") {
    cells.gift_to = personal(order, order.giftTo);
    cells.gift_from = personal(order, order.giftFrom);
    cells.gift_message = personal(order, order.giftMessage);
    cells.email = personal(order, order.email);
    cells.billing_name = personal(order, order.billing.name);
    cells.billing_line1 = personal(order, order.billing.line1);
    cells.billing_line2 = personal(order, order.billing.line2);
    cells.billing_postal_code = personal(order, order.billing.postalCode);
    cells.billing_city = personal(order, order.billing.city);
    cells.shipping_name = personal(order, order.shipping.name);
    cells.shipping_line1 = personal(order, order.shipping.line1);
    cells.shipping_line2 = personal(order, order.shipping.line2);
    cells.shipping_postal_code = personal(order, order.shipping.postalCode);
    cells.shipping_city = personal(order, order.shipping.city);
    cells.shipping_phone = personal(order, order.shipping.phone);
    cells.discount_code = text(order.discountCode);
  }
  return cells;
}

function lineCells(order: ExportOrder, line: ExportLine, main: MainConversion): Record<string, Cell> {
  const cur = order.currency;
  return {
    line_number: line.lineNumber,
    sku: text(line.sku),
    title: text(line.title),
    quantity: line.quantity,
    unit_price: amountCell(line.unitPriceMinor, cur),
    line_discount: amountCell(line.discountMinor, cur),
    line_total: amountCell(line.totalMinor, cur),
    line_tax_rate: { num: ratePercentText(line.taxRate) },
    line_net: amountCell(line.totalMinor - line.taxMinor, cur),
    line_tax: amountCell(line.taxMinor, cur),
    unit_cost_main: line.unitCostMinor === null ? null : amountCell(line.unitCostMinor, main.currency),
    gift: bool(line.gift),
    line_delivery: line.delivery,
  };
}

export type OrderRowsOptions = { layout: OrderLayout; profile: OrderProfile; main: MainConversion };

/** The rows of some orders WITHOUT the header: a row per line (the order's amounts on its first), or a row per order. */
export function orderRows(orders: readonly ExportOrder[], options: OrderRowsOptions): Cell[][] {
  const header = orderColumns(options.layout, options.profile);
  const out: Cell[][] = [];
  for (const order of orders) {
    const base = orderCells(order, options.profile, options.main);
    if (options.layout === "orders") {
      out.push(header.map((c) => base[c] ?? null));
      continue;
    }
    const amountNames = new Set<string>(AMOUNTS);
    const lines = order.lines.length > 0 ? order.lines : [null];
    lines.forEach((line, i) => {
      const cells: Record<string, Cell> = {};
      for (const [k, v] of Object.entries(base)) if (!amountNames.has(k) || i === 0) cells[k] = v;
      if (line) Object.assign(cells, lineCells(order, line, options.main));
      cells.payment_reference = text(order.paymentReference);
      out.push(header.map((c) => cells[c] ?? null));
    });
  }
  return out;
}

/** A whole file: the header, then the rows. */
export const orderFileRows = (orders: readonly ExportOrder[], options: OrderRowsOptions): Cell[][] => [orderColumns(options.layout, options.profile), ...orderRows(orders, options)];

/** How many rows of the file these orders make, for the limit (a row per line, or per order). */
export const orderRowCount = (orders: readonly { lines: readonly unknown[] }[], layout: OrderLayout): number =>
  layout === "orders" ? orders.length : orders.reduce((n, o) => n + Math.max(1, o.lines.length), 0);

/** The numbers of a pasted selection (comma, semicolon, space or line separated), without duplicates, at most `max`: the rest is `over`. */
export function parseOrderNumbers(pasted: string, max: number): { numbers: string[]; over: number } {
  const seen = new Set<string>();
  const numbers: string[] = [];
  for (const raw of pasted.split(/[\s,;]+/)) {
    const n = raw.trim();
    if (n === "" || seen.has(n)) continue;
    seen.add(n);
    numbers.push(n);
  }
  return { numbers: numbers.slice(0, max), over: Math.max(0, numbers.length - max) };
}
