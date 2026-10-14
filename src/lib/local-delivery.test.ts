import { describe, expect, it } from "vitest";

import { areaCovers, areaFor, codesWithin, distanceKm, type AreaTerms, type GeoPoint } from "./local-delivery";

const NOK = { conversion: { factor: 1, step: 1 } };
const EUR = { conversion: { factor: 0.085, step: 1 } };

/** Postal-code centres as `postal_points` holds them (GeoNames): Oslo 0150, Bergen 5003, Copenhagen 1050, Stockholm 11120. */
const OSLO: GeoPoint = { lat: 59.9127, lon: 10.7461 };
const BERGEN: GeoPoint = { lat: 60.393, lon: 5.3242 };
const COPENHAGEN: GeoPoint = { lat: 55.6806, lon: 12.5857 };
const STOCKHOLM: GeoPoint = { lat: 59.3326, lon: 18.0649 };
/** About 20 km north-east of Oslo's centre (Lillestrøm). */
const LILLESTROM: GeoPoint = { lat: 59.9559, lon: 11.0504 };

const area = (o: Partial<AreaTerms>): AreaTerms => ({
  id: "a",
  kind: "postal",
  patterns: [],
  radiusKm: null,
  origin: null,
  amountMinor: 9900,
  minBasketMinor: null,
  freeOverMinor: null,
  position: 0,
  active: true,
  ...o,
});

describe("the distance between two postal-code centres", () => {
  it("is the haversine distance on the earth's mean radius", () => {
    // One degree of longitude on the equator is 2πR / 360.
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo((2 * Math.PI * 6371.0088) / 360, 6);
    // Oslo to Bergen is about 305 km in a straight line, Copenhagen to Stockholm about 521 km.
    expect(distanceKm(OSLO, BERGEN)).toBeCloseTo(304.67, 1);
    expect(distanceKm(COPENHAGEN, STOCKHOLM)).toBeCloseTo(521.21, 1);
    expect(distanceKm(OSLO, OSLO)).toBe(0);
    expect(distanceKm(BERGEN, OSLO)).toBeCloseTo(distanceKm(OSLO, BERGEN), 9);
  });
});

describe("whether an area covers a postal code", () => {
  it("by postal codes: a code or a prefix matches", () => {
    const city = area({ patterns: ["01*", "0250"] });
    expect(areaCovers(city, "0150", null)).toBe(true);
    expect(areaCovers(city, "0250", null)).toBe(true);
    expect(areaCovers(city, "0251", null)).toBe(false);
  });

  it("by radius: the code's centre within the radius of the place, the edge included", () => {
    const ring = area({ kind: "radius", origin: OSLO, radiusKm: 25 });
    expect(areaCovers(ring, "2000", LILLESTROM)).toBe(true);
    expect(areaCovers(ring, "5003", BERGEN)).toBe(false);
    const exact = distanceKm(OSLO, LILLESTROM);
    expect(areaCovers(area({ kind: "radius", origin: OSLO, radiusKm: exact }), "2000", LILLESTROM)).toBe(true);
    expect(areaCovers(area({ kind: "radius", origin: OSLO, radiusKm: exact - 0.001 }), "2000", LILLESTROM)).toBe(false);
  });

  it("never for a code missing from the reference data (radius), an area switched off, a place with no position, or no code", () => {
    expect(areaCovers(area({ kind: "radius", origin: OSLO, radiusKm: 160 }), "0150", null)).toBe(false);
    expect(areaCovers(area({ patterns: ["0*"], active: false }), "0150", null)).toBe(false);
    expect(areaCovers(area({ kind: "radius", origin: null, radiusKm: 160 }), "0150", OSLO)).toBe(false);
    expect(areaCovers(area({ patterns: ["0*"] }), null, null)).toBe(false);
  });
});

describe("the local delivery a basket is offered (4.5)", () => {
  const areas = [
    area({ id: "a-wide", patterns: ["0*"], amountMinor: 14_900, position: 0 }),
    area({ id: "a-ring", kind: "radius", origin: OSLO, radiusKm: 10, amountMinor: 9900, minBasketMinor: 50_000, position: 1 }),
    area({ id: "a-free", patterns: ["01*"], amountMinor: 12_900, freeOverMinor: 80_000, position: 2 }),
  ];

  it("is the cheapest covering area whose minimum the basket reaches, its free-above taken off", () => {
    expect(areaFor(areas, "0150", OSLO, 30_000, NOK).offered).toMatchObject({ area: { id: "a-free" }, priceMinor: 12_900 });
    expect(areaFor(areas, "0150", OSLO, 50_000, NOK).offered).toMatchObject({ area: { id: "a-ring" }, priceMinor: 9900 });
    expect(areaFor(areas, "0150", OSLO, 80_000, NOK).offered).toMatchObject({ area: { id: "a-free" }, priceMinor: 0, rate: { amountMinor: 12_900, freeOverMinor: 80_000 } });
    expect(areaFor(areas, "0450", null, 30_000, NOK).offered).toMatchObject({ area: { id: "a-wide" }, priceMinor: 14_900 });
  });

  it("breaks a tie of price by position", () => {
    const tie = [area({ id: "b", patterns: ["0*"], position: 1 }), area({ id: "a2", patterns: ["01*"], position: 0 })];
    expect(areaFor(tie, "0150", null, 1, NOK).offered?.area.id).toBe("a2");
  });

  it("names the covering area the basket is below the minimum of, when none is offered", () => {
    const ring = [areas[1]];
    expect(areaFor(ring, "0150", OSLO, 49_999, NOK)).toMatchObject({ offered: null, belowMinimum: { area: { id: "a-ring" }, minimumMinor: 50_000 } });
    expect(areaFor(ring, "5003", BERGEN, 49_999, NOK)).toEqual({ offered: null, belowMinimum: null });
  });

  it("compares the minimum and free-above as shown, each converted on its own, and prices in the currency shown", () => {
    const ring = [areas[1]];
    // 500 kr is 42.50 EUR shown: 42.49 is below the minimum, 42.50 reaches it, and the 99 kr price is 8.42 EUR (8.415 rounded).
    expect(areaFor(ring, "0150", OSLO, 4249, EUR).offered).toBeNull();
    expect(areaFor(ring, "0150", OSLO, 4250, EUR).offered).toMatchObject({ priceMinor: 842, minimumMinor: 4250 });
    // 800 kr free-above is 68.00 EUR.
    expect(areaFor([areas[2]], "0150", null, 6799, EUR).offered?.priceMinor).toBe(1097);
    expect(areaFor([areas[2]], "0150", null, 6800, EUR).offered?.priceMinor).toBe(0);
  });
});

describe("how many postal codes a radius includes", () => {
  it("counts the centres within it", () => {
    expect(codesWithin(OSLO, 25, [OSLO, LILLESTROM, BERGEN])).toBe(2);
    expect(codesWithin(OSLO, 450, [OSLO, LILLESTROM, BERGEN, STOCKHOLM])).toBe(4);
  });
});
