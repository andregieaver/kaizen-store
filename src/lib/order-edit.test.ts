import { describe, expect, it } from "vitest";

import { vatIncluded } from "./checkout";
import {
  EDIT_BLOCKS,
  ORDER_EDIT_PROBLEMS,
  PART_KEYS,
  documentsSentence,
  editBase,
  editBlock,
  moneyBlock,
  moneySentence,
  noParts,
  orderEditProblemText,
  priceOrderEdit,
  sameBase,
  splitLine,
  type EditFacts,
  type EditOrderFacts,
  type EditTaxBasket,
  type SoldLine,
} from "./order-edit";
import {
  ORDER_EDIT_DOCUMENTS,
  ORDER_EDIT_DOCUMENT_TRANSITIONS,
  ORDER_EDIT_REASONS,
  ORDER_EDIT_REASON_LABELS,
  ORDER_EDIT_STATUSES,
  ORDER_EDIT_STATUS_LABELS,
  ORDER_EDIT_TRANSITIONS,
  canMoveEditDocuments,
  canMoveOrderEdit,
  editLabel,
  isOrderEditEnded,
  isOrderEditFinal,
  isOrderEditReason,
  isOrderEditStatus,
} from "./order-edit-status";

const facts = (over: Partial<EditFacts> = {}): EditFacts => ({
  status: "paid",
  copied: false,
  host: false,
  shipped: false,
  subscription: false,
  weeklyBox: false,
  booking: false,
  balanceMinor: 0,
  vatKind: "standard",
  returnOrWithdrawal: false,
  restricted: false,
  editPending: false,
  editCount: 0,
  storeOpen: true,
  ...over,
});

const sold = (lineId: string, over: Partial<SoldLine> = {}): SoldLine => {
  const quantity = over.quantity ?? 1;
  const unit = over.unitPriceMinor ?? 10000;
  const discount = over.discountMinor ?? 0;
  const total = unit * quantity - discount;
  return {
    lineId,
    variantId: `v-${lineId}`,
    sku: `SKU-${lineId}`,
    title: `Item ${lineId}`,
    quantity,
    unitPriceMinor: unit,
    totalMinor: total,
    taxMinor: vatIncluded(total, over.taxRate ?? 0.25),
    taxRate: 0.25,
    discountMinor: discount,
    parts: noParts(),
    backorderQuantity: 0,
    backorderDays: null,
    goods: true,
    physical: true,
    gift: false,
    ...over,
  };
};

/** An order as placeOrder() leaves it: the lines, the shipping (with its VAT at 25 %), and the totals that add up. */
function orderOf(lines: SoldLine[], o: { shipping?: number; shippingDiscount?: number; currency?: string } = {}): EditOrderFacts {
  const shipping = o.shipping ?? 0;
  const shipDiscount = o.shippingDiscount ?? 0;
  const parts = noParts();
  for (const l of lines) for (const k of PART_KEYS) parts[k] += l.parts[k];
  const subtotal = lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
  const discount = lines.reduce((s, l) => s + l.discountMinor, 0) + shipDiscount;
  return {
    currency: o.currency ?? "NOK",
    subtotalMinor: subtotal,
    shippingMinor: shipping,
    discountMinor: discount,
    taxMinor: lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncluded(shipping - shipDiscount, 0.25),
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

/** decideTax() for a standard order: the VAT in each line, the shipping at 25 %. */
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

describe("the lifecycle of a change (3.3 point 7; order_edits_rules() is the same table)", () => {
  it("moves forward only, and applied, cancelled and expired are final", () => {
    expect(ORDER_EDIT_STATUSES).toEqual(["awaiting_payment", "applied", "cancelled", "expired"]);
    expect(ORDER_EDIT_TRANSITIONS.awaiting_payment).toEqual(["applied", "cancelled", "expired"]);
    for (const s of ["applied", "cancelled", "expired"] as const) {
      expect(isOrderEditFinal(s)).toBe(true);
      for (const t of ORDER_EDIT_STATUSES) expect(canMoveOrderEdit(s, t)).toBe(false);
    }
    expect(isOrderEditEnded("expired")).toBe(true);
    expect(isOrderEditEnded("applied")).toBe(false);
    expect(isOrderEditStatus("applied")).toBe(true);
    expect(isOrderEditStatus("sent")).toBe(false);
    expect(isOrderEditReason("store_error")).toBe(true);
    expect(isOrderEditReason("whim")).toBe(false);
    for (const s of ORDER_EDIT_STATUSES) expect(ORDER_EDIT_STATUS_LABELS[s]).toMatch(/\w/);
    for (const r of ORDER_EDIT_REASONS) expect(ORDER_EDIT_REASON_LABELS[r]).toMatch(/\w/);
    expect(editLabel(3)).toBe("E3");
  });

  it("moves the documents forward only", () => {
    expect(ORDER_EDIT_DOCUMENTS).toEqual(["none", "issued", "waiting", "not_invoiced", "in_original"]);
    expect(canMoveEditDocuments("none", "waiting")).toBe(true);
    expect(canMoveEditDocuments("waiting", "issued")).toBe(true);
    expect(canMoveEditDocuments("waiting", "none")).toBe(false);
    for (const final of ["issued", "not_invoiced", "in_original"] as const) expect(ORDER_EDIT_DOCUMENT_TRANSITIONS[final]).toEqual([]);
  });
});

describe("which orders can be changed (4.4)", () => {
  it("lets a paid, unsent, standard order of an open store be changed", () => {
    expect(editBlock(facts())).toBeNull();
  });

  const cases: [string, Partial<EditFacts>, string][] = [
    ["a copied order", { copied: true }, "copied"],
    ["an order waiting for payment", { status: "pending_payment" }, "not_paid"],
    ["a cancelled order", { status: "cancelled" }, "not_paid"],
    ["a closed order", { status: "closed" }, "not_paid"],
    ["a sent order", { status: "fulfilled", shipped: true }, "sent"],
    ["a partly sent order", { shipped: true }, "sent"],
    ["a host's order", { host: true }, "host"],
    ["a subscription", { subscription: true }, "subscription"],
    ["a subscription box delivery", { weeklyBox: true }, "weekly_box"],
    ["a booking", { booking: true }, "booking"],
    ["a venue balance", { balanceMinor: 1 }, "venue_balance"],
    ["reverse charge", { vatKind: "reverse_charge" }, "vat_kind"],
    ["IOSS", { vatKind: "ioss" }, "vat_kind"],
    ["a return or withdrawal", { returnOrWithdrawal: true }, "return"],
    ["units taken off what is still to send", { unsentClosed: true }, "unsent_closed"],
    ["an erased person's order", { restricted: true }, "restricted"],
    ["a change waiting for payment", { editPending: true }, "edit_pending"],
    ["the twentieth change made", { editCount: 20 }, "edit_limit"],
    ["a store that is not open", { storeOpen: false }, "store_closed"],
  ];
  it.each(cases)("refuses %s", (_name, over, reason) => {
    expect(editBlock(facts(over))).toBe(reason);
    expect(orderEditProblemText(reason as keyof typeof EDIT_BLOCKS)).toMatch(/\.$/);
  });

  it("allows the nineteenth change", () => {
    expect(editBlock(facts({ editCount: 19 }))).toBeNull();
  });

  it("refuses money through Stripe when payments are off or the mode differs, and never for nothing or money outside Kaizen", () => {
    const base = { differenceMinor: -500, throughStripe: true, paymentsOn: true, orderTestMode: false, storeTestMode: false };
    expect(moneyBlock(base)).toBeNull();
    expect(moneyBlock({ ...base, paymentsOn: false })).toBe("payments_off");
    expect(moneyBlock({ ...base, storeTestMode: true })).toBe("test_mode");
    expect(moneyBlock({ ...base, differenceMinor: 0, paymentsOn: false })).toBeNull();
    expect(moneyBlock({ ...base, throughStripe: false, paymentsOn: false })).toBeNull();
  });
});

describe("lowering a line keeps what was sold (splitLine(), 4.3 point 1)", () => {
  const rich = sold("a", {
    quantity: 3,
    unitPriceMinor: 10001,
    discountMinor: 3001,
    totalMinor: 27002,
    taxMinor: 5400,
    parts: { member: 1000, campaign: 700, bonus: 500, referral: 300, staff: 401, relief: 0 },
    backorderQuantity: 2,
    backorderDays: 10,
  });

  it("adds up, column by column, to the line as sold", () => {
    for (const keep of [0, 1, 2, 3]) {
      const { kept, removed } = splitLine(rich, keep);
      expect(kept.quantity + removed.quantity).toBe(3);
      expect(kept.totalMinor + removed.totalMinor).toBe(rich.totalMinor);
      expect(kept.taxMinor + removed.taxMinor).toBe(rich.taxMinor);
      expect(kept.discountMinor + removed.discountMinor).toBe(rich.discountMinor);
      expect(kept.goodsMinor + removed.goodsMinor).toBe(rich.unitPriceMinor * 3);
      for (const k of PART_KEYS) expect(kept.parts[k] + removed.parts[k]).toBe(rich.parts[k]);
      expect(kept.backorderQuantity + removed.backorderQuantity).toBe(2);
    }
  });

  it("keeps the line's own checks: total = unit × quantity − discount, VAT within the total, parts within the discount", () => {
    for (const keep of [1, 2]) {
      const { kept, removed } = splitLine(rich, keep);
      for (const part of [kept, removed]) {
        expect(part.totalMinor).toBe(rich.unitPriceMinor * part.quantity - part.discountMinor);
        expect(part.taxMinor).toBeLessThanOrEqual(part.totalMinor);
        const named = PART_KEYS.reduce((s, k) => s + part.parts[k], 0);
        expect(named).toBeLessThanOrEqual(part.discountMinor);
        for (const k of PART_KEYS) {
          expect(part.parts[k]).toBeGreaterThanOrEqual(0);
          expect(part.parts[k]).toBeLessThanOrEqual(rich.parts[k]);
        }
        expect(part.parts.staff).toBeLessThanOrEqual(part.discountMinor);
      }
    }
  });

  it("uses D153's cumulative floor: the odd minor units go with the units taken off", () => {
    const line = sold("b", { quantity: 3, unitPriceMinor: 3334, totalMinor: 10001, taxMinor: 2000, discountMinor: 1 });
    const { kept, removed } = splitLine(line, 1);
    expect(kept.totalMinor).toBe(3333);
    expect(removed.totalMinor).toBe(6668);
    expect(kept.taxMinor).toBe(666);
    expect(removed.taxMinor).toBe(1334);
  });

  it("takes units on backorder off first", () => {
    expect(splitLine(rich, 2).kept.backorderQuantity).toBe(1);
    expect(splitLine(rich, 1).kept.backorderQuantity).toBe(0);
    expect(splitLine(sold("c", { quantity: 3, backorderQuantity: 1, backorderDays: 5 }), 2).kept.backorderQuantity).toBe(0);
  });

  it("shares a staff discount (a draft's) and breaks ties to the earlier part", () => {
    const staffOnly = sold("d", { quantity: 2, unitPriceMinor: 1001, discountMinor: 3, totalMinor: 1999, taxMinor: 400, parts: { ...noParts(), staff: 3 } });
    const { kept } = splitLine(staffOnly, 1);
    expect(kept.discountMinor).toBe(2);
    expect(kept.parts.staff).toBe(2);
    const tie = sold("e", { quantity: 2, unitPriceMinor: 1000, discountMinor: 2, totalMinor: 1998, taxMinor: 400, parts: { ...noParts(), member: 1, campaign: 1 } });
    expect(splitLine(tie, 1).kept.parts).toMatchObject({ member: 1, campaign: 0 });
  });

  it("refuses a keep outside 0 to the quantity", () => {
    expect(() => splitLine(rich, 4)).toThrow(RangeError);
    expect(() => splitLine(rich, -1)).toThrow(RangeError);
    expect(() => splitLine(rich, 1.5)).toThrow(RangeError);
  });
});

describe("pricing a change (priceOrderEdit(), 4.3)", () => {
  const a = sold("a", { quantity: 2, unitPriceMinor: 20000 });
  const b = sold("b", { quantity: 1, unitPriceMinor: 15000 });
  const fee = sold("f", { goods: false, physical: false, sku: "DL", unitPriceMinor: 5000 });
  const order = orderOf([a, b, fee], { shipping: 4900 });

  it("removes a line, lowers one and adds one, with the totals adding up and the difference the change of total", () => {
    const p = priceOrderEdit(
      {
        order,
        quantities: { a: 1, b: 0 },
        added: [{ key: "x", variantId: "v-x", sku: "X", title: "Added", unitPriceMinor: 12500, listPriceMinor: 12500, quantity: 2, rate: 0.25 }],
        shipping: { kind: "keep" },
        reason: "customer_request",
      },
      standardTax,
    );
    expect(p.ok).toBe(true);
    expect(p.removed.map((l) => l.lineId)).toEqual(["b"]);
    expect(p.reduced.map((l) => [l.lineId, l.after.quantity])).toEqual([["a", 1]]);
    expect(p.lines.map((l) => [l.n, l.kind, l.quantity])).toEqual([[1, "reduce", 1], [2, "remove", 1], [3, "add", 2]]);
    expect(p.after.subtotalMinor).toBe(order.subtotalMinor - 20000 - 15000 + 25000);
    expect(p.after.totalMinor).toBe(p.after.subtotalMinor + p.after.shippingMinor - p.after.discountMinor);
    expect(p.differenceMinor).toBe(p.after.totalMinor - p.before.totalMinor);
    expect(p.differenceMinor).toBe(-10000);
    expect(p.money).toBe("refund");
    expect(p.mustNotify).toBe(true);
    // VAT: the kept lines' as sold (split), the added line's from the decision, the shipping's unchanged.
    const keptTax = splitLine(a, 1).kept.taxMinor + fee.taxMinor;
    expect(p.after.taxMinor).toBe(keptTax + vatIncluded(25000, 0.25) + vatIncluded(4900, 0.25));
    expect(p.added[0]).toMatchObject({ totalMinor: 25000, taxMinor: vatIncluded(25000, 0.25) });
  });

  it("works in another currency the same way (the amounts are the order's own: nothing is converted)", () => {
    const eur = orderOf([sold("a", { quantity: 3, unitPriceMinor: 1999, discountMinor: 600, totalMinor: 5397, taxMinor: 1079, parts: { ...noParts(), campaign: 600 } })], {
      shipping: 490,
      currency: "EUR",
    });
    const p = priceOrderEdit({ order: eur, quantities: { a: 2 }, added: [], shipping: { kind: "keep" } }, standardTax);
    expect(p.ok).toBe(true);
    expect(p.after.campaignDiscountMinor).toBe(400);
    expect(p.after.discountMinor).toBe(400);
    expect(p.after.totalMinor).toBe(3598 + 490);
    expect(p.differenceMinor).toBe(-1799);
    expect(p.lines[0]).toMatchObject({ kind: "reduce", totalMinor: 1799, discountMinor: 200, parts: { campaign: 200 } });
  });

  it("asks for payment of a higher total and must tell the customer", () => {
    const p = priceOrderEdit(
      { order, quantities: {}, added: [{ key: "x", variantId: "v-x", sku: "X", title: "Added", unitPriceMinor: 999, listPriceMinor: 999, quantity: 1, rate: 0.15 }], shipping: { kind: "keep" } },
      standardTax,
    );
    expect(p).toMatchObject({ ok: true, differenceMinor: 999, money: "charge", mustNotify: true });
    expect(p.added[0].taxMinor).toBe(vatIncluded(999, 0.15));
  });

  it("sets a new shipping price at the order's own shipping rate, and refuses it on an order whose shipping was discounted", () => {
    const p = priceOrderEdit({ order, quantities: {}, added: [], shipping: { kind: "set", amountMinor: 0 } }, standardTax);
    expect(p).toMatchObject({ ok: true, differenceMinor: -4900, shippingDelta: -4900, taxDelta: -vatIncluded(4900, 0.25) });
    const discounted = orderOf([a], { shipping: 4900, shippingDiscount: 4900 });
    const q = priceOrderEdit({ order: discounted, quantities: {}, added: [], shipping: { kind: "set", amountMinor: 0 } }, standardTax);
    expect(q.problems).toContainEqual({ code: "shipping_discounted" });
    // Keeping it is always allowed.
    expect(priceOrderEdit({ order: discounted, quantities: { a: 1 }, added: [], shipping: { kind: "keep" } }, standardTax).ok).toBe(true);
  });

  it("says what is wrong", () => {
    const run = (input: Partial<Parameters<typeof priceOrderEdit>[0]>) =>
      priceOrderEdit({ order, quantities: {}, added: [], shipping: { kind: "keep" }, ...input }, standardTax).problems.map((p) => p.code);
    expect(run({})).toEqual(["no_change"]);
    expect(run({ quantities: { a: 3 } })).toEqual(["only_down"]);
    expect(run({ quantities: { zz: 0 } })).toEqual(["unknown_line"]);
    expect(run({ quantities: { f: 0 } })).toEqual(["not_editable"]);
    expect(run({ quantities: { a: -1 } })).toEqual(["quantity_invalid"]);
    expect(run({ quantities: { a: 0, b: 0 } })).toEqual([]);
    const only = orderOf([a]);
    expect(priceOrderEdit({ order: only, quantities: { a: 0 }, added: [], shipping: { kind: "keep" } }, standardTax).problems.map((p) => p.code)).toEqual(["nothing_left"]);
    const add = (over: object) => ({ key: "x", variantId: "v", sku: "X", title: "X", unitPriceMinor: 100, listPriceMinor: null, quantity: 1, rate: 0.25, ...over });
    expect(run({ added: [add({ quantity: 0 })] })).toEqual(["quantity_invalid"]);
    expect(run({ added: [add({ quantity: 10_000 })] })).toEqual(["quantity_invalid"]);
    expect(run({ added: [add({ unitPriceMinor: -1 })] })).toEqual(["price_invalid"]);
    expect(run({ added: Array.from({ length: 51 }, (_, i) => add({ key: `k${i}` })) })).toEqual(["too_many_lines"]);
    expect(run({ shipping: { kind: "set", amountMinor: -5 } })).toEqual(["shipping_invalid"]);
    // A swap without payment needs the customer's own request.
    expect(run({ quantities: { b: 0 }, added: [add({ unitPriceMinor: 100 })], reason: "out_of_stock" })).toEqual(["swap_needs_request"]);
    expect(run({ quantities: { b: 0 }, added: [add({ unitPriceMinor: 100 })], reason: "customer_request" })).toEqual([]);
    // A gift line can be taken off even though its value is 0, and a total of 0 is refused.
    const gift = sold("g", { unitPriceMinor: 5000, discountMinor: 5000, totalMinor: 0, taxMinor: 0, gift: true, parts: { ...noParts(), campaign: 5000 } });
    expect(priceOrderEdit({ order: orderOf([a, gift]), quantities: { g: 0 }, added: [], shipping: { kind: "keep" } }, standardTax).ok).toBe(true);
    expect(priceOrderEdit({ order: orderOf([a, gift]), quantities: { a: 0 }, added: [], shipping: { kind: "keep" } }, standardTax).problems.map((p) => p.code)).toEqual(["total_zero"]);
    for (const text of Object.values(ORDER_EDIT_PROBLEMS)) expect(text).toMatch(/\.$/);
  });

  it("refuses a change the tax decision would treat otherwise than standard", () => {
    const ioss = (basket: EditTaxBasket) => ({ ...standardTax(basket), decision: { kind: "ioss", reverseCharge: false } });
    const p = priceOrderEdit({ order, quantities: { a: 1 }, added: [], shipping: { kind: "keep" } }, ioss);
    expect(p.problems.map((x) => x.code)).toEqual(["vat_changed"]);
    expect(p.ok).toBe(false);
  });

  it("does not tell the customer of a swap that takes nothing off and costs nothing more", () => {
    const p = priceOrderEdit({ order, quantities: {}, added: [], shipping: { kind: "set", amountMinor: 4900 + 0 } }, standardTax);
    expect(p.problems.map((x) => x.code)).toEqual(["no_change"]);
  });
});

describe("the base of a change and the summary's words", () => {
  const order = orderOf([sold("a", { quantity: 2 }), sold("b")]);
  it("compares the order as previewed with the order as it is", () => {
    expect(sameBase(editBase(order), editBase({ ...order, lines: [...order.lines].reverse() }))).toBe(true);
    expect(sameBase(editBase(order), editBase({ ...order, totalMinor: order.totalMinor - 1 }))).toBe(false);
    expect(sameBase(editBase(order), editBase({ ...order, lines: [order.lines[0]] }))).toBe(false);
    expect(sameBase(editBase(order), editBase({ ...order, lines: [{ ...order.lines[0], quantity: 1 }, order.lines[1]] }))).toBe(false);
  });

  it("says what happens to the money and the documents", () => {
    expect(moneySentence("charge", "149,00 kr")).toBe("The customer will be asked to pay 149,00 kr. The order stays as it is until they pay.");
    expect(moneySentence("refund", "149,00 kr")).toBe("149,00 kr is refunded to the customer's card.");
    expect(moneySentence("refund", "149,00 kr", true)).toMatch(/store pays it back itself/);
    expect(moneySentence("none", "")).toBe("Nothing to pay or refund.");
    expect(documentsSentence({ invoiced: true, creditMinor: 1, invoiceMinor: 1, invoiceNumber: "F-17" })).toBe(
      "A credit note for what is taken off and an additional invoice for what is added, referring to invoice F-17.",
    );
    expect(documentsSentence({ invoiced: true, creditMinor: 1, invoiceMinor: 0, invoiceNumber: null })).toBe("A credit note for what is taken off.");
    expect(documentsSentence({ invoiced: false, creditMinor: 1, invoiceMinor: 1, invoiceNumber: "F-1" })).toMatch(/no invoice/);
  });
});
