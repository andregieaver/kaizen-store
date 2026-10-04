import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toRates } from "@/lib/currency";
import { vatIncluded } from "@/lib/checkout";
import { DEFAULT_TAX_PROFILE, sellerFacts, type TaxProfile } from "@/lib/tax-profile";

import { cartTaxOf, decideTax, vatFieldFor, type TaxBasket, type TaxFacts } from "./tax-treatment";
import type { VatCheck } from "./vat-checks";

const SE_NUMBER = "SE556677889901";
const DE_NUMBER = "DE123456789";

const profile = (over: Partial<TaxProfile> = {}): TaxProfile => ({
  ...DEFAULT_TAX_PROFILE,
  iossMarkets: [],
  vatRegistered: true,
  vatNumber: SE_NUMBER,
  vatNumberValid: true,
  ...over,
});

const check = (over: Partial<VatCheck> = {}): VatCheck => ({
  id: "c1",
  purpose: "buyer",
  cartId: null,
  number: DE_NUMBER,
  status: "valid",
  source: "vies",
  name: "KUNDE GMBH",
  address: "BERLIN",
  requestIdentifier: "WAPI1",
  error: null,
  requestedAt: new Date().toISOString(),
  ...over,
});

/** A Swedish store, registered with a checked number, selling to a business in Germany. */
function facts(over: Partial<TaxFacts> = {}, p: TaxProfile = profile(), country = "SE"): TaxFacts {
  return {
    storeCountry: country,
    profile: p,
    seller: sellerFacts(p, country),
    business: true,
    buyerVatNumber: DE_NUMBER,
    buyerCheck: check(),
    buyerState: "valid",
    deliveryCountry: "DE",
    deliveryInEu: true,
    standardRate: 0.19,
    shippingRule: "standard",
    rates: toRates([{ currency: "EUR", rate: 1, roundTo: 1 }, { currency: "SEK", rate: 11, roundTo: 1 }]),
    ...over,
  };
}

const goods = (key: string, totalMinor: number, rate = 0.19) => ({ key, totalMinor, rate, booking: false, physical: true, recurring: false, host: false });
const download = (key: string, totalMinor: number, rate = 0.19) => ({ ...goods(key, totalMinor, rate), physical: false });
const basket = (over: Partial<TaxBasket> = {}): TaxBasket => ({
  lines: [goods("0", 11_900), goods("1", 5_000, 0.07)],
  shippingMinor: 1_190,
  fees: [],
  currency: "EUR",
  ...over,
});

describe("which VAT a basket carries (D157)", () => {
  it("charges the VAT of the buyer's country on a private buyer, as always", () => {
    const outcome = decideTax(facts({ business: false, buyerVatNumber: null, buyerCheck: null, buyerState: "none" }), basket());
    expect(outcome.decision).toMatchObject({ kind: "standard", reason: "consumer" });
    expect(outcome.taxMinor).toBe(vatIncluded(11_900, 0.19) + vatIncluded(5_000, 0.07) + vatIncluded(1_190, 0.19));
    expect(outcome.reliefMinor).toBe(0);
  });

  it("takes the VAT off a valid business number for the delivery country: the total is the ordinary total minus its tax, to the minor unit", () => {
    const b = basket();
    const ordinary = decideTax(facts({ business: false, buyerVatNumber: null, buyerCheck: null, buyerState: "none" }), b);
    const reverse = decideTax(facts(), b);
    expect(reverse.decision).toMatchObject({ kind: "reverse_charge", reason: "reverse_charge", reverseCharge: true });
    expect(reverse.taxMinor).toBe(0);
    expect(reverse.reliefMinor).toBe(ordinary.taxMinor);
    const gross = b.lines.reduce((s, l) => s + l.totalMinor, 0) + b.shippingMinor;
    const net = reverse.result.lines.reduce((s, l) => s + l.totalMinor, 0) + reverse.result.shipping.totalMinor;
    expect(net).toBe(gross - ordinary.taxMinor);
    // The rate that would have applied is kept on each line, so the relief per rate can be read.
    expect(reverse.result.lines.map((l) => l.rate)).toEqual([0.19, 0.07]);
  });

  it("keeps what an order stores about it, with both numbers and the VIES answer", () => {
    const outcome = decideTax(facts(), basket());
    expect(outcome.treatment).toMatchObject({
      kind: "reverse_charge",
      reason: "reverse_charge",
      sellerVatNumber: SE_NUMBER,
      sellerCountry: "SE",
      buyerVatNumber: DE_NUMBER,
      buyerCountry: "DE",
      vies: { status: "valid", requestIdentifier: "WAPI1", registeredName: "KUNDE GMBH" },
      shippingRule: "standard",
      shippingRate: 0.19,
    });
  });

  it("never reverse-charges when the check was too old, failed, or said no, and says why", () => {
    const reasons: [Partial<TaxFacts>, string][] = [
      [{ buyerState: "stale" }, "number_stale"],
      [{ buyerState: "unavailable", buyerCheck: check({ status: "unavailable" }) }, "number_unavailable"],
      [{ buyerState: "invalid", buyerCheck: check({ status: "invalid" }) }, "number_invalid"],
      [{ buyerState: "none", buyerVatNumber: null, buyerCheck: null }, "no_buyer_vat_number"],
    ];
    for (const [over, reason] of reasons) {
      const outcome = decideTax(facts(over), basket());
      expect(outcome.decision, reason).toMatchObject({ kind: "standard", reason });
      expect(outcome.reliefMinor, reason).toBe(0);
      expect(outcome.taxMinor, reason).toBeGreaterThan(0);
    }
  });

  it("charges VAT for a number of another country than the one the goods go to, the store's own number, and a number outside the EU", () => {
    expect(decideTax(facts({ buyerVatNumber: "FR12345678901" }), basket()).decision.reason).toBe("number_other_country");
    expect(decideTax(facts({ buyerVatNumber: SE_NUMBER }), basket()).decision.reason).toBe("own_number");
    expect(decideTax(facts({ buyerVatNumber: "NO923609016MVA" }), basket()).decision.reason).toBe("number_not_eu");
    expect(decideTax(facts({ deliveryCountry: "SE", standardRate: 0.25, buyerVatNumber: "DE123456789" }), basket()).decision.reason).toBe("same_country");
  });

  it("needs a registered seller in the EU whose number was checked valid", () => {
    expect(decideTax(facts({}, profile({ vatNumberValid: null })), basket()).decision.reason).toBe("seller_number_unverified");
    expect(decideTax(facts({}, profile({ vatRegistered: false })), basket()).decision.reason).toBe("seller_not_registered");
    const norwegian = profile({ vatNumber: "NO923609016MVA" });
    expect(decideTax(facts({}, norwegian, "NO"), basket()).decision.reason).toBe("seller_not_eu");
  });

  it("never reverse-charges a booking, a subscription, a host's listing, or a basket with no VAT in it", () => {
    const booking = { ...goods("2", 9_000), booking: true };
    expect(decideTax(facts(), basket({ lines: [goods("0", 11_900), booking] })).decision.reason).toBe("has_service");
    const plan = { ...goods("2", 9_000), recurring: true };
    expect(decideTax(facts(), basket({ lines: [goods("0", 11_900), plan] })).decision.reason).toBe("has_subscription");
    expect(decideTax(facts(), basket({ lines: [{ ...goods("0", 11_900), host: true }] })).decision).toMatchObject({ kind: "standard", reason: "host_order" });
    expect(decideTax(facts(), basket({ lines: [goods("0", 11_900, 0)], shippingMinor: 0 })).decision.reason).toBe("nothing_taxable");
  });

  it("does not reverse-charge goods sent from outside the EU, nor goods sent from the buyer's own country, but does downloads", () => {
    const from = (dispatchCountry: string) => facts({}, profile({ dispatchCountry }), "SE");
    expect(decideTax(from("CN"), basket()).decision).toMatchObject({ kind: "standard", reason: "dispatch_outside_eu" });
    expect(decideTax(from("NO"), basket()).decision.reason).toBe("dispatch_outside_eu");
    expect(decideTax(from("DE"), basket()).decision).toMatchObject({ kind: "standard", reason: "dispatch_domestic" });
    expect(decideTax(from("PL"), basket()).decision.kind).toBe("reverse_charge");
    // the reason is the seller's own side to the buyer: VAT is charged in full, no relief
    expect(decideTax(from("CN"), basket()).reliefMinor).toBe(0);
    // a basket of downloads alone sends nothing
    const downloads = basket({ lines: [download("0", 11_900)], shippingMinor: 0 });
    expect(decideTax(from("CN"), downloads).decision.kind).toBe("reverse_charge");
    expect(decideTax(from("DE"), downloads).decision.kind).toBe("reverse_charge");
    // with goods in the basket too, the goods are sent
    expect(decideTax(from("CN"), basket({ lines: [download("0", 5_000), goods("1", 5_000)] })).decision.reason).toBe("dispatch_outside_eu");
  });

  it("keeps no treatment for a host's order", () => {
    expect(decideTax(facts(), basket({ lines: [{ ...goods("0", 11_900), host: true }] })).treatment).toBeNull();
  });

  it("computes the relief of fees as none: a fee only comes with a subscription", () => {
    const outcome = decideTax(facts(), basket({ fees: [{ amountMinor: 1_190, rate: 0.19 }], lines: [{ ...goods("0", 11_900), recurring: true }] }));
    expect(outcome.decision.reason).toBe("has_subscription");
    expect(outcome.taxMinor).toBe(vatIncluded(11_900, 0.19) + vatIncluded(1_190, 0.19) + vatIncluded(1_190, 0.19));
  });
});

describe("shipping VAT (D157)", () => {
  it("is the standard rate unless a verified rule says otherwise", () => {
    const b = basket({ lines: [goods("0", 5_000, 0.07)] });
    expect(decideTax(facts({ business: false, buyerCheck: null, buyerVatNumber: null, buyerState: "none" }), b).shippingRate).toBe(0.19);
    expect(decideTax(facts({ business: false, buyerCheck: null, buyerVatNumber: null, buyerState: "none", shippingRule: "follows_goods" }), b).shippingRate).toBe(0.07);
    expect(decideTax(facts({ business: false, buyerCheck: null, buyerVatNumber: null, buyerState: "none", shippingRule: "highest" }), basket()).shippingRate).toBe(0.19);
  });

  it("leaves a free product out of the goods the rule looks at", () => {
    const b = basket({ lines: [goods("0", 5_000, 0.07), { ...goods("1", 0, 0.19), gift: true }] });
    expect(decideTax(facts({ business: false, buyerCheck: null, buyerVatNumber: null, buyerState: "none", shippingRule: "follows_goods" }), b).shippingRate).toBe(0.07);
  });
});

describe("IOSS (D157)", () => {
  const ioss = profile({ vatRegistered: false, vatNumber: null, vatNumberValid: null, iossNumber: "IM2460000000", iossMarkets: ["DE"], dispatchCountry: "CN" });
  const privateBuyer = { business: false, buyerVatNumber: null, buyerCheck: null, buyerState: "none" as const };
  const rates = toRates([{ currency: "EUR", rate: 1, roundTo: 1 }, { currency: "NOK", rate: 11.5, roundTo: 1 }]);
  const inEuro = (goodsWithVatMinor: number) => basket({ lines: [goods("0", goodsWithVatMinor)], shippingMinor: 0 });

  it("marks a consignment of at most 150.00 EUR and not one of 150.01, counted without VAT", () => {
    const f = facts(privateBuyer, ioss, "NO");
    // 150.00 EUR without VAT is 178.50 EUR with 19 % VAT.
    const at = decideTax(f, inEuro(17_850));
    expect(at.consignmentEurMinor).toBe(15_000);
    expect(at.decision).toMatchObject({ kind: "ioss", reason: "ioss" });
    expect(at.treatment?.iossNumber).toBe("IM2460000000");
    expect(at.taxMinor).toBe(vatIncluded(17_850, 0.19));
    const over = decideTax(f, inEuro(17_851));
    expect(over.consignmentEurMinor).toBe(15_001);
    expect(over.decision).toMatchObject({ kind: "standard", reason: "ioss_over_limit" });
    expect(over.importNotice).toBe(true);
    expect(over.treatment?.iossNumber).toBeNull();
  });

  it("converts a krone basket at the store's rate, and marks nothing for a currency without one", () => {
    const f = facts({ ...privateBuyer, rates }, ioss, "NO");
    // 1 EUR = 11.5 NOK: 150 EUR without VAT is 1725 NOK; with 19 % VAT 2052.75 NOK.
    expect(decideTax(f, { ...inEuro(205_275), currency: "NOK" }).decision.kind).toBe("ioss");
    expect(decideTax(f, { ...inEuro(205_400), currency: "NOK" }).decision.reason).toBe("ioss_over_limit");
    const none = decideTax({ ...f, rates: toRates([{ currency: "EUR", rate: 1, roundTo: 1 }]) }, { ...inEuro(10_000), currency: "NOK" });
    expect(none.decision).toMatchObject({ kind: "standard", reason: "ioss_no_rate" });
    expect(none.consignmentEurMinor).toBeNull();
  });

  it("does not mark a business buyer, an EU-dispatching seller, a market that is not listed, or a store without a number", () => {
    const f = facts(privateBuyer, ioss, "NO");
    expect(decideTax(facts({ business: true, buyerVatNumber: null, buyerCheck: null, buyerState: "none" }, ioss, "NO"), inEuro(5_000)).decision.kind).toBe("standard");
    expect(decideTax(facts(privateBuyer, { ...ioss, dispatchCountry: "SE" }, "NO"), inEuro(5_000)).decision.kind).toBe("standard");
    expect(decideTax({ ...f, deliveryCountry: "FR" }, inEuro(5_000)).decision.kind).toBe("standard");
    expect(decideTax(facts(privateBuyer, { ...ioss, iossNumber: null }, "NO"), inEuro(5_000)).decision.kind).toBe("standard");
  });

  it("does not mark a basket with a booking or a subscription", () => {
    const f = facts(privateBuyer, ioss, "NO");
    expect(decideTax(f, basket({ lines: [{ ...goods("0", 5_000), booking: true }], shippingMinor: 0 })).decision.kind).toBe("standard");
    expect(decideTax(f, basket({ lines: [{ ...goods("0", 5_000), recurring: true }], shippingMinor: 0 })).decision.kind).toBe("standard");
  });

  it("does not mark a basket of downloads alone, and says no import notice for it: a download is not a consignment", () => {
    const f = facts(privateBuyer, ioss, "NO");
    const only = decideTax(f, basket({ lines: [download("0", 5_950)], shippingMinor: 0 }));
    expect(only.decision).toMatchObject({ kind: "standard", reason: "consumer" });
    expect(only.treatment?.iossNumber).toBeNull();
    expect(only.importNotice).toBe(false);
    // a download of any value: nothing to put over a limit
    const big = decideTax(f, basket({ lines: [download("0", 500_000)], shippingMinor: 0 }));
    expect(big.decision.reason).toBe("consumer");
    expect(big.importNotice).toBe(false);
    // and without an IOSS number
    const bare = facts(privateBuyer, profile({ vatRegistered: false, vatNumber: null, vatNumberValid: null, dispatchCountry: "CN" }), "NO");
    expect(decideTax(bare, basket({ lines: [download("0", 5_950)], shippingMinor: 0 })).importNotice).toBe(false);
  });

  it("counts only the goods that are sent in the consignment's value: 100 EUR of parcel and a 60 EUR download are 100 EUR", () => {
    const f = facts(privateBuyer, ioss, "NO");
    // 119.00 EUR with 19 % VAT is 100.00 EUR without; 71.40 EUR is the download's 60.00
    const mixed = decideTax(f, basket({ lines: [goods("0", 11_900), download("1", 7_140)], shippingMinor: 0 }));
    expect(mixed.consignmentEurMinor).toBe(10_000);
    expect(mixed.decision).toMatchObject({ kind: "ioss", reason: "ioss" });
    // the parcel alone over the limit is over it, whatever the download is
    const over = decideTax(f, basket({ lines: [goods("0", 17_851), download("1", 100)], shippingMinor: 0 }));
    expect(over.decision.reason).toBe("ioss_over_limit");
    expect(over.importNotice).toBe(true);
  });

  it("says the import notice for goods from outside the EU that are not an IOSS sale, also without an IOSS number", () => {
    const f = facts(privateBuyer, profile({ vatRegistered: false, vatNumber: null, vatNumberValid: null, dispatchCountry: "CN" }), "NO");
    expect(decideTax(f, inEuro(5_000)).importNotice).toBe(true);
    expect(decideTax(facts(privateBuyer, ioss, "NO"), inEuro(5_000)).importNotice).toBe(false);
    expect(decideTax(facts(privateBuyer, profile(), "SE"), inEuro(5_000)).importNotice).toBe(false);
  });
});

describe("whether the VAT number field is offered (D157)", () => {
  const lines = { lines: [goods("0", 11_900)] };

  it("is offered to a business in an EU market that is not the seller's own", () => {
    expect(vatFieldFor(facts(), lines)).toEqual({ offered: true });
  });

  it("is not offered, and says why", () => {
    expect(vatFieldFor(facts({ business: false }), lines)).toEqual({ offered: false, reason: "private" });
    expect(vatFieldFor(facts({ deliveryInEu: false, deliveryCountry: "NO" }), lines)).toEqual({ offered: false, reason: "market_not_eu" });
    expect(vatFieldFor(facts({}, profile({ vatNumberValid: null })), lines)).toEqual({ offered: false, reason: "seller_not_ready" });
    expect(vatFieldFor(facts({ deliveryCountry: "SE" }), lines)).toEqual({ offered: false, reason: "domestic" });
    expect(vatFieldFor(facts(), { lines: [{ ...goods("0", 11_900), booking: true }] })).toEqual({ offered: false, reason: "has_service" });
    expect(vatFieldFor(facts(), { lines: [{ ...goods("0", 11_900), recurring: true }] })).toEqual({ offered: false, reason: "has_subscription" });
    expect(vatFieldFor(facts(), { lines: [{ ...goods("0", 11_900), host: true }] })).toEqual({ offered: false, reason: "host_order" });
    expect(vatFieldFor(facts({}, profile({ dispatchCountry: "CN" })), lines)).toEqual({ offered: false, reason: "dispatch_outside_eu" });
    expect(vatFieldFor(facts({}, profile({ dispatchCountry: "DE" })), lines)).toEqual({ offered: false, reason: "dispatch_domestic" });
  });

  it("is offered for downloads alone whatever the store sends goods from", () => {
    expect(vatFieldFor(facts({}, profile({ dispatchCountry: "CN" })), { lines: [download("0", 11_900)] })).toEqual({ offered: true });
  });

  it("is what the cart shows of the treatment, without VIES's name and address", () => {
    const b = basket();
    const shown = cartTaxOf(facts(), b, decideTax(facts(), b));
    expect(shown).toMatchObject({ kind: "reverse_charge", buyerVatNumber: DE_NUMBER, sellerVatNumber: SE_NUMBER, buyerState: "valid", field: { offered: true } });
    expect(JSON.stringify(shown)).not.toContain("KUNDE");
  });
});
