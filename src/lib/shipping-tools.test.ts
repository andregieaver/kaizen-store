import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { formatMoney } from "./money";
import { TOOL_FEATURES } from "./owner-tool-features";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput } from "./owner-tools";
import { SHIPPING_TOOLS, groupHandovers, readyWords, shapeArea, shapeMethod, shapeZone, tierWords, weightWords, type HandoverOrder } from "./shipping-tools";

/**
 * The AI manager and shipping methods (D237, `docs/wave-3-shipping-methods.md` 2.6 and 5.5), the parts that need no database: the two tools are in the
 * catalogue, read-only and ungated, behind `settings:read` and `orders:read` and the shop; the words they give are the store's own (amounts by
 * `formatMoney()`, tiers in the page's "from … to under …"), and `pickup_orders` gives counts and numbers, never a name or an address. No tool changes
 * shipping or marks an order ready, collected or out for delivery (section 7). The answers themselves are held by `shipping-tools.int.test.ts`.
 */

const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");

describe("the shipping tools in the owner assistant's catalogue", () => {
  it("are there, ungated, with their permission, the shop's feature and words of their own", () => {
    for (const name of SHIPPING_TOOLS) {
      expect(OWNER_TOOLS_BY_NAME[name]).toBeDefined();
      expect(OWNER_TOOLS_BY_NAME[name].gate).toBeUndefined();
      expect(TOOL_FEATURES[name]).toBe("shop");
      expect(TOOL_WORDS[name]).toBeTruthy();
      expect(OWNER_TOOLS_BY_NAME[name].description).toMatch(/Read-only/);
    }
    expect(TOOL_PERMISSIONS.shipping_overview).toBe("settings:read");
    expect(TOOL_PERMISSIONS.pickup_orders).toBe("orders:read");
  });

  it("read a country by its code and a kind of handover, nothing else", () => {
    expect(readToolInput(OWNER_TOOLS_BY_NAME.shipping_overview, {})).toEqual({ ok: true, input: {} });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.shipping_overview, { market: "no" })).toMatchObject({ ok: true, input: { market: "no" } });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.shipping_overview, { market: "Norway" }).ok).toBe(false);
    expect(readToolInput(OWNER_TOOLS_BY_NAME.pickup_orders, {})).toEqual({ ok: true, input: { kind: "all" } });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.pickup_orders, { kind: "local" })).toEqual({ ok: true, input: { kind: "local" } });
    expect(readToolInput(OWNER_TOOLS_BY_NAME.pickup_orders, { kind: "parcel" }).ok).toBe(false);
  });

  it("say what they do not do, and no tool hands an order over; only the setup tools change shipping (D308), through the Shipping pages' savers", () => {
    expect(OWNER_TOOLS_BY_NAME.shipping_overview.description).toContain("never say what a particular basket pays");
    expect(OWNER_TOOLS_BY_NAME.pickup_orders.description).toContain("never a name or an address");
    expect(OWNER_TOOLS_BY_NAME.pickup_orders.description).toContain("never here");
    const names = [...OWNER_TOOLS.map((t) => t.name), ...MANAGER_TOOLS.map((t) => t.name)];
    expect(names.filter((n) => /shipping_(method|zone|profile|rate)|set_shipping|save_shipping|pickup_option|local_area|ready_for_pickup|mark_ready|collected|out_for_delivery/.test(n))).toEqual(["save_shipping_method"]);
  });

  it("teach the handover and shipping in the playbooks", () => {
    const steps = (id: string) => ASSISTANT_SKILLS.find((s) => s.id === id)!.steps.join(" ");
    expect(steps("ship-orders")).toContain("pickup_orders");
    expect(steps("ship-orders")).toContain("You cannot press them");
    expect(steps("shipping-setup")).toContain("shipping_overview");
    expect(steps("shipping-setup")).toContain("You cannot change shipping");
  });
});

describe("rates in words", () => {
  it("says weights in grams under a kilogram and kilograms from one", () => {
    expect(weightWords(0)).toBe("0 g");
    expect(weightWords(999)).toBe("999 g");
    expect(weightWords(1000)).toBe("1 kg");
    expect(weightWords(2500)).toBe("2.5 kg");
  });

  it("says a tier from its lower bound to under its upper one, an open one 'and more', and a flat one for any basket", () => {
    expect(tierWords({ basis: "flat", minValue: 0, maxValue: null, amountMinor: 9900 }, "NOK", money)).toBe(`${money(9900, "NOK")} for any basket`);
    expect(tierWords({ basis: "weight", minValue: 0, maxValue: 1000, amountMinor: 4900 }, "NOK", money)).toBe(`weight from 0 g to under 1 kg: ${money(4900, "NOK")}`);
    expect(tierWords({ basis: "weight", minValue: 1000, maxValue: null, amountMinor: 9900 }, "NOK", money)).toBe(`weight 1 kg and more: ${money(9900, "NOK")}`);
    expect(tierWords({ basis: "value", minValue: 0, maxValue: 50000, amountMinor: 7900 }, "EUR", money)).toBe(`basket value from ${money(0, "EUR")} to under ${money(50000, "EUR")}: ${money(7900, "EUR")}`);
  });

  it("groups a method's rates by zone and profile, naming Rest of country and General", () => {
    const shaped = shapeMethod(
      {
        name: "Standard",
        currency: "NOK",
        active: true,
        estimate: { min: 1, max: 3 },
        freeOverMinor: 99900,
        rates: [
          { zoneId: null, profileId: null, basis: "weight", minValue: 0, maxValue: 1000, amountMinor: 4900 },
          { zoneId: null, profileId: null, basis: "weight", minValue: 1000, maxValue: null, amountMinor: 9900 },
          { zoneId: "z1", profileId: "p1", basis: "flat", minValue: 0, maxValue: null, amountMinor: 14900 },
        ],
      },
      () => "Nord-Norge",
      () => "Bulky",
      money,
    );
    expect(shaped).toEqual({
      name: "Standard",
      active: true,
      delivery_days: "1 to 3",
      free_over: money(99900, "NOK"),
      rates: [
        { zone: "Rest of country", profile: "General", by: "weight", prices: [`weight from 0 g to under 1 kg: ${money(4900, "NOK")}`, `weight 1 kg and more: ${money(9900, "NOK")}`] },
        { zone: "Nord-Norge", profile: "Bulky", by: "flat", prices: [`${money(14900, "NOK")} for any basket`] },
      ],
    });
    expect(shapeMethod({ name: "Empty", currency: "NOK", active: false, estimate: null, freeOverMinor: null, rates: [] }, String, String, money)).toEqual({
      name: "Empty",
      active: false,
      rates: [],
      note: "No rates yet: this method prices no basket.",
    });
  });

  it("says a zone's size and its first patterns, and an area's reach with the radius's limit", () => {
    const many = Array.from({ length: 14 }, (_, i) => `${i}*`);
    expect(shapeZone({ name: "Oslo", patterns: many })).toEqual({ name: "Oslo", postal_patterns: 14, first_patterns: many.slice(0, 10) });
    const area = { name: "Sentrum", currency: "NOK", kind: "radius" as const, placeName: "Butikken", patterns: [], radiusKm: 5, amountMinor: 7900, minBasketMinor: 20000, freeOverMinor: null, active: false, hasOrigin: false };
    expect(shapeArea(area, money)).toEqual({
      name: "Sentrum",
      active: false,
      covers: "5 km around Butikken, measured between postal-code centres",
      note: "The place has no position, so this area cannot be switched on.",
      price: money(7900, "NOK"),
      minimum_basket: money(20000, "NOK"),
    });
    expect(shapeArea({ ...area, kind: "postal", patterns: ["01*"], hasOrigin: true, active: true, freeOverMinor: 80000 }, money)).toMatchObject({ covers: "1 postal code or prefix", first_patterns: ["01*"], free_over: money(80000, "NOK") });
  });

  it("says how soon a pickup is ready from the Pickup page's own rule", () => {
    expect(readyWords(0)).toBe("when the store says it is ready");
    expect(readyWords(1)).toBe("usually within 1 hour");
    expect(readyWords(47)).toBe("usually within 47 hours");
    expect(readyWords(48)).toBe("usually within 2 days");
    expect(readyWords(50)).toBe("usually within 3 days");
  });
});

describe("orders to hand over, grouped", () => {
  const o = (over: Partial<HandoverOrder>): HandoverOrder => ({ number: "1", method: "pickup", where: "Butikken", placedAt: "2026-10-01T10:00:00.000Z", readyAt: null, outAt: null, ...over });

  it("groups by place or area, pickup first, oldest first, with numbers and counts only", () => {
    const groups = groupHandovers([
      o({ number: "1003", placedAt: "2026-10-03T10:00:00.000Z", readyAt: "2026-10-03T12:00:00.000Z" }),
      o({ number: "1001", placedAt: "2026-10-01T10:00:00.000Z" }),
      o({ number: "1002", method: "local", where: "Sentrum", outAt: "2026-10-02T15:00:00.000Z" }),
      o({ number: "1004", method: "local", where: "Sentrum" }),
      o({ number: "1005", where: null }),
    ]);
    expect(groups).toEqual([
      { kind: "pickup", place: "Butikken", orders: 2, marked_ready: 1, not_marked_ready: 1, numbers: ["1001", "1003"], oldest_placed: "2026-10-01T10:00:00.000Z" },
      { kind: "pickup", place: "Pickup place not recorded", orders: 1, marked_ready: 0, not_marked_ready: 1, numbers: ["1005"], oldest_placed: "2026-10-01T10:00:00.000Z" },
      { kind: "local", area: "Sentrum", orders: 2, out_for_delivery: 1, not_taken_out: 1, numbers: ["1002", "1004"], oldest_placed: "2026-10-01T10:00:00.000Z" },
    ]);
    expect(groupHandovers([])).toEqual([]);
  });
});
