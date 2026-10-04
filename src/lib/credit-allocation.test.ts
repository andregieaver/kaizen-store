import { describe, expect, it } from "vitest";

import {
  adjustmentOf,
  bucketsLeft,
  creditAllocation,
  creditForReturn,
  creditFromGross,
  creditNoteSnapshot,
  creditVatConverted,
  parseWorking,
  refundRows,
  type BucketLeft,
  type ReturnWorking,
} from "./credit-allocation";
import { buildInvoiceSnapshot, vatIncludedExact, type InvoiceFacts, type InvoiceLineFacts, type OrderInvoiceSnapshot, type SnapshotBucket } from "./invoice-snapshot";

const bucket = (rate: number, net: number, vat: number, basis: SnapshotBucket["basis"] = "standard"): SnapshotBucket => ({ rate, basis, netMinor: net, vatMinor: vat, grossMinor: net + vat });
const left = (rate: number, gross: number, vat: number, basis: BucketLeft["basis"] = "standard"): BucketLeft => ({ rate, basis, netLeft: gross - vat, vatLeft: vat, grossLeft: gross });

describe("what each bucket of an invoice has left", () => {
  it("is the invoice's less every credit note's, never below 0", () => {
    const invoice = [bucket(0.25, 8000, 2000), bucket(0.15, 1000, 150)];
    expect(bucketsLeft(invoice, [])).toEqual([left(0.25, 10000, 2000), left(0.15, 1150, 150)]);
    const earlier = [[bucket(0.25, 800, 200)], [bucket(0.25, 1600, 400), bucket(0.15, 500, 75)]];
    expect(bucketsLeft(invoice, earlier)).toEqual([left(0.25, 7000, 1400), left(0.15, 575, 75)]);
    expect(bucketsLeft(invoice, [[bucket(0.25, 99999, 99999)]])[0]).toMatchObject({ grossLeft: 0, vatLeft: 0, netLeft: 0 });
  });

  it("matches a bucket by rate and basis, not by rate alone", () => {
    const invoice = [bucket(0, 1000, 0, "reverse_charge"), bucket(0, 500, 0, "exempt")];
    expect(bucketsLeft(invoice, [[bucket(0, 400, 0, "exempt")]]).map((b) => b.grossLeft)).toEqual([1000, 100]);
  });
});

describe("the VAT of a share of a bucket", () => {
  it("the whole of what is left carries the whole VAT left; a part carries the VAT in it", () => {
    const l = left(0.25, 2500, 500);
    expect(creditFromGross(l, 2500)).toMatchObject({ grossMinor: 2500, vatMinor: 500, netMinor: 2000 });
    expect(creditFromGross(l, 1000)).toMatchObject({ grossMinor: 1000, vatMinor: 200, netMinor: 800 });
    expect(creditFromGross(l, 0)).toMatchObject({ grossMinor: 0, vatMinor: 0, netMinor: 0 });
    expect(creditFromGross(l, 99999)).toMatchObject({ grossMinor: 2500, vatMinor: 500 });
  });

  it("two credits of 10 and 15 on a bucket of 25 leave exactly nothing with the VAT adding up", () => {
    const invoice = [bucket(0.25, 2000, 500)];
    const first = creditAllocation(bucketsLeft(invoice, []), 1000);
    const second = creditAllocation(bucketsLeft(invoice, [first.buckets]), 1500);
    expect(first.buckets[0].vatMinor + second.buckets[0].vatMinor).toBe(500);
    expect(first.buckets[0].netMinor + second.buckets[0].netMinor).toBe(2000);
    expect(bucketsLeft(invoice, [first.buckets, second.buckets])[0].grossLeft).toBe(0);
  });

  it("never gives so little VAT that the net exceeds the net left (earlier roundings can leave the VAT left high)", () => {
    const l: BucketLeft = { rate: 0.25, basis: "standard", netLeft: 1000, vatLeft: 5, grossLeft: 1005 };
    const c = creditFromGross(l, 1004);
    expect(c.netMinor).toBeLessThanOrEqual(l.netLeft);
    expect(c.vatMinor).toBeLessThanOrEqual(l.vatLeft);
    expect(c.netMinor + c.vatMinor).toBe(1004);
  });

  it("a reverse-charge or rate 0 bucket has no VAT", () => {
    expect(creditFromGross(left(0, 1000, 0, "reverse_charge"), 600)).toMatchObject({ vatMinor: 0, netMinor: 600 });
  });
});

describe("creditAllocation: a refund shared over the buckets", () => {
  it("in proportion to what each has left, adding up to the refund and never above a bucket", () => {
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 300; i += 1) {
      const rates = [0.25, 0.15, 0.12, 0];
      const buckets = rates.slice(0, 1 + Math.floor(rnd() * 4)).map((rate) => {
        const net = 1 + Math.floor(rnd() * 20000);
        return bucket(rate, net, vatIncludedExact(Math.round(net * (1 + rate)), rate));
      });
      const ls = bucketsLeft(buckets, []);
      const room = ls.reduce((s, b) => s + b.grossLeft, 0);
      const refund = Math.floor(rnd() * (room + 1));
      const a = creditAllocation(ls, refund);
      expect(a.creditedMinor).toBe(refund);
      expect(a.shortMinor).toBe(0);
      a.buckets.forEach((b, j) => {
        expect(b.grossMinor).toBeLessThanOrEqual(ls[j].grossLeft);
        expect(b.vatMinor).toBeLessThanOrEqual(ls[j].vatLeft);
        expect(b.netMinor).toBeLessThanOrEqual(ls[j].netLeft);
        expect(b.netMinor + b.vatMinor).toBe(b.grossMinor);
      });
      expect(creditAllocation(ls, refund)).toEqual(a);
    }
  });

  it("a full refund leaves 0 in every bucket and the VAT of the invoice, whatever came before", () => {
    const invoice = [bucket(0.25, 10399 * 3, vatIncludedExact(Math.round(10399 * 3 * 1.25), 0.25)), bucket(0.15, 4304, 646), bucket(0.12, 6240, 749)];
    const total = invoice.reduce((s, b) => s + b.grossMinor, 0);
    const parts = [1001, 25555, 777];
    const earlier: SnapshotBucket[][] = [];
    for (const p of parts) earlier.push(creditAllocation(bucketsLeft(invoice, earlier), p).buckets.map(toBucket));
    const rest = total - parts.reduce((a, b) => a + b, 0);
    earlier.push(creditAllocation(bucketsLeft(invoice, earlier), rest).buckets.map(toBucket));
    const final = bucketsLeft(invoice, earlier);
    expect(final.map((b) => b.grossLeft)).toEqual([0, 0, 0]);
    expect(final.map((b) => b.vatLeft)).toEqual([0, 0, 0]);
    const vat = earlier.flat().reduce((s, b) => s + b.vatMinor, 0);
    expect(vat).toBe(invoice.reduce((s, b) => s + b.vatMinor, 0));
  });

  it("more than is left is credited up to what is left and the rest is short; nothing left credits nothing", () => {
    const ls = bucketsLeft([bucket(0.25, 800, 200)], []);
    expect(creditAllocation(ls, 1500)).toMatchObject({ creditedMinor: 1000, shortMinor: 500 });
    expect(creditAllocation([left(0.25, 0, 0)], 100)).toMatchObject({ creditedMinor: 0, shortMinor: 100 });
    expect(creditAllocation(ls, 0)).toMatchObject({ creditedMinor: 0, shortMinor: 0 });
    expect(() => creditAllocation(ls, -1)).toThrow(RangeError);
    expect(() => creditAllocation(ls, 1.5)).toThrow(RangeError);
  });

  it("refund rows are one per bucket that was credited", () => {
    const a = creditAllocation([left(0.25, 1000, 200), left(0.12, 0, 0)], 400);
    expect(refundRows(a)).toEqual([{ kind: "refund", lineId: null, sku: null, title: null, quantity: null, vatRate: 0.25, basis: "standard", grossMinor: 400, netMinor: 320, vatMinor: 80 }]);
  });
});

const toBucket = (c: { rate: number; basis: SnapshotBucket["basis"]; netMinor: number; vatMinor: number; grossMinor: number }): SnapshotBucket => ({ rate: c.rate, basis: c.basis, netMinor: c.netMinor, vatMinor: c.vatMinor, grossMinor: c.grossMinor });

// ----------------------------------------------------------------------------------------------------------------------

function invoiceOf(): OrderInvoiceSnapshot {
  const lines: InvoiceLineFacts[] = [
    { id: "l1", sku: "A", title: "A", quantity: 2, unitPriceMinor: 10000, totalMinor: 20000, taxMinor: vatIncludedExact(20000, 0.25), taxRate: 0.25, delivery: "physical", gift: false, planned: false, bookedCount: null, vatCategory: "standard", booking: null },
    { id: "l2", sku: "B", title: "B", quantity: 1, unitPriceMinor: 5000, totalMinor: 5000, taxMinor: vatIncludedExact(5000, 0.15), taxRate: 0.15, delivery: "physical", gift: false, planned: false, bookedCount: null, vatCategory: "food", booking: null },
  ];
  const shipping = 4900;
  const f: InvoiceFacts = {
    order: {
      id: "o", number: "1001", marketCode: "NO", currency: "NOK", locale: "nb-NO", email: "k@example.com", placedOn: "2026-10-04", paidOn: "2026-10-04", shippingMinor: shipping,
      discountMinor: 0, taxMinor: lines.reduce((s, l) => s + l.taxMinor, 0) + vatIncludedExact(shipping, 0.25), totalMinor: 25000 + shipping, memberDiscountMinor: 0, memberLabel: null,
      campaignDiscountMinor: 0, campaignLabel: null, creditMinor: 0, referralDiscountMinor: 0, discountCode: null, vatKind: "standard", vatReliefMinor: 0, shippingTaxRate: 0.25,
      marketStandardRate: 0.25, companyName: null, organisationNumber: null, balanceMinor: 0, billingAddress: { name: "Kari", line1: "Storgata 5", city: "Oslo", country: "NO" },
      shippingAddress: {}, deliveryLabel: "Posten", onlineProvider: "stripe",
    },
    lines,
    seller: { legalName: "Fixture AS", organisationNumber: "923456789", postalAddress: "Storgata 1", country: "NO", email: null, footerNote: null },
    profile: { vatRegistered: true, vatNumber: "NO923456789MVA" },
    treatment: { reason: "consumer", sellerVatNumber: "NO923456789MVA", buyerVatNumber: null, iossNumber: null },
    fx: { homeCurrency: "NOK", mainCurrency: "NOK", rates: {}, ratesAuto: false, ratesAsOf: "2026-10-01" },
  };
  return buildInvoiceSnapshot(f, { number: "F-1", issuedOn: "2026-10-04", supplyDate: "2026-10-04" });
}

const working = (over: Partial<ReturnWorking> = {}): ReturnWorking => {
  const w = { lines: [{ lineId: "l1", quantity: 1, valueMinor: 10000, deductionMinor: 1000 }, { lineId: "l2", quantity: 1, valueMinor: 5000, deductionMinor: 0 }], deliveryMinor: 4900, returnShippingMinor: 3900, adjustmentMinor: 0, amountMinor: 15000, outside: false, ...over };
  return { ...w, adjustmentMinor: adjustmentOf(w) };
};

describe("a return's working", () => {
  it("is read from the JSON the return keeps, and refuses what is not shaped as one", () => {
    const w = working();
    expect(parseWorking(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(parseWorking(null)).toBeNull();
    expect(parseWorking([])).toBeNull();
    expect(parseWorking({ ...w, lines: "x" })).toBeNull();
    expect(parseWorking({ ...w, amountMinor: "1" })).toBeNull();
    expect(parseWorking({ ...w, lines: [{ lineId: 1, quantity: 1, valueMinor: 1, deductionMinor: 0 }] })).toBeNull();
    expect(adjustmentOf(w)).toBe(0);
    expect(adjustmentOf({ ...w, amountMinor: w.amountMinor + 300 })).toBe(300);
  });

  it("credits the returned lines at their own rates, the deduction, the delivery given back and the return shipping, adding up to the refund", () => {
    const inv = invoiceOf();
    const w = working();
    const c = creditForReturn(inv, bucketsLeft(inv.buckets, []), w, w.amountMinor);
    expect(c.usedWorking).toBe(true);
    expect(c.creditedMinor).toBe(15000);
    expect(c.rows.map((r) => [r.kind, r.vatRate, r.grossMinor])).toEqual([
      ["goods", 0.25, 10000],
      ["deduction", 0.25, -1000],
      ["goods", 0.15, 5000],
      ["delivery", 0.25, 4900],
      ["return_shipping", 0.25, -3900],
    ]);
    expect(c.rows.reduce((s, r) => s + r.grossMinor, 0)).toBe(15000);
    const byRate = Object.fromEntries(c.buckets.map((b) => [b.rate, b.grossMinor]));
    expect(byRate).toEqual({ 0.25: 10000, 0.15: 5000 });
  });

  it("a return shipping larger than the delivery given back, at a rate with nothing returned, comes off the goods as adjustment rows, so no bucket goes below nothing", () => {
    const inv = invoiceOf();
    const w = working({ lines: [{ lineId: "l2", quantity: 1, valueMinor: 5000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 3900, amountMinor: 1100 });
    const c = creditForReturn(inv, bucketsLeft(inv.buckets, []), w, 1100);
    expect(c.usedWorking).toBe(true);
    expect(c.creditedMinor).toBe(1100);
    expect(c.buckets.every((b) => b.grossMinor >= 0)).toBe(true);
    expect(c.buckets.map((b) => [b.rate, b.grossMinor])).toEqual([[0.25, 0], [0.15, 1100]]);
    expect(c.rows.filter((r) => r.kind === "adjustment").map((r) => [r.vatRate, r.grossMinor])).toEqual([[0.25, 3900], [0.15, -3900]]);
    expect(c.rows.reduce((s, r) => s + r.grossMinor, 0)).toBe(c.buckets.reduce((s, b) => s + b.grossMinor, 0));
  });

  it("an amount staff raised is shared again over the working's own buckets and shown as adjustment", () => {
    const inv = invoiceOf();
    const w = working({ lines: [{ lineId: "l1", quantity: 1, valueMinor: 10000, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 0, amountMinor: 10500 });
    const c = creditForReturn(inv, bucketsLeft(inv.buckets, []), w, 10500);
    expect(c.buckets.find((b) => b.rate === 0.25)?.grossMinor).toBe(10500);
    expect(c.buckets.find((b) => b.rate === 0.15)?.grossMinor).toBe(0);
    expect(c.rows.filter((r) => r.kind === "adjustment").map((r) => r.grossMinor)).toEqual([500]);
  });

  it("never above what is left: the amount is capped and the rest is short", () => {
    const inv = invoiceOf();
    const earlier = [creditAllocation(bucketsLeft(inv.buckets, []), 20000).buckets.map(toBucket)];
    const w = working();
    const c = creditForReturn(inv, bucketsLeft(inv.buckets, earlier), w, 15000);
    expect(c.creditedMinor + c.shortMinor).toBe(15000);
    expect(c.shortMinor).toBeGreaterThan(0);
    c.buckets.forEach((b, i) => expect(b.grossMinor).toBeLessThanOrEqual(bucketsLeft(inv.buckets, earlier)[i].grossLeft));
  });

  it("a working that does not fit (another amount, a line that is not on the invoice, delivery with no shipping line) is not used: a plain refund", () => {
    const inv = invoiceOf();
    const ls = bucketsLeft(inv.buckets, []);
    expect(creditForReturn(inv, ls, working(), 9000).usedWorking).toBe(false);
    expect(creditForReturn(inv, ls, working({ lines: [{ lineId: "nope", quantity: 1, valueMinor: 100, deductionMinor: 0 }], deliveryMinor: 0, returnShippingMinor: 0, amountMinor: 100 }), 100).usedWorking).toBe(false);
    expect(creditForReturn({ ...inv, shipping: null }, ls, working(), 15000).usedWorking).toBe(false);
    expect(creditForReturn(inv, ls, null, 4000)).toMatchObject({ usedWorking: false, creditedMinor: 4000 });
    expect(creditForReturn(inv, ls, working(), 9000).rows.every((r) => r.kind === "refund")).toBe(true);
  });
});

describe("the credit note's snapshot", () => {
  const inv = invoiceOf();
  const base = { invoice: { id: "inv-1", snapshot: inv }, earlier: [] as SnapshotBucket[][], source: "refund" as const, returnNumber: null, working: null, number: "K-1", issuedOn: "2026-10-09" };

  it("refers to the invoice by number and date, lists the credited VAT per rate, and says where the invoice stands", () => {
    const r = creditNoteSnapshot({ ...base, refundMinor: 5000 });
    const s = r.snapshot!;
    expect(r.creditedMinor).toBe(5000);
    expect(s.refersTo).toEqual({ invoiceId: "inv-1", invoiceNumber: "F-1", invoiceIssuedOn: "2026-10-04" });
    expect(s.reason).toEqual({ kind: "refund", returnNumber: null });
    expect(s.totals.grossMinor).toBe(5000);
    expect(s.position).toEqual({ invoiceTotalMinor: inv.totals.grossMinor, creditedBeforeMinor: 0, creditedNowMinor: 5000, leftOnInvoiceMinor: inv.totals.grossMinor - 5000 });
    expect(s.buyer).toEqual(inv.buyer);
    expect(s.seller).toEqual(inv.seller);
    expect(s.treatment).toEqual(inv.treatment);
    expect(s.notes).toEqual([]);
    expect(s.number).toBe("K-1");
  });

  it("a second note counts the first, and a refund above what is left is capped and says so", () => {
    const first = creditNoteSnapshot({ ...base, refundMinor: 20000 }).snapshot!;
    const second = creditNoteSnapshot({ ...base, earlier: [first.buckets], refundMinor: 20000, number: "K-2" });
    expect(second.creditedMinor).toBe(inv.totals.grossMinor - 20000);
    expect(second.shortMinor).toBe(20000 - second.creditedMinor);
    expect(second.snapshot!.notes).toEqual(["credit_capped"]);
    expect(second.snapshot!.position.leftOnInvoiceMinor).toBe(0);
    const none = creditNoteSnapshot({ ...base, earlier: [first.buckets, second.snapshot!.buckets], refundMinor: 100, number: "K-3" });
    expect(none).toEqual({ snapshot: null, creditedMinor: 0, shortMinor: 100 });
  });

  it("a return is a return, with its number and its working; a working that does not fit is said not to have been used", () => {
    const w = working();
    const r = creditNoteSnapshot({ ...base, source: "return_outside", returnNumber: "1001-R1", working: w, refundMinor: w.amountMinor }).snapshot!;
    expect(r.reason).toEqual({ kind: "return", returnNumber: "1001-R1" });
    expect(r.source).toBe("return_outside");
    expect(r.lines.map((l) => l.kind)).toContain("deduction");
    const off = creditNoteSnapshot({ ...base, returnNumber: "1001-R1", working: w, refundMinor: 1234 }).snapshot!;
    expect(off.notes).toEqual(["working_not_used"]);
    const plain = creditNoteSnapshot({ ...base, returnNumber: "1001-R1", working: null, refundMinor: 1234 }).snapshot!;
    expect(plain.notes).toEqual([]);
    expect(plain.reason.kind).toBe("return");
  });

  it("converts the VAT to the seller's currency at the invoice's rate, bucket by bucket", () => {
    const euro: OrderInvoiceSnapshot = { ...inv, currency: "EUR", vatHome: { currency: "NOK", vatMinor: 1, fxRate: 11.7, asOf: "2026-10-01", source: "owner" }, vatMain: { currency: "NOK", vatMinor: 1, fxRate: 11.7 } };
    const s = creditNoteSnapshot({ ...base, invoice: { id: "i", snapshot: euro }, refundMinor: 5000 }).snapshot!;
    expect(s.vatHome).toEqual({ currency: "NOK", vatMinor: s.buckets.reduce((a, b) => a + Math.round(b.vatMinor * 11.7), 0), fxRate: 11.7, asOf: "2026-10-01", source: "owner" });
    expect(s.vatMain?.fxRate).toBe(11.7);
    expect(s.currency).toBe("EUR");
    // An order in the main currency has no rate and the credit note's VAT is its own.
    const plain = creditNoteSnapshot({ ...base, refundMinor: 5000 }).snapshot!;
    expect(plain.vatHome).toBeNull();
    expect(plain.vatMain).toEqual({ currency: "NOK", vatMinor: plain.totals.vatMinor, fxRate: null });
  });
});

describe("the VAT of split credit notes in another currency (D159)", () => {
  const FX = 11.7;
  const convert = (n: number) => Math.floor(n * FX + 0.5);

  it("is the difference of cumulative conversions, so the notes add up to the invoice's converted VAT", () => {
    const invoice = [bucket(0.24, 7000, 1680), bucket(0.14, 3000, 420), bucket(0.1, 1111, 111)];
    const whole = invoice.reduce((s, b) => s + convert(b.vatMinor), 0);
    // Six notes that together credit every bucket exactly; each as its own list of buckets.
    const notes: SnapshotBucket[][] = [
      [bucket(0.24, 1000, 240), bucket(0.14, 500, 70)],
      [bucket(0.24, 333, 80)],
      [bucket(0.14, 1000, 140), bucket(0.1, 400, 40)],
      [bucket(0.24, 2667, 640), bucket(0.1, 300, 30)],
      [bucket(0.24, 3000, 720), bucket(0.14, 1500, 210)],
      [bucket(0.1, 411, 41)],
    ];
    expect(notes.flatMap((n) => n).reduce((s, b) => s + b.vatMinor, 0)).toBe(invoice.reduce((s, b) => s + b.vatMinor, 0));
    let sum = 0;
    notes.forEach((note, i) => {
      sum += creditVatConverted(note, notes.slice(0, i), FX);
    });
    expect(sum).toBe(whole);
  });

  it("two halves of a bucket add up to the whole one converted, where converting each half drifts (the old way: 59 + 59 against 117)", () => {
    const half = [bucket(0.25, 20, 5)];
    expect(convert(5) + convert(5)).toBe(118);
    expect(convert(10)).toBe(117);
    expect(creditVatConverted(half, [], FX) + creditVatConverted(half, [half], FX)).toBe(117);
  });

  it("with no earlier note it is the plain conversion, bucket by bucket", () => {
    const note = [bucket(0.24, 1000, 240), bucket(0.14, 500, 70)];
    expect(creditVatConverted(note, [], FX)).toBe(convert(240) + convert(70));
  });
});
