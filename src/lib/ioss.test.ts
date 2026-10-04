import { describe, expect, it } from "vitest";

import { toRates, type Rates } from "./currency";
import {
  IOSS_LIMIT_EUR_MINOR,
  consignmentEurMinor,
  goodsWithoutVat,
  iossOutcome,
  normaliseIossNumber,
  normaliseOssNumber,
  showImportNotice,
  type IossFacts,
} from "./ioss";

const rates: Rates = toRates([
  { currency: "NOK", rate: 11.5, roundTo: 1 },
  { currency: "SEK", rate: 11, roundTo: 1 },
  { currency: "DKK", rate: 7.46, roundTo: 1 },
  { currency: "PLN", rate: null, roundTo: 1 },
  { currency: "HUF", rate: 400, roundTo: 100 },
]);

const facts = (over: Partial<IossFacts> = {}): IossFacts => ({
  number: "IM1234567890",
  markets: ["DE", "FR"],
  deliveryCountry: "DE",
  deliveryInEu: true,
  dispatchInEu: false,
  goodsOnly: true,
  consignmentEurMinor: 10_000,
  ...over,
});

describe("the numbers", () => {
  it("normalises an IOSS number", () => {
    expect(normaliseIossNumber("im 123 456 7890")).toBe("IM1234567890");
    expect(normaliseIossNumber("IM123456789")).toBeNull();
    expect(normaliseIossNumber("IM12345678901")).toBeNull();
    expect(normaliseIossNumber("EU123456789")).toBeNull();
  });

  it("normalises a non-Union OSS number", () => {
    expect(normaliseOssNumber("eu 123456789")).toBe("EU123456789");
    expect(normaliseOssNumber("EU12345678")).toBeNull();
    expect(normaliseOssNumber("IM1234567890")).toBeNull();
  });
});

describe("the value of a consignment in euro", () => {
  it("is the amount itself in euro", () => {
    expect(consignmentEurMinor(15_000, "EUR", rates)).toBe(15_000);
    expect(consignmentEurMinor(0, "EUR", rates)).toBe(0);
  });

  it("converts at the store's rate (units per euro), without the rounding step, a euro cent at a time", () => {
    // 1725 NOK = 150.00 EUR at 11.5
    expect(consignmentEurMinor(172_500, "NOK", rates)).toBe(15_000);
    // one øre more is more than a cent over the limit's border: 150.01
    expect(consignmentEurMinor(172_512, "NOK", rates)).toBe(15_002);
    expect(consignmentEurMinor(110_000, "SEK", rates)).toBe(10_000);
  });

  it("rounds up, so the border is never taken to be inside", () => {
    // 1 NOK minor unit = 0.0869 euro cents
    expect(consignmentEurMinor(1, "NOK", rates)).toBe(1);
    expect(consignmentEurMinor(172_501, "NOK", rates)).toBe(15_001);
  });

  it("handles a currency with a different number of decimals", () => {
    // 60 000 HUF (no decimals shown, 2 minor digits) at 400 per euro = 150 EUR
    expect(consignmentEurMinor(6_000_000, "HUF", rates)).toBe(15_000);
  });

  it("is null for a currency with no rate and for nonsense", () => {
    expect(consignmentEurMinor(1000, "PLN", rates)).toBeNull();
    expect(consignmentEurMinor(1000, "GBP", rates)).toBeNull();
    expect(consignmentEurMinor(-1, "EUR", rates)).toBeNull();
    expect(consignmentEurMinor(Number.NaN, "EUR", rates)).toBeNull();
  });

  it("is the goods without VAT and without shipping", () => {
    expect(
      goodsWithoutVat([
        { totalMinor: 12_500, taxMinor: 2_500 },
        { totalMinor: 6_000, taxMinor: 1_000 },
      ]),
    ).toBe(15_000);
    expect(goodsWithoutVat([])).toBe(0);
  });
});

describe("whether an order is an IOSS sale", () => {
  it("is exactly 150.00 EUR inside the limit and 150.01 outside", () => {
    expect(IOSS_LIMIT_EUR_MINOR).toBe(15_000);
    expect(iossOutcome(facts({ consignmentEurMinor: 15_000 }))).toBe("applies");
    expect(iossOutcome(facts({ consignmentEurMinor: 15_001 }))).toBe("over_limit");
    expect(iossOutcome(facts({ consignmentEurMinor: 0 }))).toBe("applies");
  });

  it("needs a euro value: no rate is not a guess", () => {
    expect(iossOutcome(facts({ consignmentEurMinor: null }))).toBe("no_rate");
  });

  it("is not in question without a valid number", () => {
    expect(iossOutcome(facts({ number: null }))).toBe("no");
    expect(iossOutcome(facts({ number: "IM123" }))).toBe("no");
    expect(iossOutcome(facts({ number: "" }))).toBe("no");
  });

  it("is not in question for a market the registration does not cover or outside the EU", () => {
    expect(iossOutcome(facts({ deliveryCountry: "SE" }))).toBe("no");
    expect(iossOutcome(facts({ deliveryCountry: "NO", deliveryInEu: false, markets: ["NO"] }))).toBe("no");
    expect(iossOutcome(facts({ markets: [] }))).toBe("no");
  });

  it("is not in question for goods sent from inside the EU or a basket with more than goods", () => {
    expect(iossOutcome(facts({ dispatchInEu: true }))).toBe("no");
    expect(iossOutcome(facts({ goodsOnly: false }))).toBe("no");
  });

  it("says the same over the limit as without a rate only when everything else holds", () => {
    expect(iossOutcome(facts({ consignmentEurMinor: 99_999, markets: [] }))).toBe("no");
    expect(iossOutcome(facts({ consignmentEurMinor: null, dispatchInEu: true }))).toBe("no");
  });
});

describe("the import notice", () => {
  it("is for goods sent from outside the EU into it that are not an IOSS sale", () => {
    const base = { deliveryInEu: true, dispatchInEu: false, goodsOnly: true };
    expect(showImportNotice({ ...base, outcome: "no" })).toBe(true);
    expect(showImportNotice({ ...base, outcome: "over_limit" })).toBe(true);
    expect(showImportNotice({ ...base, outcome: "no_rate" })).toBe(true);
    expect(showImportNotice({ ...base, outcome: "applies" })).toBe(false);
    expect(showImportNotice({ ...base, dispatchInEu: true, outcome: "no" })).toBe(false);
    expect(showImportNotice({ ...base, deliveryInEu: false, outcome: "no" })).toBe(false);
    expect(showImportNotice({ ...base, goodsOnly: false, outcome: "no" })).toBe(false);
  });
});
