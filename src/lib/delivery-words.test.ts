import { describe, expect, it } from "vitest";

import type { DeliveryOption } from "./delivery-options";
import { deliveryRowLabel, priceLaterFrom, readyInText, todayHoursText, withDeliveryWords, type PriceLaterFacts } from "./delivery-words";
import { t } from "./i18n";
import { defaultHours } from "./opening-hours";

const en = t("en");
const nb = t("nb");

describe("deliveryRowLabel (D237)", () => {
  it("names a pickup place, a local area, a method or carrier, and falls back to Shipping", () => {
    expect(deliveryRowLabel(null, en)).toBe("Shipping");
    expect(
      deliveryRowLabel(
        { kind: "pickup", label: "Shop Oslo", locationId: "l1", name: "Shop Oslo", street: "", postalCode: "", city: "", country: "NO", hours: null, instructions: "", readyInHours: 0 },
        en,
      ),
    ).toBe("Collect at Shop Oslo");
    expect(deliveryRowLabel({ kind: "local", label: "Oslo centre", areaId: "a1", name: "Oslo centre", postalCode: "0150", info: "" }, nb)).toBe("Lokal levering: Oslo centre");
    expect(deliveryRowLabel({ kind: "method", methodId: "m1", label: "Express", zone: null, postalCode: null, estimate: null }, en)).toBe("Express");
    expect(deliveryRowLabel({ kind: "flat", label: "Frakt", postalCode: null }, nb)).toBe("Frakt");
  });
});

describe("readyInText", () => {
  it("promises nothing for 0, hours under two days, else days rounded up, in each language", () => {
    expect(readyInText(0, en)).toBe(en.deliveryOptions.readyNotify);
    expect(readyInText(1, en)).toBe("Usually ready in 1 hour.");
    expect(readyInText(4, en)).toBe("Usually ready in 4 hours.");
    expect(readyInText(49, en)).toBe("Usually ready in 3 days.");
    expect(readyInText(24, nb)).toBe("Vanligvis klar om 24 timer.");
    expect(readyInText(24, t("sv"))).toBe("Brukar vara klar inom 24 timmar.");
    expect(readyInText(72, t("da"))).toBe("Normalt klar inden for 3 dage.");
  });
});

describe("todayHoursText", () => {
  const hours = defaultHours();
  it("says today's hours in the store's time zone, or closed, or nothing without hours", () => {
    // 2026-10-14 is a Wednesday; the default week is open on weekdays.
    const wednesday = new Date("2026-10-14T10:00:00Z");
    const open = todayHoursText(hours, en, { locale: "en", timeZone: "Europe/Oslo", now: wednesday });
    expect(open).toMatch(/^Open today \d\d:\d\d–\d\d:\d\d$/);
    const sunday = new Date("2026-10-18T10:00:00Z");
    expect(todayHoursText(hours, en, { locale: "en", timeZone: "Europe/Oslo", now: sunday })).toBe("Closed today");
    expect(todayHoursText(null, en, { locale: "en", timeZone: "Europe/Oslo" })).toBeNull();
  });
});

describe("withDeliveryWords", () => {
  it("gives only pickup places their sentences", () => {
    const base: DeliveryOption = {
      id: "flat",
      kind: "flat",
      carrier: "flat",
      label: "Shipping",
      priceMinor: 9900,
      freeOverMinor: null,
      estimate: null,
      needsPickupPoint: false,
      window: null,
      pickupPoints: [],
      pickupPointId: null,
      selected: true,
    };
    const pickup: DeliveryOption = {
      ...base,
      id: "pickup:p1",
      kind: "pickup",
      selected: false,
      priceMinor: 0,
      place: { name: "Shop", street: "Gate 1", postalCode: "0150", city: "Oslo", country: "NO", hours: null, readyInHours: 2, instructions: "" },
    };
    const shown = withDeliveryWords({ postalCode: null, options: [base, pickup] }, en, { locale: "en", timeZone: "Europe/Oslo" });
    expect(shown.options[0].words).toBeUndefined();
    expect(shown.options[1].words).toEqual({ ready: "Usually ready in 2 hours.", today: null });
  });
});

describe("priceLaterFrom (2.4, CRD Art. 6(1)(e))", () => {
  const facts = (over: Partial<PriceLaterFacts> = {}): PriceLaterFacts => ({
    postalCode: null,
    method: "ship",
    shipping: { zones: [{}], areas: [], pickups: [] },
    offer: { ship: [{ priceMinor: 9900 }, { priceMinor: 14900 }], pickups: [] },
    ...over,
  });
  it("is the lowest on offer while a zone, an area or a pickup place makes the price wait for the shopper", () => {
    expect(priceLaterFrom(facts(), 9900)).toBe(9900);
    expect(priceLaterFrom(facts({ shipping: { zones: [], areas: [], pickups: [{}] }, offer: { ship: [{ priceMinor: 9900 }], pickups: [{ priceMinor: 0 }] } }), 9900)).toBe(0);
  });
  it("is null once a code is given, with pickup chosen, without zones, areas or places, or with nothing to read", () => {
    expect(priceLaterFrom(facts({ postalCode: "0150" }), 9900)).toBeNull();
    expect(priceLaterFrom(facts({ method: "pickup" }), 0)).toBeNull();
    expect(priceLaterFrom(facts({ shipping: { zones: [], areas: [], pickups: [] } }), 9900)).toBeNull();
    expect(priceLaterFrom(null, 9900)).toBeNull();
  });
});
