import { describe, expect, it } from "vitest";

import {
  cleanPostalCode,
  estimateDays,
  parseCheckoutSettings,
  pickupPointLine,
  readOrderDelivery,
  shopperPrice,
} from "./delivery-options";

const form = (entries: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
};

describe("postal codes", () => {
  it("are read as the country writes them", () => {
    expect(cleanPostalCode("NO", " 0150 ")).toBe("0150");
    expect(cleanPostalCode("NO", "015")).toBeNull();
    expect(cleanPostalCode("NO", "01500")).toBeNull();
    expect(cleanPostalCode("NO", "abcd")).toBeNull();
    expect(cleanPostalCode("SE", "114 55")).toBe("11455");
    expect(cleanPostalCode("DK", "1050")).toBe("1050");
  });
});

describe("what the shopper pays for a service", () => {
  it("is the carrier's price with VAT, then the percentage, then the fixed amount", () => {
    // 100 kr without VAT: 125 kr with VAT.
    expect(shopperPrice(10_000, 0.25, { percent: 0, minor: 0 })).toBe(12_500);
    // 10 % on the price with VAT, and 5 kr on top.
    expect(shopperPrice(10_000, 0.25, { percent: 10, minor: 500 })).toBe(14_250);
  });

  it("rounds to whole minor units", () => {
    expect(shopperPrice(3_333, 0.25, { percent: 0, minor: 0 })).toBe(4_166);
    expect(shopperPrice(1, 0.25, { percent: 50, minor: 0 })).toBe(2);
  });

  it("never goes below nothing and ignores negative markups", () => {
    expect(shopperPrice(0, 0.25, { percent: 0, minor: 0 })).toBe(0);
    expect(shopperPrice(1000, 0.25, { percent: -50, minor: -100 })).toBe(1250);
    expect(shopperPrice(1000, -1, { percent: 0, minor: 0 })).toBe(1000);
  });
});

describe("estimates", () => {
  it("are read only when they are numbers", () => {
    expect(estimateDays({ minDays: 1, maxDays: 3 })).toEqual({ min: 1, max: 3 });
    expect(estimateDays({ minDays: "1", maxDays: 3 })).toBeNull();
    expect(estimateDays(null)).toBeNull();
    expect(estimateDays({ from: "a", to: "b" })).toBeNull();
  });
});

describe("the delivery an order keeps", () => {
  it("is read back as written and nothing else", () => {
    const kept = {
      carrier: "bring",
      serviceId: "5800",
      label: "Pickup point",
      postalCode: "0150",
      pickupPoint: { id: "p1", name: "Kiosk", street: "Storgata 1", postalCode: "0150", city: "Oslo", extra: "x" },
      secret: "no",
    };
    expect(readOrderDelivery(kept)).toEqual({
      carrier: "bring",
      serviceId: "5800",
      label: "Pickup point",
      postalCode: "0150",
      pickupPoint: { id: "p1", name: "Kiosk", street: "Storgata 1", postalCode: "0150", city: "Oslo" },
    });
    expect(readOrderDelivery(null)).toBeNull();
    expect(readOrderDelivery({ carrier: "bring" })).toBeNull();
    expect(readOrderDelivery({ ...kept, pickupPoint: null })?.pickupPoint).toBeNull();
  });

  it("names its pickup point in a line", () => {
    expect(pickupPointLine({ name: "Kiosk", street: "Storgata 1", postalCode: "0150", city: "Oslo" })).toBe("Kiosk, Storgata 1, 0150 Oslo");
  });
});

describe("the store's checkout settings", () => {
  const known = ["5800", "5600", "3584"];

  it("accepts services, a markup, a free limit and a weight", () => {
    const parsed = parseCheckoutSettings(
      form({ enabled: "on", service: ["5800", "5600"], markupPercent: "10", markupAmount: "5,50", freeOver: "999", defaultWeight: "800" }),
      known,
    );
    expect(parsed).toEqual({
      ok: true,
      settings: { enabled: true, services: ["5800", "5600"], markup: { percent: 10, minor: 550 }, freeOverMinor: 99_900, defaultWeightGrams: 800, prices: {} },
    });
  });

  it("leaves out services the carrier does not have, and needs one when it is on", () => {
    const off = parseCheckoutSettings(form({ service: ["9999", "5800"], markupPercent: "0", defaultWeight: "1000" }), known);
    expect(off).toMatchObject({ ok: true, settings: { enabled: false, services: ["5800"], freeOverMinor: null } });
    const none = parseCheckoutSettings(form({ enabled: "on", service: ["9999"], markupPercent: "0", defaultWeight: "1000" }), known);
    expect(none).toMatchObject({ ok: false });
  });

  it("refuses amounts that are not amounts", () => {
    const bad = parseCheckoutSettings(
      form({ enabled: "on", service: "5800", markupPercent: "abc", markupAmount: "1.234", freeOver: "0", defaultWeight: "0" }),
      known,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toHaveLength(4);
  });
});

describe("settings for a carrier whose prices the store enters", () => {
  const options = { pricing: "store" as const, countries: ["NO", "SE"] };
  const known = ["17", "19", "18"];

  it("reads a price per country and service, and what is free above, in major units", () => {
    const parsed = parseCheckoutSettings(
      form({ enabled: "on", service: ["17", "19"], "price:NO:17": "49", "price:NO:19": "99,50", "freeOver:NO": "500", "price:SE:19": "89", "price:SE:18": "10", defaultWeight: "1000" }),
      known,
      options,
    );
    // A price for a service that is not ticked (18) is ignored; a country with no price is left out.
    expect(parsed).toEqual({
      ok: true,
      settings: {
        enabled: true,
        services: ["17", "19"],
        markup: { percent: 0, minor: 0 },
        freeOverMinor: null,
        defaultWeightGrams: 1000,
        prices: { NO: { freeOverMinor: 50_000, services: { "17": 4_900, "19": 9_950 } }, SE: { freeOverMinor: null, services: { "19": 8_900 } } },
      },
    });
  });

  it("needs a price somewhere when it is on, and refuses what is not an amount", () => {
    expect(parseCheckoutSettings(form({ enabled: "on", service: "17", defaultWeight: "1000" }), known, options)).toMatchObject({ ok: false });
    expect(parseCheckoutSettings(form({ service: "17", defaultWeight: "1000" }), known, options)).toMatchObject({ ok: true, settings: { enabled: false, prices: {} } });
    const bad = parseCheckoutSettings(form({ enabled: "on", service: "17", "price:NO:17": "free", "freeOver:NO": "0", defaultWeight: "1000" }), known, options);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems).toHaveLength(2);
  });
});
