import { describe, expect, it } from "vitest";

import { methodInput } from "./shipping-methods-schema";
import { blocksFromRates, gramsOf, groupsFromBlocks, minorOf, tierStarts, typedAmount, typedKilograms, type BlockDraft } from "./shipping-method-form";
import type { MethodRate } from "./shipping-methods";

const ZONE = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";

const block = (change: Partial<BlockDraft>): BlockDraft => ({ zoneId: null, profileId: null, basis: "none", flat: "", tiers: [], ...change });

describe("the method page's rate grid (D237 2.1)", () => {
  it("reads and writes amounts and weights as the owner types them", () => {
    expect(typedAmount(9900, "NOK")).toBe("99");
    expect(typedAmount(9950, "NOK")).toBe("99,50");
    expect(typedAmount(5, "EUR")).toBe("0,05");
    expect(minorOf("99,5", "NOK")).toBe(9950);
    expect(minorOf("1 299.00", "EUR")).toBe(129900);
    expect(minorOf("99,505", "NOK")).toBeNull();
    expect(minorOf("-5", "NOK")).toBeNull();
    expect(minorOf("", "NOK")).toBeNull();
    expect(gramsOf("2")).toBe(2000);
    expect(gramsOf("0,5")).toBe(500);
    expect(gramsOf("1.25")).toBe(1250);
    expect(gramsOf("1,2345")).toBeNull();
    expect(typedKilograms(1500)).toBe("1,5");
    expect(typedKilograms(20000)).toBe("20");
  });

  it("lays out one block per zone and profile, Rest of country and General first, and reads saved rates back", () => {
    const rates: MethodRate[] = [
      { zoneId: null, profileId: null, basis: "flat", minValue: 0, maxValue: null, amountMinor: 9900 },
      { zoneId: ZONE, profileId: null, basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 14900 },
      { zoneId: ZONE, profileId: null, basis: "weight", minValue: 2000, maxValue: null, amountMinor: 24900 },
    ];
    const blocks = blocksFromRates(rates, [ZONE], [PROFILE], "NOK");
    expect(blocks.map((b) => [b.zoneId, b.profileId, b.basis])).toEqual([
      [null, null, "flat"],
      [null, PROFILE, "none"],
      [ZONE, null, "weight"],
      [ZONE, PROFILE, "none"],
    ]);
    expect(blocks[0].flat).toBe("99");
    expect(blocks[2].tiers).toEqual([
      { upTo: "2", price: "149" },
      { upTo: "", price: "249" },
    ]);
    expect(tierStarts(blocks[2])).toEqual(["0", "2"]);
    // What it reads, it writes again unchanged.
    expect(groupsFromBlocks(blocks, "NOK")).toEqual({
      groups: [
        { zoneId: null, profileId: null, tiers: [rates[0]].map(({ basis, minValue, maxValue, amountMinor }) => ({ basis, minValue, maxValue, amountMinor })) },
        { zoneId: ZONE, profileId: null, tiers: rates.slice(1).map(({ basis, minValue, maxValue, amountMinor }) => ({ basis, minValue, maxValue, amountMinor })) },
      ],
      problems: [],
    });
  });

  it("makes tiers that meet without a gap, each from where the one before ends, and sends nothing for Not offered", () => {
    const { groups, problems } = groupsFromBlocks(
      [block({ basis: "value", tiers: [{ upTo: "500", price: "99" }, { upTo: "1000", price: "49" }, { upTo: "", price: "0" }] }), block({ profileId: PROFILE })],
      "NOK",
    );
    expect(problems).toEqual([]);
    expect(groups).toEqual([
      {
        zoneId: null,
        profileId: null,
        tiers: [
          { basis: "value", minValue: 0, maxValue: 50000, amountMinor: 9900 },
          { basis: "value", minValue: 50000, maxValue: 100000, amountMinor: 4900 },
          { basis: "value", minValue: 100000, maxValue: null, amountMinor: 0 },
        ],
      },
    ]);
    // The server's own schema accepts what the grid sends.
    expect(methodInput.safeParse({ id: null, marketCode: "NO", name: "Standard", names: {}, estimate: null, freeOverMinor: null, active: true, groups }).success).toBe(true);
  });

  it("allows a closed last tier (a basket above it is not offered this method)", () => {
    const { groups, problems } = groupsFromBlocks([block({ basis: "weight", tiers: [{ upTo: "5", price: "99" }, { upTo: "20", price: "199" }] })], "NOK");
    expect(problems).toEqual([]);
    expect(groups[0].tiers.at(-1)).toEqual({ basis: "weight", minValue: 5000, maxValue: 20000, amountMinor: 19900 });
  });

  it("names what is wrong with a block and saves nothing of it", () => {
    const blocks = [
      block({ basis: "flat", flat: "abc" }),
      block({ profileId: PROFILE, basis: "weight", tiers: [{ upTo: "", price: "99" }, { upTo: "5", price: "149" }] }),
      block({ zoneId: ZONE, basis: "value", tiers: [{ upTo: "500", price: "99" }, { upTo: "400", price: "49" }] }),
      block({ zoneId: ZONE, profileId: PROFILE, basis: "weight", tiers: [] }),
      block({ zoneId: null, profileId: "x", basis: "weight", tiers: [{ upTo: "2 kg", price: "" }] }),
    ];
    const { groups, problems } = groupsFromBlocks(blocks, "NOK");
    expect(groups).toEqual([]);
    expect(problems).toEqual([
      { block: 0, message: "Enter the price in NOK." },
      { block: 1, message: "Only the last tier may be left without an up to." },
      { block: 2, message: "Each tier's up to must be above its from." },
      { block: 3, message: "Add a tier, or choose Not offered." },
      { block: 4, message: "Tier 1: up to in kilograms, like 2 or 0,5." },
      { block: 4, message: "Tier 1: enter the price in NOK." },
    ]);
  });
});
