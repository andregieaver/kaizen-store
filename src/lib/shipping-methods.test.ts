import { describe, expect, it } from "vitest";

import { basketShipping } from "./subscriptions";
import {
  basketValue,
  chosenFrom,
  defaultDelivery,
  deliveryOffer,
  methodPrice,
  partsOf,
  shippingWarnings,
  standardShippingMinor,
  tierFor,
  tierProblems,
  type BasketPart,
  type MethodRate,
  type MethodTerms,
  type OfferInput,
  type ShippingLine,
} from "./shipping-methods";

/** Kroner shown as kroner, and the euro view of a krone market: 1 NOK = 0.085 EUR, rounded to the cent (D109's `shown()`). */
const NOK = { conversion: { factor: 1, step: 1 } };
const EUR = { conversion: { factor: 0.085, step: 1 } };

const line = (o: Partial<ShippingLine> = {}): ShippingLine => ({
  profileId: null,
  quantity: 1,
  weightGrams: 1000,
  totalMinor: 10_000,
  physical: true,
  gift: false,
  recurring: false,
  ...o,
});

const rate = (o: Partial<MethodRate>): MethodRate => ({ zoneId: null, profileId: null, basis: "flat", minValue: 0, maxValue: null, amountMinor: 9900, ...o });

const method = (o: Partial<MethodTerms> = {}): MethodTerms => ({
  id: "m-standard",
  label: "Standard",
  position: 0,
  active: true,
  freeOverMinor: null,
  estimate: null,
  rates: [rate({})],
  ...o,
});

/** Weight tiers: 0–2 kg 79 kr, 2–10 kg 129 kr, 10 kg and above 249 kr. */
const byWeight = [
  rate({ basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 7900 }),
  rate({ basis: "weight", minValue: 2000, maxValue: 10_000, amountMinor: 12_900 }),
  rate({ basis: "weight", minValue: 10_000, maxValue: null, amountMinor: 24_900 }),
];
/** Value tiers: under 500 kr 99 kr, 500–1000 kr 49 kr, and no tier from 1000 kr (the method stops). */
const byValue = [rate({ basis: "value", minValue: 0, maxValue: 50_000, amountMinor: 9900 }), rate({ basis: "value", minValue: 50_000, maxValue: 100_000, amountMinor: 4900 })];

const part = (o: Partial<BasketPart> = {}): BasketPart => ({ profileId: null, weightGrams: 1000, valueMinor: 10_000, ...o });

describe("the basket's parts by profile (4.2 point 1)", () => {
  it("weigh and value the physical lines bought once, General first, gifts and subscriptions and downloads left out", () => {
    const parts = partsOf(
      [
        line({ profileId: "p-big", quantity: 2, weightGrams: 3000, totalMinor: 40_000 }),
        line({ quantity: 3, weightGrams: 200, totalMinor: 15_000 }),
        line({ physical: false, weightGrams: null, totalMinor: 9_000 }),
        line({ gift: true, totalMinor: 0 }),
        line({ recurring: true, totalMinor: 20_000 }),
        line({ profileId: "p-big", quantity: 1, weightGrams: 1000, totalMinor: 5_000 }),
      ],
      500,
    );
    expect(parts).toEqual([
      { profileId: null, weightGrams: 600, valueMinor: 15_000 },
      { profileId: "p-big", weightGrams: 7000, valueMinor: 45_000 },
    ]);
  });

  it("weigh a unit with no weight of its own at the store's default, per unit", () => {
    expect(partsOf([line({ quantity: 4, weightGrams: null })], 500)).toEqual([{ profileId: null, weightGrams: 2000, valueMinor: 10_000 }]);
    expect(partsOf([line({ quantity: 4, weightGrams: 0 })], 750)[0].weightGrams).toBe(3000);
    expect(partsOf([line({ quantity: 1, weightGrams: null }), line({ quantity: 2, weightGrams: 300 })], 500)[0].weightGrams).toBe(1100);
  });

  it("are none when nothing is shipped", () => {
    expect(partsOf([line({ physical: false })], 500)).toEqual([]);
  });

  it("leave the basket's whole value as basketShipping() judges free shipping on: every line but the gifts", () => {
    expect(basketValue([line({ totalMinor: 100 }), line({ physical: false, totalMinor: 50 }), line({ gift: true, totalMinor: 999 })])).toBe(150);
  });
});

describe("the tier that matches (4.2 point 3)", () => {
  it("takes the minimum inclusive and the maximum exclusive, the last tier open", () => {
    expect(tierFor(byWeight, part({ weightGrams: 0 }), NOK)?.amountMinor).toBe(7900);
    expect(tierFor(byWeight, part({ weightGrams: 1999 }), NOK)?.amountMinor).toBe(7900);
    expect(tierFor(byWeight, part({ weightGrams: 2000 }), NOK)?.amountMinor).toBe(12_900);
    expect(tierFor(byWeight, part({ weightGrams: 9999 }), NOK)?.amountMinor).toBe(12_900);
    expect(tierFor(byWeight, part({ weightGrams: 10_000 }), NOK)?.amountMinor).toBe(24_900);
    expect(tierFor(byWeight, part({ weightGrams: 900_000 }), NOK)?.amountMinor).toBe(24_900);
  });

  it("finds none above the last tier with a maximum", () => {
    expect(tierFor(byValue, part({ valueMinor: 99_999 }), NOK)?.amountMinor).toBe(4900);
    expect(tierFor(byValue, part({ valueMinor: 100_000 }), NOK)).toBeNull();
  });

  it("compares a value tier's bounds as shown, each converted on its own, and never converts a weight", () => {
    // 500 kr is 42.50 EUR shown (4250 cents): a part of 42.49 EUR is in the first tier, one of 42.50 in the second.
    expect(tierFor(byValue, part({ valueMinor: 4249 }), EUR)?.amountMinor).toBe(9900);
    expect(tierFor(byValue, part({ valueMinor: 4250 }), EUR)?.amountMinor).toBe(4900);
    expect(tierFor(byWeight, part({ weightGrams: 2000 }), EUR)?.amountMinor).toBe(12_900);
  });

  it("is the one row of a flat group", () => {
    expect(tierFor([rate({ amountMinor: 5900 })], part({ weightGrams: 123_456 }), NOK)?.amountMinor).toBe(5900);
    expect(tierFor([], part(), NOK)).toBeNull();
  });
});

describe("a method's price (4.2)", () => {
  it("is the matching tier for a basket of one profile, and not offered when no tier matches", () => {
    const m = method({ rates: byWeight });
    expect(methodPrice(m, [part({ weightGrams: 2500 })], null, NOK, 10_000)?.priceMinor).toBe(12_900);
    expect(methodPrice(method({ rates: byValue }), [part({ valueMinor: 150_000 })], null, NOK, 150_000)).toBeNull();
  });

  it("is the sum of the profiles' tiers for a mixed basket, and not offered when one profile has no rate in the zone", () => {
    const m = method({ rates: [...byWeight, rate({ profileId: "p-big", amountMinor: 49_900 })] });
    const parts = [part({ weightGrams: 500 }), part({ profileId: "p-big", weightGrams: 40_000 })];
    expect(methodPrice(m, parts, null, NOK, 50_000)).toMatchObject({ priceMinor: 7900 + 49_900, rate: { amountMinor: 57_800, freeOverMinor: null } });
    expect(methodPrice(method({ rates: byWeight }), parts, null, NOK, 50_000)).toBeNull();
  });

  it("in the euro view is the sum of what each part shows (each converted, then added)", () => {
    const m = method({ rates: [rate({ amountMinor: 7900 }), rate({ profileId: "p-big", amountMinor: 4900 })] });
    const parts = [part(), part({ profileId: "p-big" })];
    // 79 kr = 6.715 → 6.72 EUR, 49 kr = 4.165 → 4.17 EUR: 10.89, where 128 kr converted at once would be 10.88.
    expect(methodPrice(m, parts, null, EUR, 1000)?.priceMinor).toBe(672 + 417);
  });

  it("uses only the zone's own rates: a zone with no row for the method is not offered, Rest of country is zone null", () => {
    const m = method({ rates: [rate({ amountMinor: 9900 }), rate({ zoneId: "z-north", amountMinor: 19_900 })] });
    expect(methodPrice(m, [part()], "z-north", NOK, 10_000)?.priceMinor).toBe(19_900);
    expect(methodPrice(m, [part()], null, NOK, 10_000)?.priceMinor).toBe(9900);
    expect(methodPrice(m, [part()], "z-oslo", NOK, 10_000)).toBeNull();
  });

  it("is free when the whole basket's value reaches its free-above, as shown, and the rate it hands to basketShipping() says so", () => {
    const m = method({ freeOverMinor: 100_000 });
    expect(methodPrice(m, [part()], null, NOK, 99_999)?.priceMinor).toBe(9900);
    expect(methodPrice(m, [part()], null, NOK, 100_000)?.priceMinor).toBe(0);
    // 1000 kr shown is 85.00 EUR.
    expect(methodPrice(m, [part()], null, EUR, 8499)?.priceMinor).toBe(842);
    expect(methodPrice(m, [part()], null, EUR, 8500)).toMatchObject({ priceMinor: 0, rate: { amountMinor: 842, freeOverMinor: 8500 } });
  });

  it("agrees with basketShipping() over the same lines and rate (what cartSummary() and placeOrder() charge)", () => {
    const lines = [line({ totalMinor: 60_000, weightGrams: 1500 }), line({ physical: false, totalMinor: 45_000, weightGrams: null })];
    const m = method({ rates: byWeight, freeOverMinor: 100_000 });
    const price = methodPrice(m, partsOf(lines, 500), null, NOK, basketValue(lines))!;
    expect(price.priceMinor).toBe(0);
    expect(basketShipping(lines.map((l) => ({ totalMinor: l.totalMinor, delivery: l.physical ? "physical" : "digital", recurring: false })), price.rate).first).toBe(0);
    const fewer = [line({ totalMinor: 60_000, weightGrams: 1500 })];
    const p2 = methodPrice(m, partsOf(fewer, 500), null, NOK, basketValue(fewer))!;
    expect(basketShipping([{ totalMinor: 60_000, delivery: "physical", recurring: false }], p2.rate).first).toBe(p2.priceMinor);
    expect(p2.priceMinor).toBe(7900);
  });

  it("is not offered when the method is off or nothing is shipped", () => {
    expect(methodPrice(method({ active: false }), [part()], null, NOK, 1)).toBeNull();
    expect(methodPrice(method(), [], null, NOK, 1)).toBeNull();
  });
});

describe("what a basket is offered (4.1)", () => {
  const base = (o: Partial<OfferInput> = {}): OfferInput => ({
    physical: true,
    subscription: false,
    view: NOK,
    flat: { amountMinor: 6900, freeOverMinor: null },
    methods: [],
    parts: [part()],
    basketValueMinor: 10_000,
    zoneId: null,
    ...o,
  });

  it("is nothing when nothing is shipped", () => {
    expect(deliveryOffer(base({ physical: false }))).toMatchObject({ status: "none", ship: [], default: null });
  });

  it("is the flat rate alone with a subscription, and no_shipping without one", () => {
    const offer = deliveryOffer(base({ subscription: true, methods: [method()], pickups: [{ id: "p1", locationId: "l1", amountMinor: 0, readyInHours: 0, position: 0, active: true }] }));
    expect(offer.ship.map((d) => d.kind)).toEqual(["flat"]);
    expect(offer.pickups).toEqual([]);
    expect(deliveryOffer(base({ subscription: true, flat: null })).status).toBe("no_shipping");
  });

  it("is the flat rate exactly as today for a market with no method", () => {
    const offer = deliveryOffer(base());
    expect(offer.ship).toEqual([{ kind: "flat", id: "flat", rate: { amountMinor: 6900, freeOverMinor: null }, priceMinor: 6900 }]);
    expect(defaultDelivery(offer)?.kind).toBe("flat");
  });

  it("is the methods that price the basket, cheapest first (then by position), with the cheapest the default; the flat rate is not offered beside them", () => {
    const express = method({ id: "m-express", label: "Express", position: 1, rates: [rate({ amountMinor: 19_900 })] });
    const standard = method({ id: "m-standard", position: 2, rates: byWeight });
    const tie = method({ id: "m-tie", position: 0, rates: [rate({ amountMinor: 7900 })] });
    const offer = deliveryOffer(base({ methods: [express, standard, tie] }));
    expect(offer.ship.map((d) => [d.id, d.priceMinor])).toEqual([["m-tie", 7900], ["m-standard", 7900], ["m-express", 19_900]]);
    expect(offer.default?.id).toBe("m-tie");
  });

  it("falls to the flat rate when no method prices the basket, and is no_shipping when there is none either", () => {
    const heavy = [part({ valueMinor: 200_000 })];
    expect(deliveryOffer(base({ methods: [method({ rates: byValue })], parts: heavy })).ship.map((d) => d.kind)).toEqual(["flat"]);
    const none = deliveryOffer(base({ methods: [method({ rates: byValue })], parts: heavy, flat: null }));
    expect(none).toMatchObject({ status: "no_shipping", ship: [], default: null });
  });

  it("offers pickup places (active ones, never the default) and the cheapest local area that covers the code, still with no_shipping", () => {
    const offer = deliveryOffer(
      base({
        flat: null,
        methods: [],
        pickups: [
          { id: "p-shop", locationId: "l-shop", amountMinor: 0, readyInHours: 24, position: 1, active: true },
          { id: "p-off", locationId: "l-off", amountMinor: 0, readyInHours: 0, position: 0, active: false },
          { id: "p-depot", locationId: "l-depot", amountMinor: 2900, readyInHours: 0, position: 0, active: true },
        ],
        areas: [
          { id: "a-city", kind: "postal", patterns: ["01*"], radiusKm: null, origin: null, amountMinor: 9900, minBasketMinor: null, freeOverMinor: null, position: 0, active: true },
          { id: "a-near", kind: "postal", patterns: ["0150"], radiusKm: null, origin: null, amountMinor: 4900, minBasketMinor: null, freeOverMinor: null, position: 1, active: true },
        ],
        postalCode: "0150",
      }),
    );
    expect(offer.status).toBe("no_shipping");
    expect(offer.pickups.map((p) => [p.id, p.priceMinor])).toEqual([["p-shop", 0], ["p-depot", 2900]]);
    expect(offer.local).toMatchObject({ kind: "local", id: "a-near", priceMinor: 4900 });
    expect(offer.default).toBeNull();
  });

  it("prices a pickup place in the currency shown", () => {
    const offer = deliveryOffer(base({ view: EUR, pickups: [{ id: "p", locationId: "l", amountMinor: 2900, readyInHours: 0, position: 0, active: true }] }));
    expect(offer.pickups[0]).toMatchObject({ priceMinor: 247, rate: { amountMinor: 247, freeOverMinor: null } });
    expect(offer.ship[0]).toMatchObject({ kind: "flat", priceMinor: 587 });
  });
});

describe("the delivery a cart's choice comes to (4.1 point 5)", () => {
  const offer = deliveryOffer({
    physical: true,
    subscription: false,
    view: NOK,
    flat: null,
    methods: [method({ id: "m-a", rates: [rate({ amountMinor: 4900 })] }), method({ id: "m-b", position: 1, rates: [rate({ amountMinor: 9900 })] })],
    parts: [part()],
    basketValueMinor: 10_000,
    zoneId: null,
    pickups: [{ id: "p-shop", locationId: "l", amountMinor: 0, readyInHours: 0, position: 0, active: true }],
  });

  it("is the chosen one while the offer still has it", () => {
    expect(chosenFrom(offer, { kind: "method", id: "m-b" })).toEqual({ delivery: offer.ship[1], changed: false });
    expect(chosenFrom(offer, { kind: "pickup", id: "p-shop" }).delivery?.kind).toBe("pickup");
  });

  it("is the default and a change when the choice is gone, and the default without a change when nothing was chosen", () => {
    expect(chosenFrom(offer, { kind: "method", id: "m-gone" })).toEqual({ delivery: offer.ship[0], changed: true });
    expect(chosenFrom(offer, { kind: "local", id: "a-x" })).toEqual({ delivery: offer.ship[0], changed: true });
    expect(chosenFrom(offer, { kind: "pickup", id: "m-a" }).changed).toBe(true);
    expect(chosenFrom(offer, null)).toEqual({ delivery: offer.ship[0], changed: false });
  });
});

describe("the cheapest standard delivery kept on the order (4.3)", () => {
  it("is the lowest of the methods offered, after free-above; a flat rate not offered, pickup and local delivery do not count", () => {
    const flat = { amountMinor: 6900, freeOverMinor: null };
    const offer = deliveryOffer({
      physical: true,
      subscription: false,
      view: NOK,
      flat,
      methods: [method({ id: "m-a", rates: [rate({ amountMinor: 9900 })] }), method({ id: "m-b", rates: [rate({ amountMinor: 4900 })] })],
      parts: [part()],
      basketValueMinor: 10_000,
      zoneId: null,
      pickups: [{ id: "p", locationId: "l", amountMinor: 0, readyInHours: 0, position: 0, active: true }],
    });
    expect(standardShippingMinor(offer)).toBe(4900);
    // A cheaper flat rate kept as the fallback is not offered while the methods price the basket (review: CRD Art. 13(2), "offered").
    const cheaperFlat = deliveryOffer({
      physical: true,
      subscription: false,
      view: NOK,
      flat: { amountMinor: 3900, freeOverMinor: null },
      methods: [method({ id: "m-a", rates: [rate({ amountMinor: 9900 })] }), method({ id: "m-b", rates: [rate({ amountMinor: 4900 })] })],
      parts: [part()],
      basketValueMinor: 10_000,
      zoneId: null,
    });
    expect(standardShippingMinor(cheaperFlat)).toBe(4900);
    expect(standardShippingMinor({ ...offer, ship: [] })).toBeNull();
  });

  it("is in the currency shown", () => {
    const flat = { amountMinor: 6900, freeOverMinor: 50_000 };
    const offer = deliveryOffer({ physical: true, subscription: false, view: EUR, flat, methods: [], parts: [part()], basketValueMinor: 1000, zoneId: null });
    expect(standardShippingMinor(offer)).toBe(587);
    const free = deliveryOffer({ physical: true, subscription: false, view: EUR, flat, methods: [], parts: [part()], basketValueMinor: 4250, zoneId: null });
    expect(standardShippingMinor(free)).toBe(0);
  });
});

describe("the editor's check of a group's tiers (as the database's)", () => {
  const tier = (basis: "flat" | "weight" | "value", minValue: number, maxValue: number | null, amountMinor = 100) => ({ basis, minValue, maxValue, amountMinor });

  it("accepts nothing (Not offered), one flat price, and tiers from 0 that meet with the last open or closed", () => {
    expect(tierProblems([])).toEqual([]);
    expect(tierProblems([tier("flat", 0, null)])).toEqual([]);
    expect(tierProblems([tier("weight", 0, 2000), tier("weight", 2000, null)])).toEqual([]);
    expect(tierProblems([tier("value", 2000, 5000), tier("value", 0, 2000)])).toEqual([]);
    expect(tierProblems([tier("value", 0, 5000)])).toEqual([]);
  });

  it("refuses a gap, an overlap, a tier after an open one, two flat prices, mixed measures and a flat price with bounds", () => {
    expect(tierProblems([tier("weight", 0, 2000), tier("weight", 2001, null)])).toEqual(["gap"]);
    expect(tierProblems([tier("weight", 100, null)])).toEqual(["gap"]);
    expect(tierProblems([tier("weight", 0, 2000), tier("weight", 1999, null)])).toEqual(["overlap"]);
    expect(tierProblems([tier("weight", 0, null), tier("weight", 2000, 3000)])).toEqual(["overlap"]);
    expect(tierProblems([tier("flat", 0, null), tier("flat", 0, null)])).toEqual(["two_flat"]);
    expect(tierProblems([tier("flat", 0, null), tier("weight", 0, null)])).toContain("mixed_basis");
    expect(tierProblems([tier("flat", 10, null)])).toEqual(["flat_range"]);
    expect(tierProblems([tier("weight", 0, 0)])).toContain("empty_range");
    expect(tierProblems([tier("weight", 0, null, -1)])).toEqual(["negative"]);
    expect(tierProblems(Array.from({ length: 11 }, (_, i) => tier("weight", i * 10, i === 10 ? null : (i + 1) * 10)))).toEqual(["too_many"]);
  });
});

describe("the Shipping page's warnings", () => {
  const flatRest = [{ active: true, rates: [{ zoneId: null, basis: "flat" as const }] }];

  it("says what cannot be served, and nothing when all is well", () => {
    expect(shippingWarnings([{ marketCode: "NO", hasFlat: true, zones: 0, methods: flatRest }], { recurringOn: true, variantsWithoutWeight: 3 })).toEqual([]);
    expect(
      shippingWarnings(
        [
          { marketCode: "NO", hasFlat: false, zones: 2, methods: [{ active: true, rates: [{ zoneId: "z", basis: "weight" }] }, { active: false, rates: [{ zoneId: null, basis: "flat" }] }] },
          { marketCode: "SE", hasFlat: false, zones: 0, methods: [] },
        ],
        { recurringOn: true, variantsWithoutWeight: 4 },
      ),
    ).toEqual([
      { code: "no_flat_with_methods", marketCode: "NO" },
      { code: "zones_without_rest", marketCode: "NO" },
      { code: "subscriptions_need_flat", marketCode: "NO" },
      { code: "subscriptions_need_flat", marketCode: "SE" },
      { code: "default_weight_used", variants: 4 },
    ]);
  });
});
