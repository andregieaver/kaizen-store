import { describe, expect, it } from "vitest";

import { isHandWrittenOnly } from "./ui-catalog";
import { fullCatalog } from "./ui-catalog-all";
import { chunksOf, nightDay, nightPlan, UI_NIGHT_BUDGET_MS, UI_NIGHT_CHUNK, UI_NIGHT_HOUR, UI_NIGHT_KEYS_PER_LANGUAGE } from "./ui-nightly";

/** The nightly interface translations (D436): when a night's run may start, how much it does and in what order. */

describe("the night's start", () => {
  it("is 02:00 Oslo time, winter and summer, and the day is Oslo's", () => {
    expect(UI_NIGHT_HOUR).toBe(2);
    // November: Oslo is UTC+1.
    expect(nightDay(new Date("2026-11-03T00:59:00Z"))).toBeNull();
    expect(nightDay(new Date("2026-11-03T01:00:00Z"))).toBe("2026-11-03");
    expect(nightDay(new Date("2026-11-03T22:59:00Z"))).toBe("2026-11-03");
    // Past Oslo's midnight it is the next day, and before its night.
    expect(nightDay(new Date("2026-11-03T23:30:00Z"))).toBeNull();
    // July: UTC+2.
    expect(nightDay(new Date("2026-07-01T00:00:00Z"))).toBe("2026-07-01");
    expect(nightDay(new Date("2026-06-30T23:59:00Z"))).toBeNull();
  });

  it("can begin at another hour for a test", () => {
    expect(nightDay(new Date("2026-11-03T23:30:00Z"), 0)).toBe("2026-11-04");
  });
});

describe("what a night translates", () => {
  const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `ui:${prefix}.k${i}`);

  it("takes the languages with the fewest missing texts first, each up to the cap, and leaves out one with none", () => {
    const plan = nightPlan(
      [
        { lang: "fr", name: "French", missing: keys("a", 500) },
        { lang: "de", name: "German", missing: keys("b", 12) },
        { lang: "pl", name: "Polish", missing: [] },
        { lang: "es", name: "Spanish", missing: keys("c", 12) },
      ],
      300,
    );
    expect(plan.map((l) => [l.lang, l.keys.length, l.missing.length])).toEqual([
      ["de", 12, 12],
      ["es", 12, 12],
      ["fr", 300, 500],
    ]);
    // The first missing ones, in the catalogue's order, and the language's own fields kept.
    expect(plan[2].keys[0]).toBe("ui:a.k0");
    expect(plan[0].name).toBe("German");
  });

  it("is capped at 300 texts a language a night", () => {
    expect(UI_NIGHT_KEYS_PER_LANGUAGE).toBe(300);
    expect(nightPlan([{ lang: "fr", missing: keys("a", 2000) }])[0].keys).toHaveLength(300);
    expect(nightPlan([{ lang: "fr", missing: keys("a", 2000) }], 0)).toEqual([]);
  });

  it("never takes a hand-written-only text, even when one is handed to it", () => {
    const plan = nightPlan([{ lang: "fr", missing: ["ui:draftPay.quote.pay", "email:quote.sentButton", "ui:draftPay.heading", "ui:cart.title"] }]);
    expect(plan[0].keys).toEqual(["ui:cart.title"]);
    expect(nightPlan([{ lang: "fr", missing: ["ui:draftPay.heading"] }])).toEqual([]);
  });

  it("finds none in the catalogue it plans from, which leaves them out", () => {
    const all = fullCatalog().map((entry) => entry.key);
    expect(all.filter(isHandWrittenOnly)).toEqual([]);
    expect(all.some((key) => key.startsWith("ui:draftPay."))).toBe(false);
    expect(nightPlan([{ lang: "fr", missing: all }], all.length)[0].keys).toEqual(all);
  });

  it("sends 40 texts a call, as Translate on a language's page does, and stops starting calls after two minutes", () => {
    expect(UI_NIGHT_CHUNK).toBe(40);
    expect(chunksOf(keys("a", 85)).map((c) => c.length)).toEqual([40, 40, 5]);
    expect(chunksOf([])).toEqual([]);
    // Two minutes, and a call's own 90 seconds, stay inside the dispatcher's 300.
    expect(UI_NIGHT_BUDGET_MS + 90_000).toBeLessThan(300_000);
  });
});
