import { describe, expect, it } from "vitest";

import { comparisonTable, planCards } from "./plan-offer";
import { choiceFor, includedLines, INCLUDED_MAX, lowestPerInterval, planGroups, plansOfCategory, storePlansData, type StorePlan, type StorePlanPrice } from "./store-plans";

/** A store's plans as its pricing table shows them (D912). */

const price = (interval: "month" | "year", amountMinor: number, variantId = `v-${interval}`): StorePlanPrice => ({
  currency: "NOK",
  interval,
  amountMinor,
  variantId,
  sellingPlanId: `sp-${variantId}`,
  trialDays: 0,
  renewalMinor: amountMinor,
  minCycles: 0,
});

const plan = (id: string, name: string, included: string[], prices: StorePlanPrice[]): StorePlan => ({
  id,
  handle: id,
  name,
  line: "",
  included,
  prices,
  categoryIds: [],
});

describe("what a plan includes", () => {
  it("is its description's lines, bullets and numbers taken off, blank and repeated lines left out", () => {
    expect(includedLines("- Unlimited notes\n\n• AI summaries\n* Sync across devices\n1. Priority support\nunlimited notes.\n  Export  to PDF  ")).toEqual([
      "Unlimited notes",
      "AI summaries",
      "Sync across devices",
      "Priority support",
      "Export to PDF",
    ]);
  });

  it("keeps a dash inside a line, and stops at the most a card lists", () => {
    expect(includedLines("Work-life balance")).toEqual(["Work-life balance"]);
    expect(includedLines(Array.from({ length: 40 }, (_, i) => `Thing ${i}`).join("\n"))).toHaveLength(INCLUDED_MAX);
  });
});

describe("the store's plans as the pricing table's data", () => {
  const basic = plan("basic", "Basic", ["Unlimited notes", "Sync"], [price("month", 9900, "b-m"), price("year", 99000, "b-y")]);
  const plus = plan("plus", "Plus", ["Unlimited notes", "Sync.", "AI summaries"], [price("month", 19900, "p-m"), price("year", 199000, "p-y")]);

  it("orders the plans from the cheapest a month, and shares a line written alike as one feature", () => {
    const data = storePlansData([plus, basic]);
    expect(data.plans.map((p) => p.name)).toEqual(["Basic", "Plus"]);
    expect(data.features.map((f) => f.name)).toEqual(["Unlimited notes", "Sync", "AI summaries"]);
    expect(data.plans[1].featureIds).toEqual(["unlimited notes", "sync", "ai summaries"]);
  });

  it("draws Kaizena Flow's cards and comparison from it: the month leading, the year under it, ticks per plan", () => {
    const data = storePlansData([basic, plus]);
    const { currency, cards } = planCards(data, {});
    expect(currency).toBe("NOK");
    expect(cards.map((c) => [c.name, c.main.amountMinor, c.other?.amountMinor])).toEqual([
      ["Basic", 9900, 99000],
      ["Plus", 19900, 199000],
    ]);
    // 1 990 kr a year against 12 x 199 kr saves 17 %.
    expect(cards[1].yearlySavingPercent).toBe(17);
    const table = comparisonTable(data, cards);
    expect(table).toHaveLength(1);
    expect(table[0].rows.map((r) => [r.name, r.included])).toEqual([
      ["Unlimited notes", [true, true]],
      ["Sync", [true, true]],
      ["AI summaries", [false, true]],
    ]);
  });

  it("a card's button buys its plan's variant at the card's billing period", () => {
    expect(choiceFor(plus, "year")?.variantId).toBe("p-y");
    expect(choiceFor(plus, "month")?.sellingPlanId).toBe("sp-p-m");
    expect(choiceFor(plan("m", "Monthly only", [], [price("month", 100)]), "year")).toBeNull();
    expect(choiceFor(undefined, "month")).toBeNull();
  });

  it("shows one price a billing period: the lowest of two variants renewing alike", () => {
    expect(lowestPerInterval([price("year", 500, "a"), price("month", 90, "b"), price("month", 80, "c")]).map((p) => p.variantId)).toEqual(["c", "a"]);
  });
});

describe("a pricing table of one product's plans (D914)", () => {
  const life = "00000000-0000-4000-8000-0000000000a1";
  const notes = "00000000-0000-4000-8000-0000000000a2";
  const plans = [
    { ...plan("free", "Free", [], [price("month", 0)]), categoryIds: [] },
    { ...plan("plus", "Plus", [], [price("month", 9900)]), categoryIds: [life] },
    // In a category under Life: its categories carry the one above, as the store's reader gives them.
    { ...plan("pro", "Pro", [], [price("month", 29900)]), categoryIds: ["00000000-0000-4000-8000-0000000000b1", life] },
    { ...plan("team", "Team", [], [price("month", 49900)]), categoryIds: [notes] },
  ];

  it("shows every plan when it names no category, and only the plans in or under its category when it does", () => {
    expect(plansOfCategory(plans, undefined).map((p) => p.id)).toEqual(["free", "plus", "pro", "team"]);
    expect(plansOfCategory(plans, life).map((p) => p.id)).toEqual(["plus", "pro"]);
    expect(plansOfCategory(plans, notes).map((p) => p.id)).toEqual(["team"]);
    expect(plansOfCategory(plans, "00000000-0000-4000-8000-0000000000ff")).toEqual([]);
  });

  it("offers the categories holding plans, by name, each with its plans", () => {
    const categories = [
      { id: notes, name: "Notes" },
      { id: life, name: "Life" },
      { id: "00000000-0000-4000-8000-0000000000c1", name: "Mugs" },
    ];
    expect(planGroups(plans, categories)).toEqual([
      { id: life, name: "Life", planIds: ["plus", "pro"] },
      { id: notes, name: "Notes", planIds: ["team"] },
    ]);
  });
});
