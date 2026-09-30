import { describe, expect, it } from "vitest";

import { carrierComplete, carrierInfo, CARRIER_IDS, CARRIERS, isCarrierId, parseCarrierForm, secretHint } from "./shipping-carriers";

const bring = carrierInfo("bring")!;
const none = { hasSecret: () => false };

describe("the carriers", () => {
  it("are the four the store will be able to connect", () => {
    expect(CARRIER_IDS).toEqual(["bring", "postnord", "porterbuddy", "helthjem"]);
    expect(CARRIERS.map((c) => c.id)).toEqual(CARRIER_IDS);
    expect(isCarrierId("dhl")).toBe(false);
  });

  it("each need an API key that is secret, and say what they will do", () => {
    for (const carrier of CARRIERS) {
      expect(carrier.fields.some((f) => f.key === "apiKey" && f.secret && f.required)).toBe(true);
      expect(carrier.features).toContain("rates");
      expect(carrier.countries.length).toBeGreaterThan(0);
      expect(carrier.steps.length).toBeGreaterThan(1);
    }
    expect(carrierInfo("porterbuddy")!.features).toContain("same_day");
  });
});

describe("parseCarrierForm", () => {
  const good = { environment: "test", countries: ["no", "SE", "no", "x1"], fields: { customerNumber: " 123 ", apiUid: "me@shop.no", apiKey: "secret-key-1234" } };

  it("splits details from secrets, tidies the countries and keeps the environment", () => {
    const parsed = parseCarrierForm(bring, good, none);
    expect(parsed).toEqual({
      ok: true,
      environment: "test",
      countries: ["NO", "SE"],
      details: { customerNumber: "123", apiUid: "me@shop.no" },
      secrets: { apiKey: "secret-key-1234" },
    });
  });

  it("keeps a saved secret when the field is left empty, and asks for one that is not saved", () => {
    const left = { ...good, fields: { ...good.fields, apiKey: "" } };
    expect(parseCarrierForm(bring, left, { hasSecret: (k) => k === "apiKey" }).ok).toBe(true);
    const parsed = parseCarrierForm(bring, left, none);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problems).toEqual(["Enter the mybring api key."]);
  });

  it("asks for every missing detail and a known environment", () => {
    const parsed = parseCarrierForm(bring, { environment: "staging", countries: [], fields: {} }, { hasSecret: () => true });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.problems).toContain("Choose test or live.");
    expect(!parsed.ok && parsed.problems).toContain("Enter the customer number.");
  });

  it("ignores fields the carrier does not have and refuses very long ones", () => {
    const parsed = parseCarrierForm(bring, { ...good, fields: { ...good.fields, other: "x", apiUid: "u".repeat(201) } }, none);
    expect(parsed.ok).toBe(false);
    const fine = parseCarrierForm(bring, { ...good, fields: { ...good.fields, other: "x" } }, none);
    expect(fine.ok && Object.keys(fine.details)).toEqual(["customerNumber", "apiUid"]);
  });
});

describe("carrierComplete and secretHint", () => {
  it("is complete when every required detail and secret is saved", () => {
    expect(carrierComplete(bring, { customerNumber: "1", apiUid: "u" }, ["apiKey"])).toBe(true);
    expect(carrierComplete(bring, { customerNumber: "1" }, ["apiKey"])).toBe(false);
    expect(carrierComplete(bring, { customerNumber: "1", apiUid: "u" }, [])).toBe(false);
    // Porterbuddy's secret is optional.
    expect(carrierComplete(carrierInfo("porterbuddy")!, {}, ["apiKey"])).toBe(true);
  });

  it("shows only the last four characters of a long secret", () => {
    expect(secretHint("abcdefghijkl")).toBe("…ijkl");
    expect(secretHint("short")).toBe("…");
  });
});
