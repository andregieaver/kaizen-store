import { describe, expect, it } from "vitest";

import { compareShares } from "./recommend-eval";
import { callRates, splitP, UNITS } from "./experiment-units";
import { legacyCompareShares, legacyDifference, legacySampleRatioP, legacySearchVerdict } from "./experiment-legacy";

/**
 * Phase 7 (D148): the search test and the recommendations test now count with the engine's arithmetic. Old and new must give the same
 * numbers on the same data, so each is run here on the same counts: a fixed grid across the edges (too few, even, clear) and a few
 * thousand seeded random ones, against the old formulas kept word for word in `experiment-legacy.ts`.
 */

/** A small seeded generator, so a failure repeats. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES = [0, 1, 99, 100, 199, 200, 201, 500, 1000, 5000, 20000];

/** Pairs of (hits, of) for two arms: every size pair with a few shares each, plus random ones. */
function pairs(): { a: { hits: number; of: number }; b: { hits: number; of: number } }[] {
  const out: { a: { hits: number; of: number }; b: { hits: number; of: number } }[] = [];
  for (const na of SIZES) {
    for (const nb of SIZES) {
      for (const [sa, sb] of [[0, 0], [0.3, 0.3], [0.3, 0.36], [0.36, 0.3], [0.05, 0.08], [1, 1], [0.5, 0.52], [0.1, 0.25]]) {
        out.push({ a: { hits: Math.round(na * sa), of: na }, b: { hits: Math.round(nb * sb), of: nb } });
      }
    }
  }
  const random = seeded(77);
  for (let i = 0; i < 4000; i += 1) {
    const na = Math.floor(random() * 3000);
    const nb = Math.floor(random() * 3000);
    out.push({ a: { hits: Math.floor(random() * (na + 1) * random()), of: na }, b: { hits: Math.floor(random() * (nb + 1) * random()), of: nb } });
  }
  return out;
}

describe("the search test on the engine's arithmetic (D77)", () => {
  it("gives the same split chance as before, and the same reading of it", () => {
    const random = seeded(5);
    for (let i = 0; i < 2000; i += 1) {
      const a = Math.floor(random() * 2000);
      const b = Math.floor(random() * 2000);
      const share = [0.05, 0.2, 0.5, 0.8, 0.95][i % 5];
      const old = legacySampleRatioP(a, b, share);
      const now = splitP(a, b, share);
      expect(Math.abs(now - old), `${a}/${b} at ${share}`).toBeLessThan(1e-6);
      // What counts is whether it is under the line the test is stopped at.
      if (Math.abs(old - 0.001) > 1e-5) expect(now < 0.001).toBe(old < 0.001);
    }
    expect(splitP(0, 0, 0.5)).toBe(1);
  });

  it("gives the same difference and interval as before", () => {
    for (const { a, b } of pairs()) {
      const old = legacyDifference(a, b);
      const now = callRates(a, b, { rule: "interval", floor: UNITS.search.floor });
      if (!old) {
        expect(now.diff).toBeNull();
        continue;
      }
      expect(now.diff).toBeCloseTo(old.diff, 12);
      expect(now.low).toBeCloseTo(old.low, 12);
      expect(now.high).toBeCloseTo(old.high, 12);
    }
  });

  it("makes the same call as before, higher or lower being better, with a sound or a broken split", () => {
    let called = 0;
    for (const { a, b } of pairs()) {
      for (const srm of [0.5, 0.0001]) {
        for (const lower of [false, true]) {
          const old = legacySearchVerdict(a, b, srm, lower);
          const now = callRates(a, b, { rule: "interval", floor: UNITS.search.floor, splitChance: srm, lowerIsBetter: lower }).call;
          expect(now, JSON.stringify({ a, b, srm, lower })).toBe(old);
          if (old === "better" || old === "worse") called += 1;
        }
      }
    }
    // The grid reaches every kind of call, not only the quiet ones.
    expect(called).toBeGreaterThan(500);
  });
});

describe("the recommendations test on the engine's arithmetic (D140)", () => {
  it("makes the same call, with the same shares and p-value, as before", () => {
    const kinds = new Set<string>();
    for (const { a, b } of pairs()) {
      const ai = { success: a.hits, n: a.of };
      const plain = { success: b.hits, n: b.of };
      const old = legacyCompareShares(ai, plain);
      const now = compareShares(ai, plain);
      expect(now.verdict, JSON.stringify({ a, b })).toBe(old.verdict);
      expect(now.a).toBe(old.a);
      expect(now.b).toBe(old.b);
      expect(now.diff).toBe(old.diff);
      if (old.p === null) expect(now.p).toBeNull();
      // The two normal curves differ by under 1e-6, which can move the rounded third decimal at a boundary.
      else expect(Math.abs((now.p ?? 9) - old.p)).toBeLessThanOrEqual(0.001);
      kinds.add(old.verdict);
    }
    expect([...kinds].sort()).toEqual(["a_better", "b_better", "no_clear_difference", "too_few"]);
  });
});
