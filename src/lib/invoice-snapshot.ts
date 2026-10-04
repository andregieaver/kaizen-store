/**
 * What an invoice for a shop order says, worked out once and frozen (D159, `docs/wave-1b-invoices.md` 3.4 and 4).
 *
 * `buildInvoiceSnapshot()` is the pure oracle: the SQL function `commerce.make_order_invoice()` builds the same JSON in the
 * payment transaction, and `src/db/invoice-parity.test.ts` holds the two together on the same rows. The document (the hosted
 * page, the PDF) is drawn only from the snapshot, never from live data.
 *
 * Nothing is recomputed from rates: the VAT on a line is the `order_lines.tax_minor` that was charged, so an invoice equals
 * its order to the minor unit. What is worked out here is only what the order does not keep: the net before a discount (the
 * VAT in a list price), the unit price without VAT (a display value), the VAT per rate (the buckets) and the VAT in the
 * seller's currency (Directive Art. 230).
 *
 * All arithmetic is integer. `vatIncludedExact()` is the checkout's `vatIncluded()` in exact integers (the checkout's float
 * version can differ from it by one minor unit at an exact half; nothing here needs the two to agree because nothing here
 * changes what was charged).
 *
 * Every rule that comes from a law says where, and is marked needs review by an accountant or lawyer in the spec (section 8).
 */
import { minorUnitDigits } from "./money";

export const SNAPSHOT_VERSION = 1 as const;

export type DocLanguage = "nb" | "sv" | "da" | "en";
export type VatKindName = "standard" | "reverse_charge" | "ioss";
export type BucketBasis = "standard" | "reverse_charge" | "exempt" | "ioss";
export type LineKind = "goods" | "download" | "service" | "booking" | "fee" | "gift";

// ---------------------------------------------------------------------------------------------------------------------
// Integer helpers
// ---------------------------------------------------------------------------------------------------------------------

const RATE_SCALE = BigInt(10_000);

/** A rate as a whole number of hundredths of a percent (`0.2500` is 2500). */
export const rateScaled = (rate: number): bigint => BigInt(Math.round(rate * 10_000));

/**
 * The VAT in a VAT-inclusive amount, rounded half up in exact integers: `round(amount x rate / (1 + rate))`. The SQL
 * function `commerce.vat_incl()` is the same arithmetic.
 */
export function vatIncludedExact(amountMinor: number, rate: number): number {
  if (!(rate > 0) || amountMinor <= 0) return 0;
  const r = rateScaled(rate);
  return Number((BigInt(amountMinor) * r * BigInt(2) + (RATE_SCALE + r)) / (BigInt(2) * (RATE_SCALE + r)));
}

export const withoutVatExact = (amountMinor: number, rate: number): number => amountMinor - vatIncludedExact(amountMinor, rate);

/** `round_half_up(a / b)` for a >= 0, b > 0. */
export function divRound(a: number, b: number): number {
  return Number((BigInt(a) * BigInt(2) + BigInt(b)) / (BigInt(2) * BigInt(b)));
}

/**
 * Shares of `total` over `weights` by the largest-remainder method: `floor(total x w / sum)` each, the remaining minor units
 * (fewer than the number of weights) one each to the largest fractional parts, ties to the higher rate and then the lower
 * index. The shares add up to `total` exactly and no share exceeds `ceil(total x w / sum)`, so with `total <= sum` of caps
 * equal to the weights none is above its weight. Mirrored by `commerce.distribute_minor()`.
 */
export function distribute(total: number, weights: readonly number[], rates: readonly number[] = []): number[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError(`total must be a whole number of minor units, 0 or more: ${total}`);
  const sum = weights.reduce((a, b) => a + BigInt(b), BigInt(0));
  if (total === 0) return weights.map(() => 0);
  if (sum === BigInt(0)) throw new RangeError("Nothing to share the amount over (all weights are 0)");
  const t = BigInt(total);
  const base = weights.map((w) => (t * BigInt(w)) / sum);
  const frac = weights.map((w) => (t * BigInt(w)) % sum);
  let left = Number(t - base.reduce((a, b) => a + b, BigInt(0)));
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (frac[a] === frac[b] ? 0 : frac[a] > frac[b] ? -1 : 1) || (rates[b] ?? 0) - (rates[a] ?? 0) || a - b);
  const out = base.map(Number);
  for (const i of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/** The document's language from the order's locale: `nb-NO`, `nn` and `no` are Norwegian; the four hand-written languages, else English. */
export function languageOfLocale(locale: string | null | undefined): DocLanguage {
  const lang = (locale ?? "").slice(0, 2).toLowerCase();
  if (lang === "nb" || lang === "nn" || lang === "no") return "nb";
  if (lang === "sv") return "sv";
  if (lang === "da") return "da";
  return "en";
}

// ---------------------------------------------------------------------------------------------------------------------
// The snapshot's shape (3.4)
// ---------------------------------------------------------------------------------------------------------------------

export type SnapshotAddress = { line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null };

export type SnapshotSeller = {
  legalName: string | null;
  organisationNumber: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  address: string | null;
  country: string | null;
  email: string | null;
  footerNote: string | null;
};

export type SnapshotBuyer = {
  type: "consumer" | "business";
  name: string | null;
  company: string | null;
  organisationNumber: string | null;
  /** The buyer's own VAT number: only on a reverse-charge invoice (Art. 226 point 4). */
  vatNumber: string | null;
  address: SnapshotAddress;
  email: string;
  complete: boolean;
};

export type SnapshotOrder = {
  number: string;
  placedOn: string;
  paidOn: string;
  deliveryPlace: { city: string | null; country: string | null } | null;
};

export type SnapshotLine = {
  lineId: string;
  sku: string;
  title: string;
  kind: LineKind;
  quantity: number;
  listNetMinor: number;
  discountNetMinor: number;
  netMinor: number;
  /** The rate on the document: 0 on a reverse-charge line (`wouldHaveRate` keeps the rate the VAT would have had). */
  vatRate: number;
  basis: BucketBasis;
  vatMinor: number;
  grossMinor: number;
  /** The unit price without VAT, rounded for display; the line's net before discount is `listNetMinor` and is exact. */
  unitNetMinor: number;
  /** A booked time or stay: the store-day of its start, and the local start and end (`YYYY-MM-DDTHH:MM`) with the nights, days or hours. */
  serviceDate: string | null;
  service: { startsAt: string; endsAt: string; count: number | null } | null;
  wouldHaveRate: number | null;
};

export type SnapshotShipping = {
  label: string | null;
  netBeforeMinor: number;
  discountNetMinor: number;
  netMinor: number;
  vatRate: number;
  basis: BucketBasis;
  vatMinor: number;
  grossMinor: number;
  wouldHaveRate: number | null;
};

export type SnapshotDiscount = { kind: "campaign" | "member" | "welcome" | "code" | "credit"; label: string | null; grossMinor: number };

export type SnapshotBucket = { rate: number; basis: BucketBasis; netMinor: number; vatMinor: number; grossMinor: number };

export type SnapshotTotals = { netMinor: number; vatMinor: number; grossMinor: number };

export type SnapshotVatHome = { currency: string; vatMinor: number; fxRate: number; asOf: string; source: "ecb_auto" | "owner" };
/** The VAT in the store's main currency, for unit 1c: `fxRate` is null when the order is in it. */
export type SnapshotVatMain = { currency: string; vatMinor: number; fxRate: number | null };

export type TreatmentStatement = "reverse_charge" | "ioss" | "not_registered" | "exempt";

export type SnapshotTreatment = {
  kind: VatKindName;
  reason: string | null;
  sellerVatNumber: string | null;
  buyerVatNumber: string | null;
  iossNumber: string | null;
  statements: TreatmentStatement[];
};

export type SnapshotPayment = { kind: "paid_online" | "pay_at_venue"; amountMinor: number; provider: string };

export type SnapshotNote = "buyer_incomplete" | "unit_price_rounded" | "trial_deferred";

export type OrderInvoiceSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  documentType: "invoice";
  number: string;
  issuedOn: string;
  supplyDate: string;
  locale: string;
  language: DocLanguage;
  currency: string;
  seller: SnapshotSeller;
  buyer: SnapshotBuyer;
  order: SnapshotOrder;
  lines: SnapshotLine[];
  shipping: SnapshotShipping | null;
  discounts: SnapshotDiscount[];
  buckets: SnapshotBucket[];
  totals: SnapshotTotals;
  vatHome: SnapshotVatHome | null;
  vatMain: SnapshotVatMain | null;
  treatment: SnapshotTreatment;
  payments: SnapshotPayment[];
  /** Free-trial lines of a subscription, billed at the first renewal (their own order and invoice): left out of the totals. */
  deferred: { lineId: string; title: string; grossMinor: number | null }[];
  notes: SnapshotNote[];
};

// ---------------------------------------------------------------------------------------------------------------------
// What the builder reads (the rows, as they are)
// ---------------------------------------------------------------------------------------------------------------------

export type AddressJson = {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
} | null;

export type InvoiceOrderFacts = {
  id: string;
  number: string;
  marketCode: string;
  currency: string;
  locale: string;
  email: string;
  /** Store days (`YYYY-MM-DD`). */
  placedOn: string;
  paidOn: string;
  shippingMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  memberDiscountMinor: number;
  memberLabel: string | null;
  campaignDiscountMinor: number;
  campaignLabel: string | null;
  creditMinor: number;
  referralDiscountMinor: number;
  discountCode: string | null;
  vatKind: VatKindName;
  vatReliefMinor: number;
  shippingTaxRate: number | null;
  /** The market's standard rate at the time, for an order from before shipping kept its own rate. */
  marketStandardRate: number | null;
  companyName: string | null;
  organisationNumber: string | null;
  balanceMinor: number;
  billingAddress: AddressJson;
  shippingAddress: AddressJson;
  /** The delivery service's name (`orders.delivery.label`). */
  deliveryLabel: string | null;
  /** The provider of the payment taken online (`stripe`). */
  onlineProvider: string;
};

export type InvoiceLineFacts = {
  id: string;
  sku: string;
  title: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  taxMinor: number;
  taxRate: number;
  delivery: "physical" | "digital" | "service";
  gift: boolean;
  /** A line of a selling plan (subscription or sign-up fee). */
  planned: boolean;
  bookedCount: number | null;
  /** The product's VAT category code; `exempt` is a bucket of its own. */
  vatCategory: string | null;
  booking: { startsAt: string; endsAt: string } | null;
};

export type InvoiceSellerFacts = {
  legalName: string | null;
  organisationNumber: string | null;
  postalAddress: string | null;
  country: string | null;
  email: string | null;
  footerNote: string | null;
};

export type InvoiceProfileFacts = { vatRegistered: boolean; vatNumber: string | null } | null;

/** What the order's frozen VAT treatment (D157) keeps that an invoice reads; null for an order without one (a renewal). */
export type InvoiceTreatmentFacts = {
  reason: string | null;
  sellerVatNumber: string | null;
  buyerVatNumber: string | null;
  iossNumber: string | null;
} | null;

export type InvoiceFxFacts = {
  /** The currency of the seller's country; null when the seller's country is not known. */
  homeCurrency: string | null;
  /** `mainCurrency(store)`. */
  mainCurrency: string;
  /** Units of each currency per 1 EUR (a decimal string or number; null: none); the euro is 1. */
  rates: Readonly<Record<string, string | number | null>>;
  ratesAuto: boolean;
  /** The day the rates are from (`YYYY-MM-DD`). */
  ratesAsOf: string;
};

export type InvoiceFacts = {
  order: InvoiceOrderFacts;
  lines: readonly InvoiceLineFacts[];
  seller: InvoiceSellerFacts;
  profile: InvoiceProfileFacts;
  treatment: InvoiceTreatmentFacts;
  fx: InvoiceFxFacts;
};

export type InvoiceContext = { number: string; issuedOn: string; supplyDate: string };

// ---------------------------------------------------------------------------------------------------------------------
// The currency of the VAT (Directive Art. 230)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Whether the invoice must carry the VAT in the seller's country's own currency. Directive Art. 230 (read 2026-10-04): amounts
 * may be in any currency provided the VAT is expressed in the member state's national currency; Norway's
 * bokføringsforskriften § 5-1-1 (VAT in Norwegian kroner) and Skatteverket (VAT in SEK) say the same; Denmark's
 * momsbekendtgørelse § 97 asks for DKK or the rate, and accepts euro VAT on an invoice in euro. Every other country: the
 * Directive's rule, its national act not read. Needs review by an accountant.
 */
export function homeVatRequirement(sellerCountry: string | null, orderCurrency: string, homeCurrency: string | null): boolean {
  if (!sellerCountry || !homeCurrency) return false;
  if (orderCurrency === homeCurrency) return false;
  if (sellerCountry === "DK" && orderCurrency === "EUR") return false;
  return true;
}

const EIGHT = BigInt(100_000_000);

/** A rate as a whole number of 1e-8 (the database keeps eight decimals). */
function scaled8(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(8) : value.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) throw new RangeError(`Not a rate: ${text}`);
  return BigInt(m[1]) * EIGHT + BigInt(((m[2] ?? "") + "00000000").slice(0, 8));
}

/**
 * What turns an amount of the order's currency into another currency, with eight decimals, from the store's euro-based rates
 * (D109, units per 1 EUR; the euro is 1) and each currency's minor-unit digits; null when either has no rate. Mirrored by
 * `commerce.fx_factor()`.
 */
export function fxFactor(from: string, to: string, rates: Readonly<Record<string, string | number | null>>): number | null {
  if (from === to) return 1;
  const rate = (c: string) => (c === "EUR" ? "1" : rates[c] ?? null);
  const a = rate(from);
  const b = rate(to);
  if (a === null || b === null) return null;
  const h = scaled8(b);
  const o = scaled8(a);
  if (h <= BigInt(0) || o <= BigInt(0)) return null;
  const k = minorUnitDigits(to) - minorUnitDigits(from);
  const num = h * BigInt(10) ** BigInt(Math.max(0, k)) * EIGHT;
  const den = o * BigInt(10) ** BigInt(Math.max(0, -k));
  const fx8 = (BigInt(2) * num + den) / (BigInt(2) * den);
  return Number(fx8) / 1e8;
}

/** `round_half_up(amount x fx)` where `fx` has at most eight decimals. */
export function convertWith(amountMinor: number, fx: number): number {
  const f = BigInt(Math.round(fx * 1e8));
  return Number((BigInt(amountMinor) * f * BigInt(2) + EIGHT) / (BigInt(2) * EIGHT));
}

/** The VAT of buckets converted bucket by bucket, so the document adds up. */
export function vatConverted(buckets: readonly Pick<SnapshotBucket, "vatMinor">[], fx: number): number {
  return buckets.reduce((sum, b) => sum + convertWith(b.vatMinor, fx), 0);
}

export type HomeVatState = "not_required" | "ok" | "no_rate";

/** Whether the VAT in the seller's currency is needed and can be worked out. An invoice with no VAT needs no such line. */
export function homeVatState(facts: Pick<InvoiceFacts, "fx" | "seller"> & { currency: string; vatMinor: number }): HomeVatState {
  if (facts.vatMinor <= 0) return "not_required";
  if (!homeVatRequirement(facts.seller.country, facts.currency, facts.fx.homeCurrency)) return "not_required";
  return fxFactor(facts.currency, facts.fx.homeCurrency as string, facts.fx.rates) === null ? "no_rate" : "ok";
}

// ---------------------------------------------------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------------------------------------------------

const BASIS_ORDER: Record<BucketBasis, number> = { exempt: 0, ioss: 1, reverse_charge: 2, standard: 3 };

/** The per-rate sums: one bucket per rate and basis, highest rate first; a bucket with nothing in it is left out. */
export function bucketsOf(rows: readonly { rate: number; basis: BucketBasis; netMinor: number; vatMinor: number; grossMinor: number }[]): SnapshotBucket[] {
  const map = new Map<string, SnapshotBucket>();
  for (const row of rows) {
    const key = `${row.rate}|${row.basis}`;
    const found = map.get(key) ?? { rate: row.rate, basis: row.basis, netMinor: 0, vatMinor: 0, grossMinor: 0 };
    found.netMinor += row.netMinor;
    found.vatMinor += row.vatMinor;
    found.grossMinor += row.grossMinor;
    map.set(key, found);
  }
  return [...map.values()]
    .filter((b) => b.netMinor !== 0 || b.vatMinor !== 0 || b.grossMinor !== 0)
    .sort((a, b) => b.rate - a.rate || BASIS_ORDER[a.basis] - BASIS_ORDER[b.basis]);
}

export const totalsOf = (buckets: readonly SnapshotBucket[]): SnapshotTotals => ({
  netMinor: buckets.reduce((s, b) => s + b.netMinor, 0),
  vatMinor: buckets.reduce((s, b) => s + b.vatMinor, 0),
  grossMinor: buckets.reduce((s, b) => s + b.grossMinor, 0),
});

// ---------------------------------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------------------------------

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

function cleanAddress(a: AddressJson) {
  const v = a ?? {};
  return { name: text(v.name), line1: text(v.line1), line2: text(v.line2), postalCode: text(v.postalCode), city: text(v.city), country: text(v.country) };
}

/**
 * The buyer's block. The billing address if it has a street line, else the shipping address, else only the name, the email and the
 * country of the market, marked incomplete (Stripe collects a full billing address only in part, and a shipping address only
 * for goods that are sent). A full invoice to a consumer without an address is a legal question for each country (Art. 238 and
 * 226b were not read): the gap is flagged, never invented. Needs review.
 */
export function buyerOf(order: InvoiceOrderFacts, vatNumber: string | null): SnapshotBuyer {
  const billing = cleanAddress(order.billingAddress);
  const shipping = cleanAddress(order.shippingAddress);
  const picked = billing.line1 ? billing : shipping.line1 ? shipping : null;
  const name = picked?.name ?? billing.name ?? shipping.name;
  return {
    type: text(order.companyName) ? "business" : "consumer",
    name,
    company: text(order.companyName),
    organisationNumber: text(order.organisationNumber),
    vatNumber,
    address: picked
      ? { line1: picked.line1, line2: picked.line2, postalCode: picked.postalCode, city: picked.city, country: picked.country ?? order.marketCode }
      : { line1: null, line2: null, postalCode: null, city: null, country: billing.country ?? shipping.country ?? order.marketCode },
    email: order.email,
    complete: picked !== null,
  };
}

/** A line is deferred when it is a selling-plan line with nothing to pay now: what a free trial leaves for the first renewal (D29). */
export const isDeferredLine = (line: Pick<InvoiceLineFacts, "planned" | "unitPriceMinor" | "totalMinor" | "gift">): boolean =>
  line.planned && line.unitPriceMinor === 0 && line.totalMinor === 0 && !line.gift;

function lineKind(line: InvoiceLineFacts): LineKind {
  if (line.gift) return "gift";
  if (line.sku === "SIGNUP-FEE") return "fee";
  if (line.booking) return "booking";
  if (line.delivery === "digital") return "download";
  if (line.delivery === "service") return "service";
  return "goods";
}

/** The seller's VAT number as it was when the order was placed (its frozen treatment), else the live profile's (a renewal has none, and an order placed before the store registered). */
export function sellerVatNumberOf(treatment: InvoiceTreatmentFacts, profile: InvoiceProfileFacts): string | null {
  const frozen = treatment?.sellerVatNumber;
  if (typeof frozen === "string" && frozen.trim() !== "") return frozen;
  return profile?.vatRegistered ? profile.vatNumber : null;
}

export function buildInvoiceSnapshot(facts: InvoiceFacts, ctx: InvoiceContext): OrderInvoiceSnapshot {
  const { order, seller, fx } = facts;
  const rc = order.vatKind === "reverse_charge";
  const notes: SnapshotNote[] = [];

  // Lines.
  const lines: SnapshotLine[] = [];
  const deferred: OrderInvoiceSnapshot["deferred"] = [];
  let rounded = false;
  for (const l of facts.lines) {
    if (isDeferredLine(l)) {
      deferred.push({ lineId: l.id, title: l.title, grossMinor: null });
      continue;
    }
    const gross = l.totalMinor;
    const vat = rc ? 0 : l.taxMinor;
    const net = gross - vat;
    // The VAT in the list price: never below the net actually charged, so a discount is never negative.
    const listNet = Math.max(withoutVatExact(l.unitPriceMinor * l.quantity, l.taxRate), net);
    const unitNet = divRound(listNet, l.quantity);
    if (unitNet * l.quantity !== listNet) rounded = true;
    lines.push({
      lineId: l.id,
      sku: l.sku,
      title: l.title,
      kind: lineKind(l),
      quantity: l.quantity,
      listNetMinor: listNet,
      discountNetMinor: listNet - net,
      netMinor: net,
      vatRate: rc ? 0 : l.taxRate,
      basis: rc ? "reverse_charge" : l.vatCategory === "exempt" ? "exempt" : "standard",
      vatMinor: vat,
      grossMinor: gross,
      unitNetMinor: unitNet,
      serviceDate: l.booking ? l.booking.startsAt.slice(0, 10) : null,
      service: l.booking ? { startsAt: l.booking.startsAt, endsAt: l.booking.endsAt, count: l.bookedCount } : null,
      wouldHaveRate: rc ? l.taxRate : null,
    });
  }

  // Shipping: what the shopper paid for delivery after any discount and relief is the rest of the order's total.
  const linesTotal = facts.lines.reduce((s, l) => s + l.totalMinor, 0);
  const linesTax = facts.lines.reduce((s, l) => s + l.taxMinor, 0);
  const shipGross = order.totalMinor - linesTotal;
  const shipVat = rc ? 0 : order.taxMinor - linesTax;
  const shipNet = shipGross - shipVat;
  const shipRate = order.shippingTaxRate ?? order.marketStandardRate ?? 0;
  const shipListNet = Math.max(withoutVatExact(order.shippingMinor, shipRate), shipNet);
  const shipping: SnapshotShipping | null =
    order.shippingMinor === 0 && shipGross === 0
      ? null
      : {
          label: text(order.deliveryLabel),
          netBeforeMinor: shipListNet,
          discountNetMinor: shipListNet - shipNet,
          netMinor: shipNet,
          vatRate: rc ? 0 : shipRate,
          basis: rc ? "reverse_charge" : "standard",
          vatMinor: shipVat,
          grossMinor: shipGross,
          wouldHaveRate: rc ? shipRate : null,
        };

  const buckets = bucketsOf([
    ...lines.map((l) => ({ rate: l.vatRate, basis: l.basis, netMinor: l.netMinor, vatMinor: l.vatMinor, grossMinor: l.grossMinor })),
    ...(shipping ? [{ rate: shipping.vatRate, basis: shipping.basis, netMinor: shipping.netMinor, vatMinor: shipping.vatMinor, grossMinor: shipping.grossMinor }] : []),
  ]);
  const totals = totalsOf(buckets);

  // The discounts, as the shopper saw them (VAT-inclusive, informational; they add nothing). The code's is what is left of the order's.
  const codeMinor =
    order.discountMinor - order.memberDiscountMinor - order.campaignDiscountMinor - order.creditMinor - order.referralDiscountMinor - order.vatReliefMinor;
  const discounts: SnapshotDiscount[] = [
    ...(order.campaignDiscountMinor > 0 ? [{ kind: "campaign" as const, label: text(order.campaignLabel), grossMinor: order.campaignDiscountMinor }] : []),
    ...(order.memberDiscountMinor > 0 ? [{ kind: "member" as const, label: text(order.memberLabel), grossMinor: order.memberDiscountMinor }] : []),
    ...(order.referralDiscountMinor > 0 ? [{ kind: "welcome" as const, label: null, grossMinor: order.referralDiscountMinor }] : []),
    ...(codeMinor > 0 ? [{ kind: "code" as const, label: text(order.discountCode), grossMinor: codeMinor }] : []),
    ...(order.creditMinor > 0 ? [{ kind: "credit" as const, label: null, grossMinor: order.creditMinor }] : []),
  ];

  // The treatment is the order's, frozen when it was placed; the invoice never decides VAT.
  const sellerVat = sellerVatNumberOf(facts.treatment, facts.profile);
  const statements: TreatmentStatement[] = [
    ...(rc ? (["reverse_charge"] as const) : []),
    ...(order.vatKind === "ioss" ? (["ioss"] as const) : []),
    ...(facts.profile && !facts.profile.vatRegistered ? (["not_registered"] as const) : []),
    ...(buckets.some((b) => b.basis === "exempt") ? (["exempt"] as const) : []),
  ];
  const treatment: SnapshotTreatment = {
    kind: order.vatKind,
    reason: facts.treatment?.reason ?? null,
    sellerVatNumber: sellerVat,
    buyerVatNumber: rc ? (facts.treatment?.buyerVatNumber ?? null) : null,
    iossNumber: order.vatKind === "ioss" ? (facts.treatment?.iossNumber ?? null) : null,
    statements,
  };

  // The VAT in the seller's currency, and in the store's main currency for the reports.
  let vatHome: SnapshotVatHome | null = null;
  if (homeVatState({ fx, seller, currency: order.currency, vatMinor: totals.vatMinor }) === "ok") {
    const rate = fxFactor(order.currency, fx.homeCurrency as string, fx.rates) as number;
    vatHome = {
      currency: fx.homeCurrency as string,
      vatMinor: vatConverted(buckets, rate),
      fxRate: rate,
      asOf: fx.ratesAsOf,
      source: fx.ratesAuto ? "ecb_auto" : "owner",
    };
  }
  let vatMain: SnapshotVatMain | null = null;
  if (order.currency === fx.mainCurrency) vatMain = { currency: fx.mainCurrency, vatMinor: totals.vatMinor, fxRate: null };
  else {
    const rate = fxFactor(order.currency, fx.mainCurrency, fx.rates);
    if (rate !== null) vatMain = { currency: fx.mainCurrency, vatMinor: vatConverted(buckets, rate), fxRate: rate };
  }

  const online = order.totalMinor - order.balanceMinor;
  const payments: SnapshotPayment[] = [
    ...(online > 0 ? [{ kind: "paid_online" as const, amountMinor: online, provider: order.onlineProvider }] : []),
    ...(order.balanceMinor > 0 ? [{ kind: "pay_at_venue" as const, amountMinor: order.balanceMinor, provider: "venue" }] : []),
  ];

  const buyer = buyerOf(order, treatment.buyerVatNumber);
  if (!buyer.complete) notes.push("buyer_incomplete");
  if (rounded) notes.push("unit_price_rounded");
  if (deferred.length > 0) notes.push("trial_deferred");

  const physical = facts.lines.some((l) => l.delivery === "physical");
  const ship = cleanAddress(order.shippingAddress);
  const place = physical && (ship.city || ship.country) ? { city: ship.city, country: ship.country ?? order.marketCode } : null;

  return {
    version: SNAPSHOT_VERSION,
    documentType: "invoice",
    number: ctx.number,
    issuedOn: ctx.issuedOn,
    supplyDate: ctx.supplyDate,
    locale: order.locale,
    language: languageOfLocale(order.locale),
    currency: order.currency,
    seller: {
      legalName: text(seller.legalName),
      organisationNumber: text(seller.organisationNumber),
      vatRegistered: facts.profile?.vatRegistered ?? false,
      vatNumber: sellerVat,
      address: text(seller.postalAddress),
      country: seller.country,
      email: text(seller.email),
      footerNote: text(seller.footerNote),
    },
    buyer,
    order: { number: order.number, placedOn: order.placedOn, paidOn: order.paidOn, deliveryPlace: place },
    lines,
    shipping,
    discounts,
    buckets,
    totals,
    vatHome,
    vatMain,
    treatment,
    payments,
    deferred,
    notes,
  };
}
