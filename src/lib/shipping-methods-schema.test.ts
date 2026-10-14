import { describe, expect, it } from "vitest";

import { defaultWeightInput, localAreaInput, methodInput, pickupOptionInput, profileInput, zoneInput } from "./shipping-methods-schema";

const ID = "6f0c2b8e-3d1a-4c5e-9f7a-1b2c3d4e5f60";
const ZONE = "7a1d3c9f-4e2b-4d6f-8a1b-2c3d4e5f6a70";

const method = (o: Record<string, unknown> = {}) => ({
  id: null,
  marketCode: "NO",
  name: " Standard ",
  names: { "en": "Standard", "nb-NO": "Standard" },
  estimate: { min: 1, max: 3 },
  freeOverMinor: null,
  active: true,
  groups: [
    { zoneId: null, profileId: null, tiers: [{ basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 7900 }, { basis: "weight", minValue: 2000, maxValue: null, amountMinor: 12_900 }] },
    { zoneId: ZONE, profileId: null, tiers: [] },
  ],
  ...o,
});

describe("a method as its editor sends it", () => {
  it("is taken with its name trimmed, tiers that meet and a block left Not offered", () => {
    const parsed = methodInput.parse(method());
    expect(parsed.name).toBe("Standard");
    expect(parsed.groups[1].tiers).toEqual([]);
  });

  it("is refused with a gap or overlap in a block, two blocks for one zone and profile, a transit time upside down, a free-above of 0, a long name", () => {
    const problems = (o: Record<string, unknown>) => methodInput.safeParse(method(o)).error?.issues.map((i) => i.message) ?? [];
    expect(problems({ groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 1 }, { basis: "weight", minValue: 2500, maxValue: null, amountMinor: 1 }] }] })).toEqual([
      "Rates: no gap between tiers: each starts where the one before ends, the first at 0.",
    ]);
    expect(problems({ groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 1 }] }, { zoneId: null, profileId: null, tiers: [] }] })).toEqual([
      "Rates: one block per zone and profile.",
    ]);
    expect(problems({ estimate: { min: 4, max: 2 } })).toEqual(["Transit time: the first number is at most the second."]);
    expect(problems({ freeOverMinor: 0 })).toEqual(["Free above: above zero, or leave it empty."]);
    expect(problems({ name: "x".repeat(61) })).toEqual(["Name: at most 60 characters."]);
    expect(problems({ name: "  " })).toEqual(["Name: enter a name."]);
    expect(problems({ names: { "not a locale": "x" } }).length).toBeGreaterThan(0);
  });
});

describe("a zone, a profile and the default weight", () => {
  it("take postal codes and prefixes as cleaned, and refuse what is not one or a repeat", () => {
    expect(zoneInput.safeParse({ id: null, marketCode: "NO", name: "Oslo", patterns: ["0150", "01*"] }).success).toBe(true);
    expect(zoneInput.safeParse({ id: null, marketCode: "NO", name: "Oslo", patterns: [] }).error?.issues[0].message).toBe("Enter at least one postal code or prefix.");
    expect(zoneInput.safeParse({ id: null, marketCode: "NO", name: "Oslo", patterns: ["01 50"] }).error?.issues[0].message).toBe("Postal codes: codes like 0150, or prefixes like 01*.");
    expect(zoneInput.safeParse({ id: null, marketCode: "NO", name: "Oslo", patterns: ["0150", "0150"] }).error?.issues[0].message).toBe("Postal codes: each only once.");
  });

  it("take a profile's products by id", () => {
    expect(profileInput.safeParse({ id: ID, name: "Bulky", productIds: [ID] }).success).toBe(true);
    expect(profileInput.safeParse({ id: null, name: "Bulky", productIds: ["nope"] }).success).toBe(false);
  });

  it("take the default weight in whole grams from 1 to 35,000", () => {
    expect(defaultWeightInput.safeParse({ grams: 500 }).success).toBe(true);
    expect(defaultWeightInput.safeParse({ grams: 0 }).success).toBe(false);
    expect(defaultWeightInput.safeParse({ grams: 35_001 }).success).toBe(false);
    expect(defaultWeightInput.safeParse({ grams: 12.5 }).success).toBe(false);
  });
});

describe("a pickup option and a local area", () => {
  it("take a pickup option free by default up to its limits", () => {
    const base = { locationId: ID, active: true, amountMinor: 0, readyInHours: 0, instructions: "Ask at the till.", instructionsT: {} };
    expect(pickupOptionInput.safeParse(base).success).toBe(true);
    expect(pickupOptionInput.safeParse({ ...base, readyInHours: 721 }).success).toBe(false);
    expect(pickupOptionInput.safeParse({ ...base, amountMinor: -1 }).success).toBe(false);
    expect(pickupOptionInput.safeParse({ ...base, instructions: "x".repeat(1001) }).success).toBe(false);
  });

  it("take an area by postal codes without a radius, or by a radius from a place without postal codes", () => {
    const base = { id: null, marketCode: "NO", locationId: null, name: "Oslo", names: {}, kind: "postal", patterns: ["0*"], radiusKm: null, amountMinor: 9900, minBasketMinor: null, freeOverMinor: null, info: "", infoT: {}, active: true };
    expect(localAreaInput.safeParse(base).success).toBe(true);
    expect(localAreaInput.safeParse({ ...base, patterns: [] }).success).toBe(false);
    expect(localAreaInput.safeParse({ ...base, radiusKm: 5 }).success).toBe(false);
    const radius = { ...base, kind: "radius", patterns: [], locationId: ID, radiusKm: 12.5 };
    expect(localAreaInput.safeParse(radius).success).toBe(true);
    expect(localAreaInput.safeParse({ ...radius, locationId: null }).success).toBe(false);
    expect(localAreaInput.safeParse({ ...radius, radiusKm: 160.5 }).success).toBe(false);
    expect(localAreaInput.safeParse({ ...radius, radiusKm: 0.5 }).success).toBe(false);
    expect(localAreaInput.safeParse({ ...radius, radiusKm: 12.25 }).success).toBe(false);
    expect(localAreaInput.safeParse({ ...radius, minBasketMinor: 0 }).success).toBe(false);
  });
});
