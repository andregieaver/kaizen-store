import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";
import { CONDITION_KINDS, conditionMet, describeRule, listWords, ruleMatches, type RuleCondition, type RuleFacts } from "./order-rules";
import { orderRuleInput } from "./order-rules-schema";

const facts: RuleFacts = {
  totalMinor: 25000,
  currency: "NOK",
  mainMinor: 25000,
  marketCode: "NO",
  buyer: "consumer",
  firstOrder: true,
  productIds: ["p1", "p2"],
  delivery: "shipping",
  backorder: false,
  gift: false,
  source: "checkout",
  tagKeys: ["vip"],
  seller: "store",
};

const ctx = {
  money: (minor: number) => formatMoney(minor, "NOK", "en"),
  countryName: (code: string) => ({ NO: "Norway", SE: "Sweden" })[code] ?? code,
  productName: (id: string) => ({ p1: "Mug", p9: "Plate" })[id] ?? "a product",
};

describe("conditions (4.9)", () => {
  it("compares the total in the store's main currency, at the boundary", () => {
    expect(conditionMet({ kind: "total_at_least", amountMinor: 25000 }, facts).met).toBe(true);
    expect(conditionMet({ kind: "total_at_least", amountMinor: 25001 }, facts).met).toBe(false);
    expect(conditionMet({ kind: "total_below", amountMinor: 25000 }, facts).met).toBe(false);
    expect(conditionMet({ kind: "total_below", amountMinor: 25001 }, facts).met).toBe(true);
  });

  it("compares a euro order by its main-currency amount, never its own; without a rate it never matches", () => {
    // A 30,00 EUR order is 34 500 NOK at the store's rate: the main-currency figure decides.
    const euro: RuleFacts = { ...facts, totalMinor: 3000, currency: "EUR", mainMinor: 34500, marketCode: "NO" };
    expect(conditionMet({ kind: "total_at_least", amountMinor: 30000 }, euro).met).toBe(true);
    expect(conditionMet({ kind: "total_below", amountMinor: 5000 }, euro).met).toBe(false);
    const noRate: RuleFacts = { ...euro, mainMinor: null };
    expect(conditionMet({ kind: "total_at_least", amountMinor: 0 }, noRate)).toEqual({ kind: "total_at_least", met: false, why: "no_rate" });
    expect(conditionMet({ kind: "total_below", amountMinor: 1_000_000 }, noRate)).toEqual({ kind: "total_below", met: false, why: "no_rate" });
  });

  it("never matches first_order for a guest", () => {
    expect(conditionMet({ kind: "first_order", value: true }, { ...facts, firstOrder: null })).toEqual({ kind: "first_order", met: false, why: "unknown" });
    expect(conditionMet({ kind: "first_order", value: false }, { ...facts, firstOrder: null }).met).toBe(false);
    expect(conditionMet({ kind: "first_order", value: true }, facts).met).toBe(true);
    expect(conditionMet({ kind: "first_order", value: false }, { ...facts, firstOrder: false }).met).toBe(true);
  });

  it("reads each other condition from the facts", () => {
    const cases: [RuleCondition, boolean][] = [
      [{ kind: "country_in", countries: ["SE", "NO"] }, true],
      [{ kind: "country_in", countries: ["SE"] }, false],
      [{ kind: "buyer_is", buyer: "business" }, false],
      [{ kind: "has_product", productIds: ["p9", "p2"] }, true],
      [{ kind: "has_product", productIds: ["p9"] }, false],
      [{ kind: "delivery_is", deliveries: ["pickup", "local"] }, false],
      [{ kind: "delivery_is", deliveries: ["shipping"] }, true],
      [{ kind: "has_backorder" }, false],
      [{ kind: "is_gift" }, false],
      [{ kind: "source_is", sources: ["draft", "checkout"] }, true],
      [{ kind: "has_tag", tagKey: "vip", label: "VIP" }, true],
      [{ kind: "has_tag", tagKey: "big", label: "Big" }, false],
      [{ kind: "seller_is", seller: "host" }, false],
      [{ kind: "risk", level: "elevated" }, false],
    ];
    for (const [c, met] of cases) expect([c.kind, conditionMet(c, facts).met]).toEqual([c.kind, met]);
    const covered = new Set([...cases.map(([c]) => c.kind), "total_at_least", "total_below", "first_order"]);
    expect([...covered].sort()).toEqual([...CONDITION_KINDS].sort());
  });

  it("reads Stripe's risk (D288): at least the level, and never met while it was not read", () => {
    const at = (risk: RuleFacts["risk"]) => ({ ...facts, risk });
    expect(conditionMet({ kind: "risk", level: "elevated" }, at("elevated")).met).toBe(true);
    expect(conditionMet({ kind: "risk", level: "elevated" }, at("highest")).met).toBe(true);
    expect(conditionMet({ kind: "risk", level: "highest" }, at("elevated")).met).toBe(false);
    expect(conditionMet({ kind: "risk", level: "elevated" }, at("normal")).met).toBe(false);
    expect(conditionMet({ kind: "risk", level: "elevated" }, at("none")).met).toBe(false);
    expect(conditionMet({ kind: "risk", level: "elevated" }, at(null))).toEqual({ kind: "risk", met: false, why: "unread" });
  });

  it("matches all or any, and always without a condition", () => {
    const conditions: RuleCondition[] = [{ kind: "country_in", countries: ["SE"] }, { kind: "has_tag", tagKey: "vip", label: "VIP" }];
    expect(ruleMatches({ match: "all", conditions }, facts).matched).toBe(false);
    expect(ruleMatches({ match: "any", conditions }, facts).matched).toBe(true);
    expect(ruleMatches({ match: "all", conditions: [] }, facts)).toEqual({ matched: true, conditions: [] });
    expect(ruleMatches({ match: "any", conditions: [] }, facts).matched).toBe(true);
    expect(ruleMatches({ match: "all", conditions }, facts).conditions).toEqual([
      { kind: "country_in", met: false },
      { kind: "has_tag", met: true },
    ]);
  });
});

describe("the sentence written by code", () => {
  it("says what the rule does", () => {
    expect(
      describeRule(
        {
          match: "all",
          conditions: [
            { kind: "total_at_least", amountMinor: 200000 },
            { kind: "country_in", countries: ["SE"] },
          ],
          actions: [{ kind: "tag", label: "Big order" }, { kind: "hold", reason: "Check" }],
        },
        ctx,
      ),
    ).toBe(`When an order is paid and the total is at least ${formatMoney(200000, "NOK", "en")} and the country is Sweden, tag "Big order" and hold it.`);
    expect(describeRule({ match: "any", conditions: [{ kind: "is_gift" }, { kind: "has_product", productIds: ["p1", "p9"] }], actions: [{ kind: "notify", note: "x" }] }, ctx)).toBe(
      "When an order is paid and it is a gift or it has Mug or Plate, notify staff.",
    );
    expect(describeRule({ match: "all", conditions: [], actions: [{ kind: "notify", note: "x" }] }, ctx)).toBe("When an order is paid, notify staff.");
    expect(listWords(["a", "b", "c"], "and")).toBe("a, b and c");
  });
});

describe("orderRuleInput", () => {
  it("normalises tags, words and lists", () => {
    const parsed = orderRuleInput.parse({
      name: "  Big   orders ",
      conditions: [
        { kind: "has_tag", tag: "  VIP  " },
        { kind: "country_in", countries: ["SE", "SE", "NO"] },
      ],
      actions: [{ kind: "tag", label: " Big order " }, { kind: "hold", reason: "  check  the  address " }],
    });
    expect(parsed).toEqual({
      name: "Big orders",
      match: "all",
      enabled: true,
      conditions: [
        { kind: "has_tag", tagKey: "vip", label: "VIP" },
        { kind: "country_in", countries: ["SE", "NO"] },
      ],
      actions: [{ kind: "tag", label: "Big order" }, { kind: "hold", reason: "check the address" }],
    });
  });

  it("refuses what the closed list does not hold", () => {
    const bad = [
      { name: "", actions: [{ kind: "notify", note: "x" }], conditions: [] },
      { name: "x", actions: [], conditions: [] },
      { name: "x", actions: [{ kind: "email_customer", note: "x" }], conditions: [] },
      { name: "x", actions: [{ kind: "tag", label: "a,b" }], conditions: [] },
      { name: "x", actions: [{ kind: "notify", note: "n".repeat(201) }], conditions: [] },
      { name: "x", actions: [{ kind: "notify", note: "x" }], conditions: [{ kind: "total_at_least", amountMinor: 1.5 }] },
      { name: "x", actions: [{ kind: "notify", note: "x" }], conditions: [{ kind: "total_at_least", amountMinor: -1 }] },
      { name: "x", actions: [{ kind: "notify", note: "x" }], conditions: [{ kind: "country_in", countries: [] }] },
      { name: "x", actions: [{ kind: "notify", note: "x" }], conditions: [{ kind: "has_product", productIds: ["not-a-uuid"] }] },
      { name: "x", actions: [{ kind: "notify", note: "x" }], conditions: [{ kind: "customer_email_is", value: "a@b.c" }] },
      { name: "x", actions: Array.from({ length: 6 }, () => ({ kind: "notify", note: "x" })), conditions: [] },
      { name: "x", actions: [{ kind: "notify", note: "x" }], conditions: Array.from({ length: 11 }, () => ({ kind: "is_gift" })) },
      { name: "n".repeat(81), actions: [{ kind: "notify", note: "x" }], conditions: [] },
    ];
    for (const input of bad) expect([JSON.stringify(input).slice(0, 80), orderRuleInput.safeParse(input).success]).toEqual([JSON.stringify(input).slice(0, 80), false]);
  });
});
