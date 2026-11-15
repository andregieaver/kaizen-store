import { describe, expect, it } from "vitest";

import { autonomyDecision, readAutonomy } from "./autopilot-autonomy";
import { purchaseBudgetProblem, purchaseTotalMinor } from "./purchase-budget";

const money = (minor: number) => `${minor / 100} kr`;
const facts = (over: Partial<Parameters<typeof purchaseBudgetProblem>[0]> = {}) =>
  purchaseBudgetProblem({ orderMinor: 50_000, orderCurrency: "NOK", mainCurrency: "NOK", monthMinor: 100_000, perOrderMinor: 100_000, monthlyMinor: 500_000, money, ...over });

describe("the purchasing budget (C3)", () => {
  it("adds a purchase order up from its lines", () => {
    expect(purchaseTotalMinor([{ quantity: 10, unitCostMinor: 4_500 }, { quantity: 2, unitCostMinor: 12_000 }])).toBe(69_000);
  });

  it("lets an order within both limits through, and asks for one over either", () => {
    expect(facts()).toBeNull();
    expect(facts({ orderMinor: 150_000 })).toContain("more than the 1000 kr a purchase order may cost");
    expect(facts({ monthMinor: 480_000 })).toContain("more than the monthly budget of 5000 kr");
    // A budget per order alone: the month is not counted.
    expect(facts({ monthlyMinor: null, monthMinor: null })).toBeNull();
  });

  it("asks without a budget, for another currency, and when the month cannot be added up", () => {
    expect(facts({ perOrderMinor: null, monthlyMinor: null })).toContain("No purchasing budget");
    expect(facts({ orderCurrency: "EUR" })).toContain("in EUR");
    expect(facts({ monthMinor: null })).toContain("more than one currency");
  });

  it("decides create_purchase_order by the level for money and the budget's answer", () => {
    const settings = readAutonomy({ levels: { money: "auto" } });
    expect(autonomyDecision(settings, "create_purchase_order", "spend", { purchaseProblem: null })).toMatchObject({ run: true, area: "money" });
    expect(autonomyDecision(settings, "create_purchase_order", "spend", { purchaseProblem: "Over the budget." })).toEqual({ run: false, why: "Over the budget." });
    expect(autonomyDecision(settings, "create_purchase_order", "spend", {})).toMatchObject({ run: false });
    expect(autonomyDecision(readAutonomy({}), "create_purchase_order", "spend", { purchaseProblem: null })).toMatchObject({ run: false });
    // Cancelling an order gives money back: never automatic, whatever the level.
    expect(autonomyDecision(settings, "cancel_order", "spend", {})).toMatchObject({ run: false });
    expect(autonomyDecision(readAutonomy({ levels: { catalogue: "auto" } }), "answer_supplier_order", "send", {})).toMatchObject({ run: true, area: "catalogue" });
  });
});
