import { describe, expect, it } from "vitest";

import {
  bucketsOf,
  buildInvoiceSnapshot,
  buyerOf,
  convertWith,
  distribute,
  divRound,
  fxFactor,
  homeVatRequirement,
  homeVatState,
  isDeferredLine,
  languageOfLocale,
  sellerVatNumberOf,
  totalsOf,
  vatConverted,
  vatIncludedExact,
  withoutVatExact,
  type InvoiceFacts,
  type InvoiceLineFacts,
  type InvoiceOrderFacts,
} from "./invoice-snapshot";
import { vatIncluded } from "./checkout";

const order = (over: Partial<InvoiceOrderFacts> = {}): InvoiceOrderFacts => ({
  id: "o1",
  number: "1001",
  marketCode: "NO",
  currency: "NOK",
  locale: "nb-NO",
  email: "kari@example.com",
  placedOn: "2026-10-04",
  paidOn: "2026-10-04",
  shippingMinor: 0,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 0,
  memberDiscountMinor: 0,
  memberLabel: null,
  campaignDiscountMinor: 0,
  campaignLabel: null,
  creditMinor: 0,
  referralDiscountMinor: 0, staffDiscountMinor: 0, staffLabel: null,
  discountCode: null,
  vatKind: "standard",
  vatReliefMinor: 0,
  shippingTaxRate: 0.25,
  marketStandardRate: 0.25,
  companyName: null,
  organisationNumber: null,
  balanceMinor: 0,
  billingAddress: { name: "Kari Nordmann", line1: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" },
  shippingAddress: {},
  deliveryLabel: null,
  onlineProvider: "stripe",
  ...over,
});

const line = (over: Partial<InvoiceLineFacts> & { id: string }): InvoiceLineFacts => ({
  sku: over.id,
  title: `Item ${over.id}`,
  quantity: 1,
  unitPriceMinor: 0,
  totalMinor: 0,
  taxMinor: 0,
  taxRate: 0.25,
  delivery: "physical",
  gift: false,
  planned: false,
  bookedCount: null,
  vatCategory: "standard",
  booking: null,
  ...over,
});

/** A line as `placeOrder()` writes it: the VAT of what is paid for it. */
const paidLine = (id: string, unit: number, quantity: number, rate: number, discount = 0): InvoiceLineFacts => {
  const total = unit * quantity - discount;
  return line({ id, quantity, unitPriceMinor: unit, totalMinor: total, taxMinor: vatIncluded(total, rate), taxRate: rate });
};

function facts(lines: InvoiceLineFacts[], over: Partial<InvoiceOrderFacts> = {}, extra: Partial<InvoiceFacts> = {}): InvoiceFacts {
  const shipping = over.shippingMinor ?? 0;
  const rate = over.shippingTaxRate === undefined ? 0.25 : over.shippingTaxRate;
  const linesTotal = lines.reduce((s, l) => s + l.totalMinor, 0);
  const tax = lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncluded(shipping, rate ?? 0.25);
  return {
    order: order({ totalMinor: linesTotal + shipping, taxMinor: tax, ...over }),
    lines,
    seller: { legalName: "Fixture AS", organisationNumber: "923456789", postalAddress: "Storgata 1, 0155 Oslo", country: "NO", email: "post@fixture.example", footerNote: null },
    profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
    treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
    fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7", SEK: "11.2", DKK: "7.46" }, ratesAuto: false, ratesAsOf: "2026-10-01" },
    ...extra,
  };
}

const ctx = { number: "F-1", issuedOn: "2026-10-04", supplyDate: "2026-10-04" };

describe("the VAT in an amount that includes it", () => {
  it("is rounded half up, in exact integers", () => {
    expect(vatIncludedExact(12500, 0.25)).toBe(2500);
    expect(vatIncludedExact(3, 0.2)).toBe(1); // 0.5 rounds up
    expect(vatIncludedExact(1, 0.25)).toBe(0);
    expect(vatIncludedExact(0, 0.25)).toBe(0);
    expect(vatIncludedExact(100, 0)).toBe(0);
    expect(vatIncludedExact(9999999999, 0.2551)).toBe(Math.round((9999999999 * 0.2551) / 1.2551));
  });

  it("agrees with the checkout's own function except at an exact half, where the checkout's float can fall either way", () => {
    let ties = 0;
    for (const rate of [0.25, 0.24, 0.2, 0.19, 0.15, 0.12, 0.1, 0.07, 0.06, 0.255]) {
      const r = BigInt(Math.round(rate * 10_000));
      for (let amount = 0; amount <= 20000; amount += 7) {
        const a = vatIncludedExact(amount, rate);
        const b = vatIncluded(amount, rate);
        if (a !== b) {
          // The exact value is x.5: 2 x amount x rate = (1 + rate) x (BigInt(2) + 1).
          expect((BigInt(2) * BigInt(amount) * r) % (BigInt(2) * (BigInt(10_000) + r))).toBe(BigInt(10_000) + r);
          expect(Math.abs(a - b)).toBe(1);
          ties += 1;
        }
      }
    }
    expect(ties).toBeGreaterThan(0);
  });

  it("splits an amount into net and VAT that add up", () => {
    for (const amount of [1, 99, 1234, 99999]) expect(withoutVatExact(amount, 0.25) + vatIncludedExact(amount, 0.25)).toBe(amount);
  });
});

describe("distribute: the largest-remainder method", () => {
  it("adds up to the total exactly, never gives a share above its weight, and is deterministic", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i += 1) {
      const n = 1 + Math.floor(rnd() * 5);
      const weights = Array.from({ length: n }, () => Math.floor(rnd() * 5000));
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum === 0) continue;
      const total = Math.floor(rnd() * (sum + 1));
      const rates = Array.from({ length: n }, () => [0, 0.12, 0.15, 0.25][Math.floor(rnd() * 4)]);
      const shares = distribute(total, weights, rates);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      shares.forEach((s, j) => {
        expect(s).toBeLessThanOrEqual(weights[j]);
        expect(s).toBeGreaterThanOrEqual(0);
      });
      expect(distribute(total, weights, rates)).toEqual(shares);
    }
  });

  it("two of three equal weights share 2: the higher rate first, then the lower index", () => {
    expect(distribute(2, [1, 1, 1], [0.12, 0.25, 0.15])).toEqual([0, 1, 1]);
    expect(distribute(2, [1, 1, 1], [0.25, 0.25, 0.25])).toEqual([1, 1, 0]);
    expect(distribute(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });

  it("everything to one weight, nothing to share, nothing to share it over", () => {
    expect(distribute(0, [3, 4])).toEqual([0, 0]);
    expect(distribute(10, [0, 5])).toEqual([0, 10]);
    expect(() => distribute(1, [0, 0])).toThrow(RangeError);
    expect(() => distribute(-1, [1])).toThrow(RangeError);
    expect(distribute(10, [3, 3, 4])).toEqual([3, 3, 4]);
  });
});

describe("the currency of the VAT (Directive Art. 230)", () => {
  it("is needed when the invoice is in another currency than the seller's country keeps, except euro VAT for a Danish seller", () => {
    expect(homeVatRequirement("NO", "NOK", "NOK")).toBe(false);
    expect(homeVatRequirement("NO", "EUR", "NOK")).toBe(true);
    expect(homeVatRequirement("SE", "NOK", "SEK")).toBe(true);
    expect(homeVatRequirement("DK", "EUR", "DKK")).toBe(false);
    expect(homeVatRequirement("DK", "SEK", "DKK")).toBe(true);
    expect(homeVatRequirement("DE", "NOK", "EUR")).toBe(true);
    expect(homeVatRequirement(null, "NOK", "NOK")).toBe(false);
    expect(homeVatRequirement("NO", "EUR", null)).toBe(false);
  });

  it("converts at the store's euro-based rates, with eight decimals, and not at all without a rate", () => {
    expect(fxFactor("EUR", "NOK", { NOK: "11.7" })).toBe(11.7);
    expect(fxFactor("NOK", "EUR", { NOK: "11.7" })).toBeCloseTo(0.08547009, 8);
    expect(fxFactor("SEK", "NOK", { NOK: "11.7", SEK: "11.2" })).toBeCloseTo(1.04464286, 8);
    expect(fxFactor("NOK", "NOK", {})).toBe(1);
    expect(fxFactor("EUR", "NOK", {})).toBeNull();
    expect(fxFactor("EUR", "NOK", { NOK: null })).toBeNull();
    expect(fxFactor("EUR", "NOK", { NOK: 0 })).toBeNull();
    expect(fxFactor("EUR", "NOK", { NOK: 11.7 })).toBe(11.7);
  });

  it("converts bucket by bucket, rounding half up, so the document adds up", () => {
    expect(convertWith(1000, 0.08712345)).toBe(87);
    expect(convertWith(5, 0.5)).toBe(3);
    expect(vatConverted([{ vatMinor: 125 }, { vatMinor: 125 }], 0.5)).toBe(126);
    expect(vatConverted([{ vatMinor: 0 }], 11.7)).toBe(0);
  });

  it("needs a line only when there is VAT, and says when a rate is missing", () => {
    const f = facts([paidLine("a", 12500, 1, 0.25)]);
    expect(homeVatState({ fx: f.fx, seller: f.seller, currency: "NOK", vatMinor: 2500 })).toBe("not_required");
    expect(homeVatState({ fx: f.fx, seller: f.seller, currency: "EUR", vatMinor: 0 })).toBe("not_required");
    expect(homeVatState({ fx: f.fx, seller: f.seller, currency: "EUR", vatMinor: 2500 })).toBe("ok");
    expect(homeVatState({ fx: { ...f.fx, rates: {} }, seller: f.seller, currency: "EUR", vatMinor: 2500 })).toBe("no_rate");
  });
});

describe("the document's language", () => {
  it("is Norwegian for nb, nn and no, Swedish, Danish, and English for the rest", () => {
    expect(["nb-NO", "nn-NO", "no", "sv-SE", "da-DK", "de-DE", "fi-FI", "en-IE", "", null].map((l) => languageOfLocale(l))).toEqual(["nb", "nb", "nb", "sv", "da", "en", "en", "en", "en", "en"]);
  });
});

describe("buckets", () => {
  it("one per rate and basis, highest first, nothing for an empty one", () => {
    const rows = [
      { rate: 0.15, basis: "standard" as const, netMinor: 100, vatMinor: 15, grossMinor: 115 },
      { rate: 0.25, basis: "standard" as const, netMinor: 400, vatMinor: 100, grossMinor: 500 },
      { rate: 0.25, basis: "standard" as const, netMinor: 400, vatMinor: 100, grossMinor: 500 },
      { rate: 0, basis: "exempt" as const, netMinor: 50, vatMinor: 0, grossMinor: 50 },
      { rate: 0, basis: "reverse_charge" as const, netMinor: 0, vatMinor: 0, grossMinor: 0 },
    ];
    const buckets = bucketsOf(rows);
    expect(buckets.map((b) => [b.rate, b.basis, b.grossMinor])).toEqual([[0.25, "standard", 1000], [0.15, "standard", 115], [0, "exempt", 50]]);
    expect(totalsOf(buckets)).toEqual({ netMinor: 950, vatMinor: 215, grossMinor: 1165 });
  });
});

describe("the buyer's block", () => {
  const o = order();
  it("takes the billing address with a street line, else the shipping address, else only the country of the market", () => {
    expect(buyerOf(o, null)).toMatchObject({ complete: true, name: "Kari Nordmann", address: { line1: "Storgata 5", country: "NO" } });
    expect(buyerOf(order({ billingAddress: { name: "A", country: "SE" }, shippingAddress: { name: "B", line1: "Vägen 1", city: "Malmö" } }), null)).toMatchObject({ complete: true, name: "B", address: { line1: "Vägen 1", city: "Malmö", country: "NO" } });
    expect(buyerOf(order({ billingAddress: { name: "A", country: "SE" }, shippingAddress: {} }), null)).toEqual({
      type: "consumer", name: "A", company: null, organisationNumber: null, vatNumber: null,
      address: { line1: null, line2: null, postalCode: null, city: null, country: "SE" }, email: "kari@example.com", complete: false,
    });
    expect(buyerOf(order({ billingAddress: null, shippingAddress: null }), null).address.country).toBe("NO");
  });
  it("is a business when there is a company, with its numbers; the VAT number is only the one it is given", () => {
    const b = buyerOf(order({ companyName: "Muster GmbH", organisationNumber: "HRB 1" }), "DE123456789");
    expect(b).toMatchObject({ type: "business", company: "Muster GmbH", organisationNumber: "HRB 1", vatNumber: "DE123456789" });
    expect(buyerOf(order({ companyName: "  " }), null).type).toBe("consumer");
  });
});

describe("the seller's VAT number", () => {
  it("is the one the order was placed with, else the live profile's when registered", () => {
    const t = { reason: null, sellerVatNumber: "NO111", buyerVatNumber: null, iossNumber: null };
    expect(sellerVatNumberOf(t, { vatRegistered: true, vatNumber: "NO222" })).toBe("NO111");
    expect(sellerVatNumberOf({ ...t, sellerVatNumber: null }, { vatRegistered: true, vatNumber: "NO222" })).toBe("NO222");
    expect(sellerVatNumberOf(null, { vatRegistered: true, vatNumber: "NO222" })).toBe("NO222");
    expect(sellerVatNumberOf(null, { vatRegistered: false, vatNumber: "NO222" })).toBeNull();
    expect(sellerVatNumberOf(null, null)).toBeNull();
    expect(sellerVatNumberOf({ ...t, sellerVatNumber: " " }, null)).toBeNull();
  });
});

describe("buildInvoiceSnapshot: the invoice equals its order to the minor unit", () => {
  it("one line and shipping at one rate", () => {
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 12500, 1, 0.25)], { shippingMinor: 5900 }), ctx);
    expect(snap.totals).toEqual({ netMinor: 14720, vatMinor: 3680, grossMinor: 18400 });
    expect(snap.lines[0]).toMatchObject({ netMinor: 10000, vatMinor: 2500, grossMinor: 12500, listNetMinor: 10000, discountNetMinor: 0, unitNetMinor: 10000 });
    expect(snap.shipping).toMatchObject({ grossMinor: 5900, netMinor: 4720, vatMinor: 1180, netBeforeMinor: 4720 });
    expect(snap.buckets).toHaveLength(1);
    expect(snap.payments).toEqual([{ kind: "paid_online", amountMinor: 18400, provider: "stripe" }]);
    expect(snap.number).toBe("F-1");
    expect(snap.language).toBe("nb");
  });

  it("every case in the rounding table: totals are the order's, VAT per rate is the order's, the net before a discount is never below the net after", () => {
    const cases: { name: string; lines: InvoiceLineFacts[]; shipping?: number; rate?: number }[] = [
      { name: "odd price, quantity 3", lines: [paidLine("a", 12999, 3, 0.25)] },
      { name: "quantity 7 at 9.99", lines: [paidLine("a", 999, 7, 0.12)] },
      { name: "a code's discount", lines: [paidLine("a", 12999, 3, 0.25, 1500)] },
      { name: "three rates", lines: [paidLine("a", 12999, 1, 0.25), paidLine("b", 4950, 1, 0.15), paidLine("c", 999, 7, 0.12)], shipping: 9900 },
      { name: "shipping at another rate", lines: [paidLine("a", 12999, 1, 0.25)], shipping: 9900, rate: 0.15 },
      { name: "one minor unit", lines: [paidLine("a", 1, 1, 0.25)] },
      { name: "a hundred per cent off", lines: [paidLine("a", 5000, 1, 0.25, 5000)] },
      { name: "twenty per cent, odd", lines: [paidLine("a", 3333, 3, 0.2, 777)] },
      { name: "a high rate", lines: [paidLine("a", 777, 13, 0.255)] },
      { name: "exempt", lines: [{ ...paidLine("a", 2500, 1, 0), vatCategory: "exempt" }] },
    ];
    for (const c of cases) {
      const f = facts(c.lines, { shippingMinor: c.shipping ?? 0, shippingTaxRate: c.rate ?? 0.25 });
      const snap = buildInvoiceSnapshot(f, ctx);
      expect(snap.totals.grossMinor, c.name).toBe(f.order.totalMinor);
      expect(snap.totals.vatMinor, c.name).toBe(f.order.taxMinor);
      expect(snap.totals.netMinor, c.name).toBe(f.order.totalMinor - f.order.taxMinor);
      for (const l of snap.lines) {
        expect(l.listNetMinor - l.discountNetMinor, c.name).toBe(l.netMinor);
        expect(l.discountNetMinor, c.name).toBeGreaterThanOrEqual(0);
        expect(l.netMinor + l.vatMinor, c.name).toBe(l.grossMinor);
        expect(Math.abs(l.unitNetMinor * l.quantity - l.listNetMinor), c.name).toBeLessThanOrEqual(l.quantity);
      }
      expect(snap.buckets.reduce((s, b) => s + b.grossMinor, 0), c.name).toBe(f.order.totalMinor);
    }
  });

  it("a rounded unit price is footnoted and the line amount stays exact", () => {
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 12999, 3, 0.25)]), ctx);
    expect(snap.notes).toContain("unit_price_rounded");
    expect(snap.lines[0].listNetMinor).toBe(31198);
    expect(snap.lines[0].unitNetMinor).toBe(10399);
  });

  it("a discount is the difference of the net before and after", () => {
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 10000, 1, 0.25, 2500)]), ctx);
    expect(snap.lines[0]).toMatchObject({ listNetMinor: 8000, discountNetMinor: 2000, netMinor: 6000 });
  });

  it("a gift is shown at its list price with its whole discount and nets to nothing, in no bucket", () => {
    const gift = line({ id: "g", unitPriceMinor: 3000, totalMinor: 0, taxMinor: 0, gift: true });
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 5000, 1, 0.25), gift]), ctx);
    expect(snap.lines.map((l) => l.kind)).toEqual(["goods", "gift"]);
    expect(snap.lines[1]).toMatchObject({ listNetMinor: 2400, discountNetMinor: 2400, netMinor: 0, grossMinor: 0 });
    expect(snap.buckets).toHaveLength(1);
  });

  it("free shipping is a shipping line with its whole discount; no shipping at all is no line", () => {
    const free = buildInvoiceSnapshot(facts([paidLine("a", 5000, 1, 0.25)], { shippingMinor: 4900, totalMinor: 5000, taxMinor: 1000 }), ctx);
    expect(free.shipping).toMatchObject({ grossMinor: 0, netMinor: 0, netBeforeMinor: 3920, discountNetMinor: 3920 });
    expect(buildInvoiceSnapshot(facts([paidLine("a", 5000, 1, 0.25)]), ctx).shipping).toBeNull();
  });

  it("the shipping rate is the order's, else the market's standard rate", () => {
    const base = facts([paidLine("a", 5000, 1, 0.25)], { shippingMinor: 5000, shippingTaxRate: null, marketStandardRate: 0.2 });
    // facts() computed the order's tax at 0.25; the point here is only which rate the shipping line shows.
    const snap = buildInvoiceSnapshot({ ...base, order: { ...base.order, taxMinor: 1000 + vatIncluded(5000, 0.2) } }, ctx);
    expect(snap.shipping?.vatRate).toBe(0.2);
  });

  it("reverse charge: rate 0 on the document with the rate it would have had, VAT 0, the numbers of both", () => {
    const rc = (id: string, unit: number, rate: number): InvoiceLineFacts => {
      const relief = vatIncluded(unit, rate);
      return line({ id, unitPriceMinor: unit, totalMinor: unit - relief, taxMinor: 0, taxRate: rate });
    };
    const lines = [rc("a", 25000, 0.19), rc("b", 4000, 0.07)];
    const shippingRelief = vatIncluded(7500, 0.19);
    const f = facts(lines, {
      vatKind: "reverse_charge", shippingMinor: 7500, shippingTaxRate: 0.19, companyName: "Muster GmbH", marketCode: "DE", currency: "EUR", taxMinor: 0,
      totalMinor: lines.reduce((s, l) => s + l.totalMinor, 0) + 7500 - shippingRelief, discountMinor: lines.reduce((s, l) => s + vatIncluded(l.unitPriceMinor, l.taxRate), 0) + shippingRelief,
      vatReliefMinor: lines.reduce((s, l) => s + vatIncluded(l.unitPriceMinor, l.taxRate), 0) + shippingRelief,
    }, { treatment: { reason: "reverse_charge", sellerVatNumber: "NO923456789MVA", buyerVatNumber: "DE123456789", iossNumber: null }, fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: { NOK: "11.7" }, ratesAuto: false, ratesAsOf: "2026-10-01" } });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.totals.vatMinor).toBe(0);
    expect(snap.totals.grossMinor).toBe(snap.totals.netMinor);
    expect(snap.lines.map((l) => [l.vatRate, l.wouldHaveRate, l.basis])).toEqual([[0, 0.19, "reverse_charge"], [0, 0.07, "reverse_charge"]]);
    expect(snap.shipping).toMatchObject({ vatRate: 0, wouldHaveRate: 0.19, vatMinor: 0 });
    expect(snap.buckets).toHaveLength(1);
    expect(snap.treatment).toMatchObject({ kind: "reverse_charge", sellerVatNumber: "NO923456789MVA", buyerVatNumber: "DE123456789", statements: ["reverse_charge"] });
    expect(snap.buyer.vatNumber).toBe("DE123456789");
    expect(snap.vatHome).toBeNull();
  });

  it("a consumer's invoice never carries a buyer's VAT number, even when the treatment has one", () => {
    const f = facts([paidLine("a", 5000, 1, 0.25)], {}, { treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: "SE556677889901", iossNumber: "IM123" } });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.buyer.vatNumber).toBeNull();
    expect(snap.treatment.buyerVatNumber).toBeNull();
    expect(snap.treatment.iossNumber).toBeNull();
  });

  it("IOSS: the number and the statement, the VAT as charged", () => {
    const f = facts([paidLine("a", 9900, 1, 0.19)], { vatKind: "ioss", shippingTaxRate: 0.19 }, { treatment: { reason: "ioss", sellerVatNumber: null, buyerVatNumber: null, iossNumber: "IM5780000001" } });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.treatment).toMatchObject({ kind: "ioss", iossNumber: "IM5780000001", statements: ["ioss"] });
    expect(snap.totals.vatMinor).toBe(f.order.taxMinor);
  });

  it("not registered: no VAT number, and it says so; an exempt line says so too, in a bucket of its own", () => {
    const f = facts([{ ...paidLine("a", 2500, 1, 0), vatCategory: "exempt" }], { shippingTaxRate: 0 }, { profile: { vatRegistered: false, vatNumber: null }, treatment: null });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.treatment.statements).toEqual(["not_registered", "exempt"]);
    expect(snap.seller).toMatchObject({ vatRegistered: false, vatNumber: null });
    expect(snap.buckets[0]).toMatchObject({ rate: 0, basis: "exempt" });
  });

  it("names a staff discount as one, with the label staff gave it, and leaves nothing for the code (D173)", () => {
    const f = facts([paidLine("a", 20000, 1, 0.25, 2000)], { discountMinor: 2000, staffDiscountMinor: 2000, staffLabel: "Spring offer" });
    expect(buildInvoiceSnapshot(f, ctx).discounts).toEqual([{ kind: "staff", label: "Spring offer", grossMinor: 2000 }]);
    // Without a label it is still a staff discount, never an unnamed code.
    const unnamed = facts([paidLine("a", 20000, 1, 0.25, 2000)], { discountMinor: 2000, staffDiscountMinor: 2000 });
    expect(buildInvoiceSnapshot(unnamed, ctx).discounts).toEqual([{ kind: "staff", label: null, grossMinor: 2000 }]);
  });

  it("discounts as the shopper saw them, and the code's is what is left", () => {
    const f = facts([paidLine("a", 20000, 1, 0.25, 6000)], {
      discountMinor: 6000, memberDiscountMinor: 1000, memberLabel: "Gold", campaignDiscountMinor: 2000, campaignLabel: "Autumn sale", creditMinor: 500, referralDiscountMinor: 700, discountCode: "SAVE",
    });
    expect(buildInvoiceSnapshot(f, ctx).discounts).toEqual([
      { kind: "campaign", label: "Autumn sale", grossMinor: 2000 },
      { kind: "member", label: "Gold", grossMinor: 1000 },
      { kind: "welcome", label: null, grossMinor: 700 },
      { kind: "code", label: "SAVE", grossMinor: 1800 },
      { kind: "credit", label: null, grossMinor: 500 },
    ]);
  });

  it("a free trial's line is deferred and left out; a sign-up fee and a booking are lines", () => {
    const trial = line({ id: "t", unitPriceMinor: 0, totalMinor: 0, planned: true });
    expect(isDeferredLine(trial)).toBe(true);
    expect(isDeferredLine({ ...trial, gift: true })).toBe(false);
    expect(isDeferredLine({ ...trial, planned: false })).toBe(false);
    const fee = { ...paidLine("f", 4900, 1, 0.25), sku: "SIGNUP-FEE", delivery: "digital" as const, planned: true };
    const room = { ...paidLine("r", 180000, 1, 0.12), delivery: "service" as const, bookedCount: 2, booking: { startsAt: "2026-10-12T14:00", endsAt: "2026-10-14T11:00" } };
    const snap = buildInvoiceSnapshot(facts([trial, fee, room], { balanceMinor: 100000 }), ctx);
    expect(snap.deferred).toEqual([{ lineId: "t", title: "Item t", grossMinor: null }]);
    expect(snap.lines.map((l) => l.kind)).toEqual(["fee", "booking"]);
    expect(snap.lines[1]).toMatchObject({ serviceDate: "2026-10-12", service: { startsAt: "2026-10-12T14:00", endsAt: "2026-10-14T11:00", count: 2 } });
    expect(snap.notes).toContain("trial_deferred");
    expect(snap.payments.map((p) => p.kind)).toEqual(["paid_online", "pay_at_venue"]);
    expect(snap.payments[1].amountMinor).toBe(100000);
  });

  it("the VAT in the seller's currency, bucket by bucket, in an order in euros", () => {
    const f = facts([paidLine("a", 3333, 3, 0.24), paidLine("b", 1717, 1, 0.14)], { currency: "EUR", marketCode: "FI", shippingTaxRate: 0.24 });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.vatHome).toEqual({ currency: "NOK", vatMinor: snap.buckets.reduce((s, b) => s + Math.round(b.vatMinor * 11.7), 0), fxRate: 11.7, asOf: "2026-10-01", source: "owner" });
    expect(snap.vatMain).toEqual({ currency: "NOK", vatMinor: snap.vatHome?.vatMinor, fxRate: 11.7 });
    const auto = buildInvoiceSnapshot({ ...f, fx: { ...f.fx, ratesAuto: true } }, ctx);
    expect(auto.vatHome?.source).toBe("ecb_auto");
    // No rate, no line (the invoice then waits: see invoice-readiness).
    const none = buildInvoiceSnapshot({ ...f, fx: { ...f.fx, rates: {} } }, ctx);
    expect(none.vatHome).toBeNull();
    expect(none.vatMain).toBeNull();
  });

  it("a buyer without an address is flagged and a download has no place of delivery", () => {
    const f = facts([{ ...paidLine("a", 1900, 1, 0.25), delivery: "digital" }], { billingAddress: { name: "Ola", country: "SE" }, shippingAddress: {} });
    const snap = buildInvoiceSnapshot(f, ctx);
    expect(snap.notes).toEqual(["buyer_incomplete"]);
    expect(snap.order.deliveryPlace).toBeNull();
    expect(snap.lines[0].kind).toBe("download");
    const goods = buildInvoiceSnapshot(facts([paidLine("a", 1900, 1, 0.25)], { shippingAddress: { city: "Bergen", country: "NO" } }), ctx);
    expect(goods.order.deliveryPlace).toEqual({ city: "Bergen", country: "NO" });
  });

  it("is JSON that survives a round trip and carries what unit 1c reads", () => {
    const snap = buildInvoiceSnapshot(facts([paidLine("a", 12500, 1, 0.25)], { shippingMinor: 5900 }), ctx);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(Object.keys(snap)).toEqual(expect.arrayContaining(["buckets", "treatment", "vatMain", "order", "totals"]));
    expect(divRound(7, 2)).toBe(4);
    expect(divRound(1, 3)).toBe(0);
  });
});
