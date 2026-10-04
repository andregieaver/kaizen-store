import { describe, expect, it } from "vitest";

import {
  SELLER_REASONS,
  VAT_KINDS,
  VAT_REASONS,
  buildOrderTreatment,
  parseOrderTreatment,
  reasonShopperText,
  reasonStaffText,
  shopperTreatment,
  vatTreatment,
  type VatReason,
  type VatTreatmentInput,
} from "./vat-treatment";

/** A Swedish store, registered with a number checked valid, selling goods to a German business with a valid number. */
const reverse = (): VatTreatmentInput => ({
  seller: { country: "SE", inEu: true, registered: true, numberValid: true, number: "SE556677889901", dispatchCountry: "SE", dispatchInEu: true },
  buyer: { kind: "business", vat: { state: "valid", number: "DE123456789", prefixCountry: "DE" } },
  delivery: { country: "DE", inEu: true },
  basket: { hasService: false, hasSubscription: false, hasGoodsOrDigital: true, hasPhysical: true, hostOrder: false, taxedAmountPositive: true },
  ioss: { number: null, markets: [] },
  consignmentEurMinor: 10_000,
});

/** A Norwegian store with an IOSS number selling goods from Norway to a German private buyer. */
const ioss = (): VatTreatmentInput => ({
  seller: { country: "NO", inEu: false, registered: true, numberValid: true, number: "NO923456785MVA", dispatchCountry: "NO", dispatchInEu: false },
  buyer: { kind: "private", vat: { state: "none", number: null, prefixCountry: null } },
  delivery: { country: "DE", inEu: true },
  basket: { hasService: false, hasSubscription: false, hasGoodsOrDigital: true, hasPhysical: true, hostOrder: false, taxedAmountPositive: true },
  ioss: { number: "IM1234567890", markets: ["DE", "FR"] },
  consignmentEurMinor: 10_000,
});

const change = (base: VatTreatmentInput, patch: (x: VatTreatmentInput) => void): VatTreatmentInput => {
  const copy = structuredClone(base);
  patch(copy);
  return copy;
};

const decide = (input: VatTreatmentInput) => vatTreatment(input);

describe("reverse charge", () => {
  it("applies to goods sold by an EU-registered seller to a business with a valid number for the delivery country", () => {
    expect(decide(reverse())).toEqual({ kind: "reverse_charge", reverseCharge: true, reason: "reverse_charge", notes: [] });
  });

  it("applies to downloads as it does to goods", () => {
    // goods or digital are the same fact to the engine: the basket has goods or downloads and nothing else
    expect(decide(reverse()).kind).toBe("reverse_charge");
  });

  it("applies with Greece's number as EL for a delivery to GR", () => {
    const input = change(reverse(), (x) => {
      x.buyer.vat = { state: "valid", number: "EL123456789", prefixCountry: "GR" };
      x.delivery = { country: "GR", inEu: true };
    });
    expect(decide(input).kind).toBe("reverse_charge");
  });

  it("applies to a Danish market of a Swedish store, and to a Czech one", () => {
    for (const country of ["DK", "CZ"]) {
      const input = change(reverse(), (x) => {
        x.buyer.vat = { state: "valid", number: `${country}12345678`, prefixCountry: country };
        x.delivery = { country, inEu: true };
      });
      expect(decide(input).kind).toBe("reverse_charge");
    }
  });
});

describe("a business buyer who does not qualify keeps standard, with the reason", () => {
  const cases: [string, (x: VatTreatmentInput) => void, VatReason][] = [
    ["typed no number", (x) => { x.buyer.vat = { state: "none", number: null, prefixCountry: null }; }, "no_buyer_vat_number"],
    ["the number is not valid", (x) => { x.buyer.vat.state = "invalid"; }, "number_invalid"],
    ["VIES could not be reached", (x) => { x.buyer.vat.state = "unavailable"; }, "number_unavailable"],
    ["the check is older than 24 hours", (x) => { x.buyer.vat.state = "stale"; }, "number_stale"],
    ["the number is from Norway", (x) => { x.buyer.vat = { state: "valid", number: "NO923456785MVA", prefixCountry: "NO" }; }, "number_not_eu"],
    ["the number is from the UK", (x) => { x.buyer.vat = { state: "valid", number: "GB123456789", prefixCountry: "GB" }; }, "number_not_eu"],
    ["the number is Northern Ireland's", (x) => { x.buyer.vat = { state: "valid", number: "XI123456789", prefixCountry: "XI" }; }, "number_not_eu"],
    ["the number has no country", (x) => { x.buyer.vat.prefixCountry = null; }, "number_not_eu"],
    ["the number is for another country than the goods go to", (x) => { x.buyer.vat = { state: "valid", number: "FR12345678901", prefixCountry: "FR" }; }, "number_other_country"],
    ["the number is the store's own", (x) => { x.buyer.vat = { state: "valid", number: "SE556677889901", prefixCountry: "SE" }; }, "own_number"],
    ["the goods go to the seller's own country", (x) => { x.delivery = { country: "SE", inEu: true }; x.buyer.vat = { state: "valid", number: "SE556677889902", prefixCountry: "SE" }; }, "same_country"],
  ];
  for (const [name, patch, reason] of cases) {
    it(`${name}: ${reason}`, () => {
      expect(decide(change(reverse(), patch))).toEqual({ kind: "standard", reverseCharge: false, reason, notes: [] });
    });
  }

  it("a valid number for another country than the market is never accepted as the delivery country's", () => {
    const input = change(reverse(), (x) => { x.delivery = { country: "NO", inEu: false }; });
    expect(decide(input).reason).toBe("number_other_country");
  });
});

describe("the seller", () => {
  const cases: [string, (x: VatTreatmentInput) => void, VatReason][] = [
    ["is outside the EU (a Norwegian store)", (x) => { x.seller = { country: "NO", inEu: false, registered: true, numberValid: true, number: "NO923456785MVA", dispatchCountry: "NO", dispatchInEu: false }; }, "seller_not_eu"],
    ["is not registered for VAT", (x) => { x.seller.registered = false; }, "seller_not_registered"],
    ["is registered but has no number", (x) => { x.seller.number = null; }, "seller_not_registered"],
    ["has a number that was never checked valid", (x) => { x.seller.numberValid = false; }, "seller_number_unverified"],
  ];
  for (const [name, patch, reason] of cases) {
    it(`that ${name} does not reverse charge: ${reason}`, () => {
      expect(decide(change(reverse(), patch))).toMatchObject({ kind: "standard", reverseCharge: false, reason });
    });
  }

  it("has seller reasons listed for the readiness lines", () => {
    expect([...SELLER_REASONS].sort()).toEqual(["seller_not_eu", "seller_not_registered", "seller_number_unverified"]);
  });
});

describe("the basket", () => {
  it("with a booking is charged VAT in full", () => {
    expect(decide(change(reverse(), (x) => { x.basket.hasService = true; })).reason).toBe("has_service");
  });

  it("with a subscription is charged VAT in full", () => {
    expect(decide(change(reverse(), (x) => { x.basket.hasSubscription = true; })).reason).toBe("has_subscription");
  });

  it("with a booking and a subscription says the booking", () => {
    expect(decide(change(reverse(), (x) => { x.basket.hasService = true; x.basket.hasSubscription = true; })).reason).toBe("has_service");
  });

  it("that carries no VAT has nothing to reverse", () => {
    expect(decide(change(reverse(), (x) => { x.basket.taxedAmountPositive = false; })).reason).toBe("nothing_taxable");
    expect(decide(change(reverse(), (x) => { x.basket.hasGoodsOrDigital = false; })).reason).toBe("nothing_taxable");
  });

  it("a host's order is always standard, whoever the buyer is", () => {
    expect(decide(change(reverse(), (x) => { x.basket.hostOrder = true; }))).toEqual({ kind: "standard", reverseCharge: false, reason: "host_order", notes: [] });
    expect(decide(change(ioss(), (x) => { x.basket.hostOrder = true; })).kind).toBe("standard");
  });
});

describe("where the goods are sent from", () => {
  it("is not an intra-Community supply when they are sent from outside the EU: no reverse charge", () => {
    const input = change(reverse(), (x) => { x.seller.dispatchCountry = "CN"; x.seller.dispatchInEu = false; });
    expect(decide(input)).toEqual({ kind: "standard", reverseCharge: false, reason: "dispatch_outside_eu", notes: [] });
    const norway = change(reverse(), (x) => { x.seller.dispatchCountry = "NO"; x.seller.dispatchInEu = false; });
    expect(decide(norway).reason).toBe("dispatch_outside_eu");
  });

  it("is a domestic sale when they are sent from the buyer's own country: no reverse charge", () => {
    const input = change(reverse(), (x) => { x.seller.dispatchCountry = "DE"; x.seller.dispatchInEu = true; });
    expect(decide(input)).toEqual({ kind: "standard", reverseCharge: false, reason: "dispatch_domestic", notes: [] });
  });

  it("is an intra-Community supply when they are sent from a third member state: reverse charge", () => {
    expect(decide(change(reverse(), (x) => { x.seller.dispatchCountry = "PL"; x.seller.dispatchInEu = true; })).kind).toBe("reverse_charge");
    expect(decide(change(reverse(), (x) => { x.seller.dispatchCountry = "SE"; x.seller.dispatchInEu = true; })).kind).toBe("reverse_charge");
  });

  it("is not asked of a basket of downloads alone: nothing is sent", () => {
    const outside = change(reverse(), (x) => { x.basket.hasPhysical = false; x.seller.dispatchCountry = "CN"; x.seller.dispatchInEu = false; });
    expect(decide(outside).kind).toBe("reverse_charge");
    const domestic = change(reverse(), (x) => { x.basket.hasPhysical = false; x.seller.dispatchCountry = "DE"; x.seller.dispatchInEu = true; });
    expect(decide(domestic).kind).toBe("reverse_charge");
  });

  it("is asked of a basket of goods and a download together: the goods are sent", () => {
    const mixed = change(reverse(), (x) => { x.basket.hasPhysical = true; x.seller.dispatchCountry = "CN"; x.seller.dispatchInEu = false; });
    expect(decide(mixed).reason).toBe("dispatch_outside_eu");
  });

  it("comes after the seller's and the basket's own reasons", () => {
    expect(decide(change(reverse(), (x) => { x.seller.registered = false; x.seller.dispatchInEu = false; })).reason).toBe("seller_not_registered");
    expect(decide(change(reverse(), (x) => { x.basket.hasService = true; x.seller.dispatchInEu = false; })).reason).toBe("has_service");
  });
});

describe("a private buyer", () => {
  it("is never reverse charged, a number typed or not", () => {
    const input = change(reverse(), (x) => { x.buyer.kind = "private"; });
    expect(decide(input)).toEqual({ kind: "standard", reverseCharge: false, reason: "consumer", notes: [] });
    expect(decide(change(input, (x) => { x.buyer.vat = { state: "none", number: null, prefixCountry: null }; })).reason).toBe("consumer");
  });
});

describe("IOSS", () => {
  it("marks a consignment of at most 150 EUR from outside the EU to a listed market", () => {
    expect(decide(ioss())).toEqual({ kind: "ioss", reverseCharge: false, reason: "ioss", notes: [] });
  });

  it("is exactly 150.00 EUR inside and 150.01 outside", () => {
    expect(decide(change(ioss(), (x) => { x.consignmentEurMinor = 15_000; })).kind).toBe("ioss");
    expect(decide(change(ioss(), (x) => { x.consignmentEurMinor = 15_001; }))).toEqual({
      kind: "standard", reverseCharge: false, reason: "ioss_over_limit", notes: ["import_notice"],
    });
  });

  it("is not marked without a euro rate, and says so", () => {
    expect(decide(change(ioss(), (x) => { x.consignmentEurMinor = null; }))).toEqual({
      kind: "standard", reverseCharge: false, reason: "ioss_no_rate", notes: ["import_notice"],
    });
  });

  it("is not marked for a business buyer", () => {
    const input = change(ioss(), (x) => { x.buyer.kind = "business"; });
    expect(decide(input).kind).toBe("standard");
    expect(decide(input).reason).toBe("no_buyer_vat_number");
  });

  it("is not marked for a store that sends from inside the EU", () => {
    expect(decide(change(ioss(), (x) => { x.seller.dispatchInEu = true; x.seller.dispatchCountry = "SE"; }))).toMatchObject({ kind: "standard", reason: "consumer" });
  });

  it("is not marked for a market the registration does not cover", () => {
    expect(decide(change(ioss(), (x) => { x.delivery = { country: "SE", inEu: true }; })).reason).toBe("consumer");
  });

  it("is not marked outside the EU, without a number, or with a booking or subscription", () => {
    expect(decide(change(ioss(), (x) => { x.delivery = { country: "NO", inEu: false }; })).reason).toBe("consumer");
    expect(decide(change(ioss(), (x) => { x.ioss.number = null; })).reason).toBe("consumer");
    expect(decide(change(ioss(), (x) => { x.basket.hasService = true; })).reason).toBe("consumer");
    expect(decide(change(ioss(), (x) => { x.basket.hasSubscription = true; })).reason).toBe("consumer");
  });

  it("is not marked when the basket has no goods", () => {
    expect(decide(change(ioss(), (x) => { x.basket.hasGoodsOrDigital = false; x.basket.hasPhysical = false; })).reason).toBe("consumer");
  });

  it("is not marked for a basket of downloads alone: a download is not a consignment", () => {
    expect(decide(change(ioss(), (x) => { x.basket.hasPhysical = false; }))).toEqual({ kind: "standard", reverseCharge: false, reason: "consumer", notes: [] });
    // not even over the limit: no import notice for what is never imported
    expect(decide(change(ioss(), (x) => { x.basket.hasPhysical = false; x.consignmentEurMinor = 99_999; }))).toEqual({ kind: "standard", reverseCharge: false, reason: "consumer", notes: [] });
  });

  it("marks a basket of goods and a download by the goods, the download being no part of it", () => {
    expect(decide(change(ioss(), (x) => { x.basket.hasGoodsOrDigital = true; x.basket.hasPhysical = true; })).kind).toBe("ioss");
  });
});

describe("every reason", () => {
  it("is produced by some input (the matrix covers the closed list)", () => {
    const seen = new Set<VatReason>();
    const inputs: VatTreatmentInput[] = [
      reverse(), ioss(),
      change(ioss(), (x) => { x.consignmentEurMinor = 15_001; }),
      change(ioss(), (x) => { x.consignmentEurMinor = null; }),
      change(reverse(), (x) => { x.buyer.kind = "private"; }),
      change(reverse(), (x) => { x.basket.hostOrder = true; }),
      change(reverse(), (x) => { x.buyer.vat = { state: "none", number: null, prefixCountry: null }; }),
      change(reverse(), (x) => { x.buyer.vat.state = "invalid"; }),
      change(reverse(), (x) => { x.buyer.vat.state = "unavailable"; }),
      change(reverse(), (x) => { x.buyer.vat.state = "stale"; }),
      change(reverse(), (x) => { x.buyer.vat.prefixCountry = "NO"; }),
      change(reverse(), (x) => { x.buyer.vat.prefixCountry = "FR"; }),
      change(reverse(), (x) => { x.buyer.vat = { state: "valid", number: "SE556677889901", prefixCountry: "SE" }; }),
      change(reverse(), (x) => { x.delivery = { country: "SE", inEu: true }; x.buyer.vat = { state: "valid", number: "SE556677889902", prefixCountry: "SE" }; }),
      change(reverse(), (x) => { x.seller.inEu = false; }),
      change(reverse(), (x) => { x.seller.registered = false; }),
      change(reverse(), (x) => { x.seller.numberValid = false; }),
      change(reverse(), (x) => { x.basket.hasService = true; }),
      change(reverse(), (x) => { x.basket.hasSubscription = true; }),
      change(reverse(), (x) => { x.basket.taxedAmountPositive = false; }),
      change(reverse(), (x) => { x.seller.dispatchCountry = "CN"; x.seller.dispatchInEu = false; }),
      change(reverse(), (x) => { x.seller.dispatchCountry = "DE"; }),
    ];
    for (const input of inputs) seen.add(decide(input).reason);
    expect([...seen].sort()).toEqual([...VAT_REASONS].sort());
  });

  it("has a sentence for staff, and one (possibly empty) for the shopper", () => {
    for (const reason of VAT_REASONS) {
      expect(reasonStaffText(reason).length).toBeGreaterThan(10);
      expect(typeof reasonShopperText(reason)).toBe("string");
    }
    expect(reasonStaffText("number_unavailable")).toMatch(/sale went on/);
    expect(reasonShopperText("number_unavailable")).toMatch(/could not be checked/);
    expect(reasonShopperText("reverse_charge")).toMatch(/Reverse charge/);
    expect(reasonShopperText("ioss")).toMatch(/IOSS/);
  });

  it("gives reverse charge for the one reason only, and the kinds are fixed", () => {
    const base = reverse();
    for (const reason of VAT_REASONS) expect(typeof reason).toBe("string");
    const decisions = [decide(base), decide(change(base, (x) => { x.basket.hasService = true; })), decide(ioss())];
    for (const d of decisions) expect(d.reverseCharge).toBe(d.reason === "reverse_charge");
    expect(VAT_KINDS).toEqual(["standard", "reverse_charge", "ioss"]);
  });
});

describe("a failed or missing check never exempts", () => {
  it("for every state of the buyer's number except a current valid one the VAT is charged", () => {
    for (const state of ["none", "invalid", "unavailable", "stale"] as const) {
      const input = change(reverse(), (x) => { x.buyer.vat.state = state; });
      expect(decide(input).reverseCharge).toBe(false);
    }
  });
});

describe("what an order keeps", () => {
  const facts = () => ({
    decision: decide(reverse()),
    sellerVatNumber: "SE556677889901",
    sellerCountry: "SE",
    buyerVatNumber: "DE123456789",
    buyerCountry: "DE",
    check: { status: "valid" as const, requestedAt: new Date("2026-10-03T10:00:00Z"), requestIdentifier: "WAPIA1", name: "Muster GmbH", address: "Berlin" },
    iossNumber: "IM1234567890",
    consignmentEurMinor: 10_000,
    shippingRule: "standard",
    shippingRate: 0.25,
  });

  it("is the decision, both numbers and what VIES said", () => {
    const t = buildOrderTreatment(facts());
    expect(t).toMatchObject({
      kind: "reverse_charge", reason: "reverse_charge", sellerVatNumber: "SE556677889901", buyerVatNumber: "DE123456789",
      vies: { status: "valid", checkedAt: "2026-10-03T10:00:00.000Z", requestIdentifier: "WAPIA1", registeredName: "Muster GmbH", registeredAddress: "Berlin" },
      shippingRule: "standard", shippingRate: 0.25,
    });
  });

  it("keeps the IOSS number only on an IOSS order", () => {
    expect(buildOrderTreatment(facts()).iossNumber).toBeNull();
    expect(buildOrderTreatment({ ...facts(), decision: decide(ioss()) }).iossNumber).toBe("IM1234567890");
  });

  it("says not_checked when there was no check", () => {
    const t = buildOrderTreatment({ ...facts(), check: null });
    expect(t.vies).toEqual({ status: "not_checked", checkedAt: null, requestIdentifier: null, registeredName: null, registeredAddress: null });
  });

  it("round-trips through JSON and reads defensively", () => {
    const t = buildOrderTreatment(facts());
    expect(parseOrderTreatment(JSON.parse(JSON.stringify(t)))).toEqual(t);
    for (const bad of [null, undefined, 3, "x", [], {}, { kind: "nope", reason: "consumer" }, { kind: "standard", reason: "nope" }]) {
      expect(parseOrderTreatment(bad)).toBeNull();
    }
    expect(parseOrderTreatment({ kind: "standard", reason: "consumer" })).toMatchObject({ kind: "standard", shippingRule: "standard", vies: { status: "not_checked" } });
  });

  it("never gives a shopper VIES's registered name or address", () => {
    const shown = shopperTreatment(buildOrderTreatment(facts()));
    expect(JSON.stringify(shown)).not.toMatch(/Muster|Berlin/);
    expect(shown.vies).toEqual({ status: "valid", checkedAt: "2026-10-03T10:00:00.000Z" });
  });
});
