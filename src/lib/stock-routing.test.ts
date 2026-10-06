import { describe, expect, it } from "vitest";

import { allocate, freeUnits, lockOrder, totalsOf, wantsOf, type RoutingLocation, type StockCell, type Take, type WantedLine } from "./stock-routing";

const loc = (id: string, priority = 0, createdAt = "2026-01-01T00:00:00Z", active = true): RoutingLocation => ({ id, priority, createdAt, active });
const cell = (variantId: string, locationId: string, onHand: number, reserved = 0): StockCell => ({ variantId, locationId, onHand, reserved });
const line = (variantId: string, quantity: number, policy: "deny" | "continue" = "deny"): WantedLine => ({ variantId, quantity, policy });

const A = loc("a", 1);
const B = loc("b", 2);
const C = loc("c", 3);

const takesOf = (result: ReturnType<typeof allocate>): Take[] => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.takes;
};

describe("the free units of a variant at a location", () => {
  it("are on hand minus what live checkouts hold, never below zero, and none where there is no level", () => {
    expect(freeUnits(cell("v", "a", 10, 3))).toBe(7);
    expect(freeUnits(cell("v", "a", 2, 5))).toBe(0);
    expect(freeUnits(cell("v", "a", -3, 0))).toBe(0);
    expect(freeUnits(undefined)).toBe(0);
  });
});

describe("keeping an order together (step 2)", () => {
  it("takes every line from the first location that can supply all of them in full", () => {
    const result = allocate({
      locations: [B, A, C],
      cells: [cell("v1", "a", 1), cell("v2", "a", 5), cell("v1", "b", 4), cell("v2", "b", 4), cell("v1", "c", 9), cell("v2", "c", 9)],
      lines: [line("v1", 3), line("v2", 2)],
    });
    expect(result).toEqual({
      ok: true,
      wholeOrderAt: "b",
      takes: [
        { variantId: "v1", locationId: "b", quantity: 3, backordered: 0 },
        { variantId: "v2", locationId: "b", quantity: 2, backordered: 0 },
      ],
    });
  });

  it("prefers the top location when it can supply everything, whatever the order they are given in", () => {
    for (const locations of [[A, B], [B, A]]) {
      const result = allocate({ locations, cells: [cell("v", "a", 5), cell("v", "b", 50)], lines: [line("v", 5)] });
      expect(takesOf(result)).toEqual([{ variantId: "v", locationId: "a", quantity: 5, backordered: 0 }]);
    }
  });

  it("counts a location's reserved units as not free", () => {
    const result = allocate({ locations: [A, B], cells: [cell("v", "a", 5, 3), cell("v", "b", 5)], lines: [line("v", 4)] });
    expect(takesOf(result)).toEqual([{ variantId: "v", locationId: "b", quantity: 4, backordered: 0 }]);
  });

  it("does not use an inactive location, even the one with the most stock", () => {
    const off = loc("z", 0, "2026-01-01T00:00:00Z", false);
    const result = allocate({ locations: [off, A], cells: [cell("v", "z", 99), cell("v", "a", 5)], lines: [line("v", 5)] });
    expect(takesOf(result)).toEqual([{ variantId: "v", locationId: "a", quantity: 5, backordered: 0 }]);
    const only = allocate({ locations: [off, A], cells: [cell("v", "z", 99), cell("v", "a", 1)], lines: [line("v", 5)] });
    expect(only).toMatchObject({ ok: false, reason: "stock", short: 4 });
  });

  it("treats two lines of one variant as one want", () => {
    const result = allocate({ locations: [A, B], cells: [cell("v", "a", 2), cell("v", "b", 5)], lines: [line("v", 2), line("v", 2)] });
    expect(takesOf(result)).toEqual([{ variantId: "v", locationId: "b", quantity: 4, backordered: 0 }]);
  });
});

describe("splitting an order (step 3)", () => {
  it("takes each variant from the locations in rank order, as much as each has free", () => {
    const result = allocate({
      locations: [A, B, C],
      cells: [cell("v1", "a", 2), cell("v1", "b", 2), cell("v1", "c", 9), cell("v2", "b", 3)],
      lines: [line("v1", 5), line("v2", 3)],
    });
    expect(result).toEqual({
      ok: true,
      wholeOrderAt: null,
      takes: [
        { variantId: "v1", locationId: "a", quantity: 2, backordered: 0 },
        { variantId: "v1", locationId: "b", quantity: 2, backordered: 0 },
        { variantId: "v1", locationId: "c", quantity: 1, backordered: 0 },
        { variantId: "v2", locationId: "b", quantity: 3, backordered: 0 },
      ],
    });
  });

  it("keeps the order of the lines in the result", () => {
    const result = allocate({ locations: [A, B], cells: [cell("x", "a", 1), cell("y", "b", 1)], lines: [line("y", 1), line("x", 1)] });
    expect(takesOf(result).map((t) => t.variantId)).toEqual(["y", "x"]);
  });
});

describe("the backordered remainder (step 4)", () => {
  it("is taken at the first location that has a level row for the variant, beyond what was free", () => {
    const result = allocate({
      locations: [A, B, C],
      cells: [cell("v", "b", 1), cell("v", "c", 1)],
      lines: [line("v", 5, "continue")],
    });
    // 1 free at b, 1 free at c; the remaining 3 at b, the first location with a level row (a has none).
    expect(result).toEqual({
      ok: true,
      wholeOrderAt: null,
      takes: [
        { variantId: "v", locationId: "b", quantity: 4, backordered: 3 },
        { variantId: "v", locationId: "c", quantity: 1, backordered: 0 },
      ],
    });
  });

  it("is the whole line at the first location with a level row when nothing is free", () => {
    const result = allocate({ locations: [A, B], cells: [cell("v", "b", 0), cell("v", "a", -2)], lines: [line("v", 3, "continue")] });
    expect(takesOf(result)).toEqual([{ variantId: "v", locationId: "a", quantity: 3, backordered: 3 }]);
  });

  it("goes to the first location in rank order when no location has a level row for the variant", () => {
    const result = allocate({ locations: [B, A], cells: [], lines: [line("v", 2, "continue")] });
    expect(takesOf(result)).toEqual([{ variantId: "v", locationId: "a", quantity: 2, backordered: 2 }]);
  });

  it("never backorders a variant that stops selling at zero: the order fails and nothing is allocated", () => {
    const result = allocate({
      locations: [A, B],
      cells: [cell("keep", "a", 0), cell("stop", "a", 1)],
      lines: [line("keep", 4, "continue"), line("stop", 3, "deny")],
    });
    expect(result).toEqual({ ok: false, reason: "stock", variantId: "stop", short: 2 });
  });

  it("is refused for a variant of a store that has no active location", () => {
    expect(allocate({ locations: [loc("z", 0, "2026-01-01T00:00:00Z", false)], cells: [], lines: [line("v", 1, "continue")] })).toMatchObject({ ok: false, reason: "no_location" });
    expect(allocate({ locations: [], cells: [], lines: [line("v", 1)] })).toMatchObject({ ok: false, reason: "stock", short: 1 });
  });

  it("does not make an order whole when the free units at one location would need a backorder", () => {
    const result = allocate({ locations: [A, B], cells: [cell("v", "a", 2), cell("v", "b", 2)], lines: [line("v", 3, "continue")] });
    expect(result).toMatchObject({ ok: true, wholeOrderAt: null });
    expect(takesOf(result)).toEqual([
      { variantId: "v", locationId: "a", quantity: 2, backordered: 0 },
      { variantId: "v", locationId: "b", quantity: 1, backordered: 0 },
    ]);
  });
});

describe("lines", () => {
  it("sums lines of a variant and ignores empty ones", () => {
    expect(wantsOf([line("v", 2), line("w", 0), line("v", 3), line("x", -1), line("y", 1.9, "continue")])).toEqual([
      { variantId: "v", quantity: 5, policy: "deny" },
      { variantId: "y", quantity: 1, policy: "continue" },
    ]);
    expect(wantsOf([line("v", 1, "continue"), line("v", 1, "deny")])).toEqual([{ variantId: "v", quantity: 2, policy: "deny" }]);
    expect(allocate({ locations: [A], cells: [], lines: [] })).toEqual({ ok: true, takes: [], wholeOrderAt: null });
  });

  it("totals the takes by variant, backorder included", () => {
    const totals = totalsOf([
      { variantId: "v", locationId: "a", quantity: 2, backordered: 0 },
      { variantId: "v", locationId: "b", quantity: 4, backordered: 3 },
      { variantId: "w", locationId: "a", quantity: 1, backordered: 0 },
    ]);
    expect(totals.get("v")).toEqual({ quantity: 6, backordered: 3 });
    expect(totals.get("w")).toEqual({ quantity: 1, backordered: 0 });
  });
});

describe("the order locks are taken in", () => {
  it("is (variant id, location id), each pair once, whatever order they come in", () => {
    const pairs = [
      { variantId: "b", locationId: "2" },
      { variantId: "a", locationId: "9" },
      { variantId: "b", locationId: "1" },
      { variantId: "a", locationId: "9" },
      { variantId: "a", locationId: "3" },
    ];
    expect(lockOrder(pairs)).toEqual([
      { variantId: "a", locationId: "3" },
      { variantId: "a", locationId: "9" },
      { variantId: "b", locationId: "1" },
      { variantId: "b", locationId: "2" },
    ]);
    expect(lockOrder([...pairs].reverse())).toEqual(lockOrder(pairs));
  });
});

// A seeded generator: the properties below run the same cases every time.
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return { int: (max: number) => Math.floor(next() * (max + 1)), pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)], chance: (p: number) => next() < p };
}

describe("properties of the rule (4.3)", () => {
  const cases = 400;

  function scenario(seed: number) {
    const g = generator(seed);
    const locations: RoutingLocation[] = Array.from({ length: 1 + g.int(3) }, (_, i) => loc(`loc${i}`, g.int(2), `2026-01-0${1 + g.int(5)}T00:00:00Z`, g.chance(0.85)));
    const variants = Array.from({ length: 1 + g.int(3) }, (_, i) => `var${i}`);
    const cells: StockCell[] = [];
    for (const v of variants) for (const l of locations) if (g.chance(0.8)) cells.push(cell(v, l.id, g.int(8), g.int(3)));
    const lines: WantedLine[] = variants.flatMap((v) => (g.chance(0.85) ? [line(v, 1 + g.int(9), g.chance(0.4) ? "continue" : "deny")] : []));
    if (g.chance(0.2) && lines.length > 0) lines.push({ ...lines[0], quantity: 1 + g.int(3) });
    return { locations, cells, lines };
  }

  it("allocates exactly the wanted units of every variant, backorder included", () => {
    for (let seed = 1; seed <= cases; seed++) {
      const { locations, cells, lines } = scenario(seed);
      const result = allocate({ locations, cells, lines });
      if (!result.ok) continue;
      const totals = totalsOf(result.takes);
      for (const want of wantsOf(lines)) expect(totals.get(want.variantId)?.quantity, `seed ${seed}`).toBe(want.quantity);
      expect(result.takes.reduce((n, t) => n + t.quantity, 0)).toBe(wantsOf(lines).reduce((n, w) => n + w.quantity, 0));
    }
  });

  it("asks no location for more than its free units, except by the backordered remainder, which only a variant that keeps selling has", () => {
    for (let seed = 1; seed <= cases; seed++) {
      const { locations, cells, lines } = scenario(seed);
      const result = allocate({ locations, cells, lines });
      if (!result.ok) continue;
      const wants = new Map(wantsOf(lines).map((w) => [w.variantId, w]));
      for (const take of result.takes) {
        const free = freeUnits(cells.find((c) => c.variantId === take.variantId && c.locationId === take.locationId));
        expect(take.quantity - take.backordered, `seed ${seed}`).toBeLessThanOrEqual(free);
        expect(take.backordered).toBeGreaterThanOrEqual(0);
        expect(take.backordered).toBeLessThanOrEqual(take.quantity);
        if (take.backordered > 0) expect(wants.get(take.variantId)?.policy).toBe("continue");
        expect(locations.find((l) => l.id === take.locationId)?.active).toBe(true);
      }
    }
  });

  it("refuses a variant that stops selling when too little is free, and then allocates nothing; otherwise never refuses it", () => {
    for (let seed = 1; seed <= cases; seed++) {
      const { locations, cells, lines } = scenario(seed);
      const result = allocate({ locations, cells, lines });
      const active = new Set(locations.filter((l) => l.active).map((l) => l.id));
      const wants = wantsOf(lines);
      const lacks = (w: (typeof wants)[number]) =>
        w.policy === "deny"
          ? cells.filter((c) => c.variantId === w.variantId && active.has(c.locationId)).reduce((n, c) => n + freeUnits(c), 0) < w.quantity
          : active.size === 0;
      // Refused for the first variant, in the order of the lines, that cannot be had (a variant that keeps selling needs a location to be owed at).
      const failing = wants.filter(lacks);
      if (failing.length > 0) {
        expect(result.ok, `seed ${seed}`).toBe(false);
        if (!result.ok) {
          expect(result.variantId).toBe(failing[0].variantId);
          expect(result.reason).toBe(failing[0].policy === "deny" ? "stock" : "no_location");
        }
      } else {
        expect(result.ok, `seed ${seed}`).toBe(true);
      }
    }
  });

  it("keeps the order together whenever one location can supply everything in full", () => {
    for (let seed = 1; seed <= cases; seed++) {
      const { locations, cells, lines } = scenario(seed);
      const wants = wantsOf(lines);
      if (wants.length === 0) continue;
      const ranked = locations.filter((l) => l.active).sort((x, y) => x.priority - y.priority || Date.parse(x.createdAt as string) - Date.parse(y.createdAt as string) || (x.id < y.id ? -1 : 1));
      const whole = ranked.find((l) => wants.every((w) => freeUnits(cells.find((c) => c.variantId === w.variantId && c.locationId === l.id)) >= w.quantity));
      const result = allocate({ locations, cells, lines });
      if (whole) {
        expect(result, `seed ${seed}`).toMatchObject({ ok: true, wholeOrderAt: whole.id });
        if (result.ok) expect(new Set(result.takes.map((t) => t.locationId))).toEqual(new Set([whole.id]));
      } else if (result.ok) {
        expect(result.wholeOrderAt).toBeNull();
      }
    }
  });

  it("does not depend on the order the locations are given in, nor on the cells'", () => {
    for (let seed = 1; seed <= cases; seed++) {
      const { locations, cells, lines } = scenario(seed);
      const forward = allocate({ locations, cells, lines });
      const backward = allocate({ locations: [...locations].reverse(), cells: [...cells].reverse(), lines });
      expect(backward, `seed ${seed}`).toEqual(forward);
    }
  });
});
