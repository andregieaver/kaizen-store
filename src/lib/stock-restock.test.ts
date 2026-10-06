import { describe, expect, it } from "vitest";

import { leftToRestore, restockableTotal, restockPlan, restockRoom, type Part } from "./stock-restock";

const at = (locationId: string, quantity: number): Part => ({ locationId, quantity });
const parts = (plan: ReturnType<typeof restockPlan>) => {
  if (!plan.ok) throw new Error(`refused: ${plan.reason}`);
  return plan.parts.map((p) => [p.locationId, p.quantity] as const);
};

describe("what is left to put back", () => {
  it("is what the order took at each place minus what went back there", () => {
    expect(leftToRestore([at("a", 3), at("b", 2)], [])).toEqual([at("a", 3), at("b", 2)]);
    expect(leftToRestore([at("a", 3), at("b", 2)], [at("a", 3)])).toEqual([at("b", 2)]);
    expect(leftToRestore([at("a", 3), at("a", 1)], [at("a", 1)])).toEqual([at("a", 3)]);
    expect(leftToRestore([at("a", 1)], [at("a", 5)])).toEqual([]);
  });

  it("takes units that went to a place the order did not take from off the places that still have some, last first", () => {
    expect(leftToRestore([at("a", 3), at("b", 2)], [at("z", 3)])).toEqual([at("a", 2)]);
    expect(leftToRestore([at("a", 3)], [at("z", 1)])).toEqual([at("a", 2)]);
    expect(leftToRestore([at("a", 1)], [at("z", 9)])).toEqual([]);
  });
});

describe("the default: back where the units came from", () => {
  const active = ["a", "b", "c"];

  it("fills the highest-ranked location first, within what was taken there", () => {
    expect(parts(restockPlan({ taken: [at("b", 2), at("a", 3)], returned: [], quantity: 4, activeRank: active }))).toEqual([["a", 3], ["b", 1]]);
    expect(parts(restockPlan({ taken: [at("b", 2), at("a", 3)], returned: [], quantity: 5, activeRank: active }))).toEqual([["a", 3], ["b", 2]]);
    expect(parts(restockPlan({ taken: [at("b", 2), at("a", 3)], returned: [], quantity: 1, activeRank: active }))).toEqual([["a", 1]]);
  });

  it("restocks one place at a time as refunds come: what already went back there is not put back again", () => {
    const taken = [at("a", 2), at("b", 1)];
    const first = restockPlan({ taken, returned: [], quantity: 2, activeRank: active });
    expect(parts(first)).toEqual([["a", 2]]);
    const second = restockPlan({ taken, returned: [at("a", 2)], quantity: 1, activeRank: active });
    expect(parts(second)).toEqual([["b", 1]]);
    expect(restockPlan({ taken, returned: [at("a", 2), at("b", 1)], quantity: 1, activeRank: active })).toEqual({ ok: false, reason: "too_many", max: 0 });
  });

  it("refuses a restock above what the order took, saying how many can go back", () => {
    expect(restockPlan({ taken: [at("a", 2)], returned: [], quantity: 3, activeRank: active })).toEqual({ ok: false, reason: "too_many", max: 2 });
    expect(restockPlan({ taken: [at("a", 2), at("b", 1)], returned: [at("a", 1)], quantity: 3, activeRank: active })).toEqual({ ok: false, reason: "too_many", max: 2 });
  });

  it("marks nothing as elsewhere when every unit goes back where it came from", () => {
    const plan = restockPlan({ taken: [at("a", 2), at("b", 1)], returned: [], quantity: 3, activeRank: active });
    expect(plan).toEqual({
      ok: true,
      parts: [
        { locationId: "a", quantity: 2, elsewhere: false, fallback: false },
        { locationId: "b", quantity: 1, elsewhere: false, fallback: false },
      ],
    });
  });

  it("gives the share of a location that is no longer active to the first active location, and says so", () => {
    const plan = restockPlan({ taken: [at("gone", 2), at("b", 1)], returned: [], quantity: 3, activeRank: active });
    expect(plan).toEqual({
      ok: true,
      parts: [
        { locationId: "b", quantity: 1, elsewhere: false, fallback: false },
        { locationId: "a", quantity: 2, elsewhere: true, fallback: true },
      ],
    });
    // The fallback adds to the units that were going to the first location anyway.
    const merged = restockPlan({ taken: [at("gone", 2), at("a", 1)], returned: [], quantity: 3, activeRank: active });
    expect(merged).toEqual({ ok: true, parts: [{ locationId: "a", quantity: 3, elsewhere: true, fallback: true }] });
  });

  it("follows the units that went to the fallback: a second restock does not count them twice", () => {
    const taken = [at("gone", 3)];
    const first = restockPlan({ taken, returned: [], quantity: 1, activeRank: active });
    expect(parts(first)).toEqual([["a", 1]]);
    const second = restockPlan({ taken, returned: [at("a", 1)], quantity: 2, activeRank: active });
    expect(parts(second)).toEqual([["a", 2]]);
    expect(restockPlan({ taken, returned: [at("a", 1)], quantity: 3, activeRank: active })).toEqual({ ok: false, reason: "too_many", max: 2 });
  });

  it("puts an order with no recorded movements (from before the history) at the first active location, without a limit of its own", () => {
    expect(parts(restockPlan({ taken: [], returned: [], quantity: 2, activeRank: active }))).toEqual([["a", 2]]);
    expect(parts(restockPlan({ taken: [], returned: [], quantity: 2, activeRank: active, chosen: "c" }))).toEqual([["c", 2]]);
  });

  it("plans nothing for no units", () => {
    expect(restockPlan({ taken: [at("a", 2)], returned: [], quantity: 0, activeRank: active })).toEqual({ ok: true, parts: [] });
  });
});

describe("a location staff choose", () => {
  const active = ["a", "b"];

  it("takes all the units of the item, and is elsewhere for the units it did not come from", () => {
    expect(restockPlan({ taken: [at("a", 2), at("b", 1)], returned: [], quantity: 3, activeRank: active, chosen: "b" })).toEqual({
      ok: true,
      parts: [{ locationId: "b", quantity: 3, elsewhere: true, fallback: false }],
    });
    expect(restockPlan({ taken: [at("a", 2), at("b", 1)], returned: [], quantity: 1, activeRank: active, chosen: "b" })).toEqual({
      ok: true,
      parts: [{ locationId: "b", quantity: 1, elsewhere: false, fallback: false }],
    });
  });

  it("must be an active location of the store", () => {
    expect(restockPlan({ taken: [at("a", 2)], returned: [], quantity: 1, activeRank: active, chosen: "gone" })).toEqual({ ok: false, reason: "location_not_active" });
    expect(restockPlan({ taken: [at("a", 2)], returned: [], quantity: 1, activeRank: [], chosen: null })).toEqual({ ok: false, reason: "no_active_location" });
  });

  it("is still bound by what the order took", () => {
    expect(restockPlan({ taken: [at("a", 2)], returned: [], quantity: 3, activeRank: active, chosen: "b" })).toEqual({ ok: false, reason: "too_many", max: 2 });
  });
});

function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return { int: (max: number) => Math.floor(next() * (max + 1)), chance: (p: number) => next() < p };
}

describe("properties (4.3)", () => {
  it("never returns more than the order took at a place minus what already went back there, and the plan adds up to the quantity", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const g = generator(seed);
      const places = ["p0", "p1", "p2", "p3"];
      const active = places.filter(() => g.chance(0.7));
      const taken = places.filter(() => g.chance(0.6)).map((id) => at(id, 1 + g.int(5)));
      const returned = taken.filter(() => g.chance(0.4)).map((t) => at(t.locationId, g.int(t.quantity)));
      const total = leftToRestore(taken, returned).reduce((n, p) => n + p.quantity, 0);
      const quantity = g.int(8);
      const chosen = g.chance(0.3) && active.length > 0 ? active[g.int(active.length - 1)] : null;
      const plan = restockPlan({ taken, returned, quantity, activeRank: active, chosen });
      if (quantity === 0) {
        expect(plan).toEqual({ ok: true, parts: [] });
        continue;
      }
      if (active.length === 0) {
        expect(plan).toEqual({ ok: false, reason: "no_active_location" });
        continue;
      }
      if (taken.length > 0 && quantity > total) {
        expect(plan, `seed ${seed}`).toEqual({ ok: false, reason: "too_many", max: total });
        continue;
      }
      expect(plan.ok, `seed ${seed}`).toBe(true);
      if (!plan.ok) continue;
      expect(plan.parts.reduce((n, p) => n + p.quantity, 0)).toBe(quantity);
      for (const part of plan.parts) {
        expect(active).toContain(part.locationId);
        expect(part.quantity).toBeGreaterThan(0);
      }
      expect(new Set(plan.parts.map((p) => p.locationId)).size).toBe(plan.parts.length);
      if (chosen === null && taken.length > 0) {
        // The default only fills places the order took from, or the first active one for an inactive original.
        const first = active[0];
        const left = new Map(leftToRestore(taken, returned).map((p) => [p.locationId, p.quantity]));
        for (const part of plan.parts) {
          const own = active.includes(part.locationId) ? (left.get(part.locationId) ?? 0) : 0;
          const fromInactive = [...left.entries()].filter(([id]) => !active.includes(id)).reduce((n, [, q]) => n + q, 0);
          expect(part.quantity).toBeLessThanOrEqual(own + (part.locationId === first ? fromInactive : 0));
        }
      }
    }
  });

  it("is deterministic", () => {
    const args = { taken: [at("a", 2), at("b", 3), at("c", 1)], returned: [at("b", 1)], quantity: 4, activeRank: ["b", "a"] };
    expect(restockPlan(args)).toEqual(restockPlan({ ...args }));
  });
});

describe("how much of a line can still go back (review: a short draw)", () => {
  it("is what the order took less what went back, or nothing known when the order has no recorded sale", () => {
    expect(restockableTotal([at("a", 3), at("b", 2)], [])).toBe(5);
    expect(restockableTotal([at("a", 3), at("b", 2)], [at("a", 1)])).toBe(4);
    expect(restockableTotal([at("a", 1)], [at("a", 1)])).toBe(0);
    expect(restockableTotal([], [])).toBeNull();
  });

  it("limits a line to the units the order really took: a line for 2 that took 1 can put back 1, not 2", () => {
    const history = new Map([["v", { taken: [at("a", 1)], returned: [] }]]);
    const room = restockRoom([{ id: "l1", variantId: "v", quantity: 2, restocked: 0 }], history);
    expect(room.get("l1")).toBe(1);
    // ... and what a plan for exactly that many accepts, so a cancellation or return that asks for `room` is never refused as too_many.
    const plan = restockPlan({ taken: [at("a", 1)], returned: [], quantity: room.get("l1")!, activeRank: ["a"] });
    expect(plan.ok).toBe(true);
    expect(restockPlan({ taken: [at("a", 1)], returned: [], quantity: 2, activeRank: ["a"] })).toMatchObject({ ok: false, reason: "too_many", max: 1 });
  });

  it("shares what was taken over the variant's lines in order, and never gives a line more than its own room", () => {
    const history = new Map([["v", { taken: [at("a", 3)], returned: [] }]]);
    const room = restockRoom(
      [
        { id: "l1", variantId: "v", quantity: 2, restocked: 0 },
        { id: "l2", variantId: "v", quantity: 2, restocked: 0 },
      ],
      history,
    );
    expect([room.get("l1"), room.get("l2")]).toEqual([2, 1]);
    expect(restockRoom([{ id: "l1", variantId: "v", quantity: 4, restocked: 3 }], history).get("l1")).toBe(1);
  });

  it("leaves the line's own room when there is no history for its variant (an order from before the history was kept)", () => {
    expect(restockRoom([{ id: "l1", variantId: "v", quantity: 4, restocked: 1 }], new Map()).get("l1")).toBe(3);
    expect(restockRoom([{ id: "l1", variantId: "v", quantity: 4, restocked: 1 }], new Map([["v", { taken: [], returned: [] }]])).get("l1")).toBe(3);
  });
});
