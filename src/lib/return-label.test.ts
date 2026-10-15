import { describe, expect, it } from "vitest";

import { toRates } from "./currency";
import { refundFor, type RefundInput } from "./return-refund";
import { LABEL_PROBLEMS, addressComplete, labelBlock, labelCostIn, labelDeduction, type LabelFacts } from "./return-label";

const shopper = { name: "Kari Nordmann", street: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" };
const store = { name: "Butikken AS", street: "Lagerveien 1", postalCode: "0581", city: "Oslo", country: "NO" };
const ok: LabelFacts = {
  returnStatus: "approved",
  restricted: false,
  storeOpen: true,
  carrier: { id: "bring", complete: true, checkOk: true },
  from: shopper,
  to: store,
  booked: false,
};

describe("when a return label can be booked (4.7)", () => {
  it("is booked for an approved or travelling return with a checked Bring agreement in Norway", () => {
    expect(labelBlock(ok)).toBeNull();
    expect(labelBlock({ ...ok, returnStatus: "in_transit" })).toBeNull();
  });

  it("says why not, the first reason first", () => {
    const cases: [Partial<LabelFacts>, string][] = [
      [{ returnStatus: "closed" }, "ended"],
      [{ returnStatus: "cancelled" }, "ended"],
      [{ returnStatus: "requested" }, "state"],
      [{ returnStatus: "received" }, "state"],
      [{ restricted: true }, "restricted"],
      [{ storeOpen: false }, "store_closed"],
      [{ carrier: null }, "no_carrier"],
      [{ carrier: { id: "postnord", complete: true, checkOk: true } }, "no_carrier"],
      [{ carrier: { id: "helthjem", complete: true, checkOk: true } }, "no_carrier"],
      [{ carrier: { id: "bring", complete: false, checkOk: true } }, "carrier_incomplete"],
      [{ carrier: { id: "bring", complete: true, checkOk: false } }, "carrier_unchecked"],
      [{ from: { ...shopper, street: " " } }, "address_incomplete"],
      [{ from: null }, "address_incomplete"],
      [{ to: null }, "no_return_address"],
      [{ from: { ...shopper, country: "SE" } }, "country"],
      [{ to: { ...store, country: "DK" } }, "country"],
      [{ booked: true }, "booked"],
    ];
    for (const [over, code] of cases) expect([over, labelBlock({ ...ok, ...over })]).toEqual([over, code]);
    expect(labelBlock({ ...ok, from: { ...shopper, country: "no" } })).toBeNull();
  });

  it("has words for every reason", () => {
    for (const text of Object.values(LABEL_PROBLEMS)) expect(text.length).toBeGreaterThan(10);
    expect(addressComplete(shopper)).toBe(true);
    expect(addressComplete({ ...shopper, city: null })).toBe(false);
  });
});

describe("the label's cost in the order's currency", () => {
  const rates = toRates([
    { currency: "NOK", rate: 11.7, roundTo: 100 },
    { currency: "SEK", rate: 11.2, roundTo: 1 },
  ]);

  it("is the carrier's price in the same currency", () => {
    expect(labelCostIn({ amountMinor: 9900, currency: "NOK" }, "NOK", rates)).toBe(9900);
  });

  it("is converted once at the store's rates, half up to the cent, never to a price step", () => {
    // 99,00 NOK in euros at 11.7 NOK per euro: 846.15… cents, so 846.
    expect(labelCostIn({ amountMinor: 9900, currency: "NOK" }, "EUR", rates)).toBe(846);
    // 117,06 NOK: 1000.51… cents, so 1001 (half up).
    expect(labelCostIn({ amountMinor: 11706, currency: "NOK" }, "EUR", rates)).toBe(1001);
  });

  it("is not known without a rate, or for an amount that is not minor units", () => {
    expect(labelCostIn({ amountMinor: 9900, currency: "NOK" }, "USD", rates)).toBeNull();
    expect(labelCostIn({ amountMinor: -1, currency: "NOK" }, "NOK", rates)).toBeNull();
  });
});

describe("who pays for the label (4.8)", () => {
  it("takes a booked label's cost off when the shopper pays, or less when staff typed less", () => {
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900 })).toEqual({ ok: true, deductionMinor: 9900, capMinor: 9900 });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, typedMinor: 5000 })).toEqual({ ok: true, deductionMinor: 5000, capMinor: 9900 });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, typedMinor: 0 })).toEqual({ ok: true, deductionMinor: 0, capMinor: 9900 });
  });

  it("takes nothing off for a test label, which cannot be used and cost the store nothing, and refuses an amount typed for it (review finding)", () => {
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, test: true })).toEqual({ ok: true, deductionMinor: 0, capMinor: 0 });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, typedMinor: 0, test: true })).toEqual({ ok: true, deductionMinor: 0, capMinor: 0 });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, typedMinor: 9900, test: true })).toEqual({ ok: false, code: "test_label" });
    // Fed into refundFor(), a test label leaves the refund whole.
    const d = labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, test: true });
    if (!d.ok) throw new Error(d.code);
    expect(d.deductionMinor).toBe(0);
  });

  it("is never above the cost (Art. 14(1))", () => {
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, typedMinor: 9901 })).toEqual({ ok: false, code: "above_cost" });
  });

  it("takes nothing off when the store pays or nothing was recorded, and refuses an amount typed then", () => {
    for (const payer of ["store", null] as const) {
      expect(labelDeduction({ payer, source: "carrier", costMinor: 9900 })).toEqual({ ok: true, deductionMinor: 0, capMinor: 0 });
      expect(labelDeduction({ payer, source: "carrier", costMinor: 9900, typedMinor: 100 })).toEqual({ ok: false, code: "store_pays" });
    }
  });

  it("takes nothing off for an unknown cost until staff type one with a note", () => {
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: null })).toEqual({ ok: true, deductionMinor: 0, capMinor: null });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: null, typedMinor: 7900 })).toEqual({ ok: false, code: "note_needed" });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: null, typedMinor: 7900, note: "Bring's invoice" })).toEqual({ ok: true, deductionMinor: 7900, capMinor: null });
  });

  it("keeps D153's rule for a pasted label, and takes nothing for no label", () => {
    expect(labelDeduction({ payer: "shopper", source: "pasted", costMinor: null, typedMinor: 6900 })).toEqual({ ok: true, deductionMinor: 6900, capMinor: null });
    expect(labelDeduction({ payer: "shopper", source: "pasted", costMinor: null })).toEqual({ ok: true, deductionMinor: 0, capMinor: null });
    expect(labelDeduction({ payer: "shopper", source: null, costMinor: null, typedMinor: 100 })).toEqual({ ok: true, deductionMinor: 0, capMinor: 0 });
  });

  it("refuses an amount that is not whole minor units", () => {
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: 9900, typedMinor: 12.5 })).toEqual({ ok: false, code: "not_whole" });
    expect(labelDeduction({ payer: "shopper", source: "carrier", costMinor: -1 })).toEqual({ ok: false, code: "not_whole" });
  });

  it("feeds refundFor(): the shopper's refund is lowered by the label, never the store-pays one, and never below 0", () => {
    const base: RefundInput = {
      kind: "withdrawal",
      lines: [{ lineId: "a", quantity: 2, totalMinor: 20000, priorQuantity: 0, returnQuantity: 1, deductionMinor: 0 }],
      shippingPaidMinor: 4900,
      whoPaysReturn: "shopper",
      refundableMinor: 24900,
    };
    const take = (payer: "shopper" | "store") => {
      const d = labelDeduction({ payer, source: "carrier", costMinor: 9900 });
      if (!d.ok) throw new Error(d.code);
      return refundFor({ ...base, whoPaysReturn: payer, returnShippingMinor: d.deductionMinor });
    };
    expect(take("shopper").amountMinor).toBe(10000 - 9900);
    expect(take("shopper").working).toContainEqual({ key: "return_shipping", amountMinor: -9900 });
    expect(take("store").amountMinor).toBe(10000);
    // A label dearer than the goods returned: the refund stops at 0, the shopper never owes.
    const d = labelDeduction({ payer: "shopper", source: "carrier", costMinor: 12000 });
    expect(d.ok && refundFor({ ...base, returnShippingMinor: d.deductionMinor }).amountMinor).toBe(0);
  });
});
