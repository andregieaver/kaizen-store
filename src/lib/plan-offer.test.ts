import { describe, expect, it } from "vitest";

import { comparisonTable, offerCurrency, planCards, yearlySaving, type PublicPlans } from "./plan-offer";

const feature = (id: string, category: string, name: string, position: number) => ({ id, category, name, description: "", position });
const data: PublicPlans = {
  features: [feature("f1", "Selling", "Products", 1), feature("f2", "Selling", "Bookings", 2), feature("f3", "AI", "AI manager", 3)],
  plans: [
    {
      id: "pro",
      name: "Pro",
      description: "For growing stores",
      saleFeeBps: 100,
      position: 2,
      prices: [
        { currency: "NOK", interval: "month", amountMinor: 79900 },
        { currency: "NOK", interval: "year", amountMinor: 799000 },
        { currency: "EUR", interval: "month", amountMinor: 7000 },
      ],
      featureIds: ["f3", "f1", "f2"],
    },
    {
      id: "start",
      name: "Start",
      description: "",
      saleFeeBps: 200,
      position: 1,
      prices: [{ currency: "NOK", interval: "year", amountMinor: 99000 }],
      featureIds: ["f1"],
    },
    { id: "free", name: "Unpriced", description: "", saleFeeBps: 300, position: 3, prices: [], featureIds: [] },
  ],
};

describe("offerCurrency", () => {
  it("takes the one asked for when a plan has a price in it, else the one most plans have", () => {
    expect(offerCurrency(data.plans, "EUR")).toBe("EUR");
    expect(offerCurrency(data.plans, "SEK")).toBe("NOK");
    expect(offerCurrency(data.plans)).toBe("NOK");
    expect(offerCurrency([])).toBeNull();
    expect(offerCurrency(data.plans.slice(2))).toBeNull();
  });
});

describe("yearlySaving", () => {
  it("is the whole percent a year saves against twelve months, and nothing when it saves none", () => {
    expect(yearlySaving(79900, 799000)).toBe(17);
    expect(yearlySaving(1000, 12000)).toBeNull();
    expect(yearlySaving(1000, 13000)).toBeNull();
    expect(yearlySaving(0, 100)).toBeNull();
  });
});

describe("planCards", () => {
  it("lists plans with a price in the currency, in the platform's order, leading with the monthly price", () => {
    const { currency, cards } = planCards(data, {});
    expect(currency).toBe("NOK");
    expect(cards.map((c) => c.id)).toEqual(["start", "pro"]);
    // Start has only a yearly price, so it leads with that and has nothing under it.
    expect(cards[0]).toMatchObject({ main: { interval: "year", amountMinor: 99000 }, other: null, yearlySavingPercent: null });
    expect(cards[1]).toMatchObject({ main: { interval: "month", amountMinor: 79900 }, other: { interval: "year", amountMinor: 799000 }, yearlySavingPercent: 17 });
  });

  it("shows one price when an interval is chosen, falling back to the one a plan has", () => {
    const yearly = planCards(data, { interval: "year" }).cards;
    expect(yearly.map((c) => [c.id, c.main.interval, c.other])).toEqual([["start", "year", null], ["pro", "year", null]]);
    const monthly = planCards(data, { interval: "month" }).cards;
    expect(monthly.map((c) => [c.id, c.main.interval])).toEqual([["start", "year"], ["pro", "month"]]);
    expect(monthly[1].yearlySavingPercent).toBeNull();
  });

  it("lists each plan's features in the platform's order, marks the highlighted plan, and takes another currency", () => {
    const { cards } = planCards(data, { highlightId: "pro" });
    expect(cards[1].features.map((f) => f.name)).toEqual(["Products", "Bookings", "AI manager"]);
    expect(cards.map((c) => c.highlighted)).toEqual([false, true]);
    expect(planCards(data, { currency: "EUR" }).cards.map((c) => c.id)).toEqual(["pro"]);
  });

  it("is empty when no plan has a price", () => {
    expect(planCards({ ...data, plans: [data.plans[2]] }, {})).toEqual({ currency: null, cards: [] });
  });
});

describe("comparisonTable", () => {
  it("groups the features by category and says which shown plans include each", () => {
    const { cards } = planCards(data, {});
    const table = comparisonTable(data, cards);
    expect(table.map((g) => g.category)).toEqual(["Selling", "AI"]);
    expect(table[0].rows.map((r) => [r.name, r.included])).toEqual([["Products", [true, true]], ["Bookings", [false, true]]]);
    expect(table[1].rows[0]).toMatchObject({ name: "AI manager", included: [false, true] });
  });
});
