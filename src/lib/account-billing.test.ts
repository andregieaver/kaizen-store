import { describe, expect, it } from "vitest";

import { endedExtensions, itemChanges, itemProblems } from "./account-billing";

/** An account's one subscription (D748 E4 part two): what it may hold, its item changes, and what ends. */

const plan = { id: "plan-eur-m", currency: "EUR", interval: "month" as const };
const work = { id: "work-eur-m", currency: "EUR", interval: "month" as const, extensionId: "work" as const };
const deals = { id: "deals-eur-m", currency: "EUR", interval: "month" as const, extensionId: "deals" as const };

describe("itemProblems", () => {
  it("takes a plan, an extension alone, or both in one currency and interval", () => {
    expect(itemProblems(plan, [work, deals], [])).toEqual([]);
    expect(itemProblems(null, [work], [])).toEqual([]);
  });

  it("refuses nothing chosen, mixed currencies or intervals, an extension twice, and one the plan includes", () => {
    expect(itemProblems(null, [], [])).toEqual(["Choose a plan or an extension."]);
    expect(itemProblems(plan, [{ ...work, currency: "NOK" }], [])).toEqual(["Everything on the account's plan is billed in one currency."]);
    expect(itemProblems(plan, [{ ...work, interval: "year" }], [])).toEqual(["Everything on the account's plan is billed monthly or yearly, not both."]);
    expect(itemProblems(null, [work, work], [])).toEqual(["Work is chosen twice."]);
    expect(itemProblems(plan, [work], ["work"])).toEqual(["Work is in the plan already."]);
    // Without the plan, the plan's grants do not count.
    expect(itemProblems(null, [work], ["work"])).toEqual([]);
  });
});

describe("itemChanges", () => {
  it("keeps what is wanted, adds what is new and deletes the rest", () => {
    const running = [
      { id: "si_plan", price: "price_basic" },
      { id: "si_work", price: "price_work" },
    ];
    expect(itemChanges(running, ["price_grow", "price_work", "price_deals"])).toEqual([
      { id: "si_plan", deleted: true },
      { price: "price_grow" },
      { price: "price_deals" },
    ]);
    expect(itemChanges(running, ["price_basic", "price_work"])).toEqual([]);
  });
});

describe("endedExtensions", () => {
  it("ends every bought extension when the subscription stops paying, else those taken off it", () => {
    expect(endedExtensions(["work", "deals"], ["work"], "active")).toEqual(["deals"]);
    expect(endedExtensions(["work", "deals"], ["work", "deals"], "past_due")).toEqual([]);
    expect(endedExtensions(["work", "deals"], ["work", "deals"], "canceled")).toEqual(["work", "deals"]);
    expect(endedExtensions(["work"], ["work"], "unpaid")).toEqual(["work"]);
  });
});
