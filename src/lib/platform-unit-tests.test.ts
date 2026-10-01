import { describe, expect, it } from "vitest";

import { unitTestRow, type UnitTestInput } from "./platform-unit-tests";

const now = new Date("2026-10-20T12:00:00Z");
const day = (n: number) => new Date(now.getTime() - n * 86_400_000);

const search = (over: Partial<UnitTestInput> = {}): UnitTestInput => ({
  id: "s1",
  kind: "search",
  store: null,
  name: "Search",
  status: "running",
  startedAt: day(10),
  unit: "search",
  control: { name: "Keyword search", units: 1000 },
  treatment: { name: "Hybrid search", units: 1000 },
  measure: "with results opened a result",
  controlRate: { hits: 300, of: 900 },
  treatmentRate: { hits: 380, of: 900 },
  rule: "interval",
  controlShare: 0.5,
  ...over,
});

describe("unitTestRow", () => {
  it("reads the search test in the engine's words, with a sound split and no flags", () => {
    const row = unitTestRow(search(), now);
    expect(row).toMatchObject({ call: "better", headline: "Hybrid search is better than Keyword search.", flags: [] });
    expect(row.detail).toContain("of searches with results opened a result");
    expect(row.detail).toContain("1,000 searches for Keyword search and 1,000 for Hybrid search");
  });

  it("says it is too early below the floor, with the unit's own name", () => {
    const row = unitTestRow(search({ controlRate: { hits: 3, of: 40 }, treatmentRate: { hits: 5, of: 60 }, control: { name: "Keyword search", units: 50 }, treatment: { name: "Hybrid search", units: 50 } }), now);
    expect(row).toMatchObject({ call: "few", headline: "Too early to say." });
    expect(row.detail).toContain("at least 200 searches in each");
  });

  it("flags a split the assignment cannot explain while the test runs, and not after it ended", () => {
    const uneven = { control: { name: "Keyword search", units: 1500 }, treatment: { name: "Hybrid search", units: 500 } };
    const row = unitTestRow(search(uneven), now);
    expect(row.call).toBe("broken");
    expect(row.flags.map((f) => f.kind)).toEqual(["broken"]);
    expect(unitTestRow(search({ ...uneven, status: "stopped" }), now).flags).toEqual([]);
  });

  it("flags a running test nobody is counted in for days", () => {
    const row = unitTestRow(search({ control: { name: "Keyword search", units: 0 }, treatment: { name: "Hybrid search", units: 0 }, controlRate: { hits: 0, of: 0 }, treatmentRate: { hits: 0, of: 0 } }), now);
    expect(row.flags.map((f) => f.kind)).toEqual(["quiet"]);
  });

  it("reads a store's recommendations by tabs, the plain order as the control and the pooled rule", () => {
    const row = unitTestRow(
      {
        id: "recommendations:x",
        kind: "recommendations",
        store: { slug: "fjord", name: "Fjord" },
        name: "Recommendations",
        status: "running",
        startedAt: null,
        unit: "tab",
        control: { name: "The plain order", units: 400 },
        treatment: { name: "The AI's order", units: 3600 },
        measure: "clicked a recommendation",
        controlRate: { hits: 32, of: 400 },
        treatmentRate: { hits: 540, of: 3600 },
        rule: "pooled",
        controlShare: 0.1,
      },
      now,
    );
    expect(row).toMatchObject({ call: "better", store: { slug: "fjord" }, unit: "tab", flags: [] });
    expect(row.detail).toContain("tabs");
    expect(row.detail).toContain("The AI's order: 15 % of tabs clicked a recommendation; The plain order: 8 %.");
  });
});
