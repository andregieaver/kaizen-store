import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";
import type { PublicPlans } from "./plan-offer";
import { plansIn } from "./plan-words";
import { PLAN_WORDS_NB } from "./plan-words.nb";

const data: PublicPlans = {
  plans: [
    { id: "p", name: "Basic", description: "For startups and entrepreneurs", saleFeeBps: 199, position: 1, prices: [], featureIds: ["f1", "f2"] },
    { id: "q", name: "Own", description: "Typed in the admin today", saleFeeBps: 0, position: 2, prices: [], featureIds: [] },
  ],
  features: [
    { id: "f1", category: "Checkout and selling", name: "Discount codes", description: "Percentage and fixed-amount codes with limits.", position: 1 },
    { id: "f2", category: "Kaizen", name: "A feature renamed in the admin", description: "", position: 2 },
  ],
};

describe("the plans in a page's language (D142, D312)", () => {
  it("leaves English as it is written", () => {
    expect(plansIn(data, "en")).toBe(data);
  });

  it("says each plan's line and each feature's category, name and description in Norwegian, and keeps plan names", () => {
    const nb = plansIn(data, "nb");
    expect(nb.plans.map((p) => [p.name, p.description])).toEqual([
      ["Basic", "For oppstartsbedrifter og gründere"],
      ["Own", "Typed in the admin today"],
    ]);
    expect(nb.features[0]).toMatchObject({ category: "Kasse og salg", name: "Rabattkoder", description: "Koder med prosent eller fast beløp, med begrensninger." });
    // A text changed in the admin shows as written until its Norwegian is written, never a stale translation.
    expect(nb.features[1]).toMatchObject({ category: "Kaizena Flow", name: "A feature renamed in the admin", description: "" });
    expect(nb.plans[0].prices).toBe(data.plans[0].prices);
  });

  it("is only ever looked up as the catalogue's own entries", () => {
    expect(plansIn({ plans: [], features: [{ id: "x", category: "toString", name: "constructor", description: "", position: 0 }] }, "nb").features[0]).toMatchObject({
      category: "toString",
      name: "constructor",
    });
  });
});

describe("the Norwegian of the plans (PLAN_WORDS_NB)", () => {
  const entries = Object.entries(PLAN_WORDS_NB);

  it("has words for every entry, trimmed, in the platform's name", () => {
    for (const [en, nb] of entries) {
      expect(nb.trim(), en).toBe(nb);
      expect(nb.length, en).toBeGreaterThan(0);
      expect(nb, en).not.toMatch(/\bKaizen\b(?!a)/);
    }
  });

  it("claims nothing the English does not (the builder's claims filter)", () => {
    for (const [en, nb] of entries) {
      const said = new Set(findClaims(en).map((c) => c.kind));
      expect(
        findClaims(nb).filter((c) => !said.has(c.kind)),
        en,
      ).toEqual([]);
    }
  });
});
