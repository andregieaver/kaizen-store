/**
 * Tests only: a change priced by the real `priceOrderEdit()` over a small standard order (a mug at 25 % and a book at 0 %, shipping at 25 %), turned into what the
 * server's preview hands the screen. Never imported by the app.
 */
import { vatIncluded } from "./checkout";
import { noParts, priceOrderEdit, PART_KEYS, type EditAddInput, type EditOrderFacts, type EditTaxBasket, type SoldLine } from "./order-edit";
import { documentsSentence, editBase, moneySentence } from "./order-edit";
import { editSummaryView, type EditPreviewLike, type EditSummaryView } from "./order-edit-view";

export const MUG = "11111111-1111-4111-8111-111111111111";
export const BOOK = "22222222-2222-4222-8222-222222222222";

export function soldLine(lineId: string, over: Partial<SoldLine> = {}): SoldLine {
  const quantity = over.quantity ?? 1;
  const unit = over.unitPriceMinor ?? 10000;
  const discount = over.discountMinor ?? 0;
  const rate = over.taxRate ?? 0.25;
  const total = unit * quantity - discount;
  return {
    lineId,
    variantId: `v-${lineId}`,
    sku: `SKU-${lineId.slice(0, 4)}`,
    title: `Item ${lineId.slice(0, 4)}`,
    quantity,
    unitPriceMinor: unit,
    totalMinor: total,
    taxMinor: vatIncluded(total, rate),
    taxRate: rate,
    discountMinor: discount,
    parts: noParts(),
    backorderQuantity: 0,
    backorderDays: null,
    goods: true,
    physical: true,
    gift: false,
    ...over,
  };
}

export function orderFacts(lines: SoldLine[], shipping = 9900, currency = "NOK"): EditOrderFacts {
  const parts = noParts();
  for (const l of lines) for (const k of PART_KEYS) parts[k] += l.parts[k];
  const subtotal = lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
  const discount = lines.reduce((s, l) => s + l.discountMinor, 0);
  return {
    currency,
    subtotalMinor: subtotal,
    shippingMinor: shipping,
    discountMinor: discount,
    taxMinor: lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncluded(shipping, 0.25),
    totalMinor: subtotal + shipping - discount,
    memberDiscountMinor: parts.member,
    campaignDiscountMinor: parts.campaign,
    creditMinor: parts.bonus,
    referralDiscountMinor: parts.referral,
    staffDiscountMinor: parts.staff,
    vatReliefMinor: 0,
    shippingTaxRate: 0.25,
    lines,
  };
}

const standardTax = (basket: EditTaxBasket) => ({
  taxMinor: basket.lines.reduce((s, l) => s + vatIncluded(l.totalMinor, l.rate), 0) + vatIncluded(basket.shippingMinor, 0.25),
  reliefMinor: 0,
  shippingRate: 0.25,
  decision: { kind: "standard", reverseCharge: false },
  result: {
    lines: basket.lines.map((l) => ({ key: l.key, rate: l.rate, totalMinor: l.totalMinor, taxMinor: vatIncluded(l.totalMinor, l.rate), reliefMinor: 0 })),
    shipping: { rate: 0.25, totalMinor: basket.shippingMinor, taxMinor: vatIncluded(basket.shippingMinor, 0.25), reliefMinor: 0 },
    taxMinor: 0,
    reliefMinor: 0,
  },
});

/** The order (3 mugs at 100 kr, 1 book at 200 kr with 0 % VAT, shipping 99 kr), changed as asked, as the screen's summary. */
export function summaryOf(change: { quantities?: Record<string, number>; added?: EditAddInput[]; shipping?: { kind: "keep" } | { kind: "set"; amountMinor: number }; currency?: string; outside?: boolean } = {}): {
  preview: EditPreviewLike;
  view: EditSummaryView;
} {
  const order = orderFacts([soldLine(MUG, { quantity: 3 }), soldLine(BOOK, { unitPriceMinor: 20000, taxRate: 0, sku: "BOOK-1", title: "A book" })], 9900, change.currency ?? "NOK");
  const priced = priceOrderEdit({ order, quantities: change.quantities ?? {}, added: change.added ?? [], shipping: change.shipping ?? { kind: "keep" }, reason: "customer_request" }, standardTax);
  const amount = `${Math.abs(priced.differenceMinor) / 100} ${order.currency}`;
  const preview: EditPreviewLike = {
    ok: priced.ok,
    currency: order.currency,
    problems: priced.problems.map((p) => ({ code: p.code, ...(p.key ? { key: p.key } : {}), text: `problem ${p.code}` })),
    priced,
    added: (change.added ?? []).map((a) => ({ key: a.key, listPriceMinor: a.listPriceMinor, custom: a.listPriceMinor !== a.unitPriceMinor, backorder: a.key === "a2" ? { units: 2, days: 10 } : null })),
    base: editBase(order),
    money: priced.money,
    differenceMinor: priced.differenceMinor,
    outside: change.outside ?? false,
    mustNotify: priced.mustNotify,
    sentences: {
      money: moneySentence(priced.money, amount, change.outside ?? false),
      documents: documentsSentence({ invoiced: true, creditMinor: 1, invoiceMinor: (change.added ?? []).length > 0 ? 1 : 0, invoiceNumber: "F-17" }),
    },
    invoiceNumber: "F-17",
  };
  return { preview, view: editSummaryView(preview) };
}

export const addedMug = (over: Partial<EditAddInput> = {}): EditAddInput => ({
  key: "a1",
  variantId: "33333333-3333-4333-8333-333333333333",
  sku: "PLATE-1",
  title: "Plate (Blue)",
  unitPriceMinor: 14900,
  listPriceMinor: 14900,
  quantity: 2,
  rate: 0.25,
  ...over,
});
