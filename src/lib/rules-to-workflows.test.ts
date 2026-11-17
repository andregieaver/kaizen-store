import { describe, expect, it } from "vitest";

import { conditionMet, ruleMatches, type OrderRule, type RuleCondition, type RuleFacts } from "./order-rules";
import { actionToWorkflow, conditionToWorkflow, paidFactsData, ruleToWorkflow } from "./rules-to-workflows";
import { workflowMatches, workflowProblems } from "./workflows";

/**
 * Order rules as workflows (ecosystem plan E3.3, D718), pure: every kind of a rule's condition, written as a workflow's, holds for exactly the
 * orders the rule's held for (the facts a rule read, as the fields a workflow reads); each action is the workflow's that does the same; a rule
 * that needs *any* of several conditions stays a rule.
 */

const CURRENCY = "NOK";
const base: RuleFacts & { mainCurrency: string } = {
  totalMinor: 200000,
  currency: CURRENCY,
  mainMinor: 200000,
  mainCurrency: CURRENCY,
  marketCode: "SE",
  buyer: "consumer",
  firstOrder: true,
  productIds: ["11111111-1111-4111-8111-111111111111"],
  delivery: "shipping",
  backorder: false,
  gift: false,
  source: "checkout",
  tagKeys: ["vip"],
  seller: "store",
  risk: "normal",
};

/** Orders that differ in every fact a rule can test, so each condition meets some and not others. */
const VARIANTS: (RuleFacts & { mainCurrency: string })[] = [
  base,
  { ...base, mainMinor: 199999 },
  { ...base, mainMinor: 200001 },
  { ...base, mainMinor: null },
  { ...base, mainMinor: 1999, mainCurrency: "EUR" },
  { ...base, mainMinor: 2000, mainCurrency: "EUR" },
  { ...base, marketCode: "NO" },
  { ...base, marketCode: "DK" },
  { ...base, buyer: "business" },
  { ...base, firstOrder: false },
  { ...base, firstOrder: null },
  { ...base, productIds: [] },
  { ...base, productIds: ["22222222-2222-4222-8222-222222222222", "11111111-1111-4111-8111-111111111111"] },
  { ...base, delivery: "pickup" },
  { ...base, delivery: "local" },
  { ...base, delivery: "none" },
  { ...base, backorder: true },
  { ...base, gift: true },
  { ...base, source: "draft" },
  { ...base, source: "subscription" },
  { ...base, source: "delivery" },
  { ...base, tagKeys: [] },
  { ...base, tagKeys: ["big order", "vip"] },
  { ...base, seller: "host" },
  { ...base, risk: "elevated" },
  { ...base, risk: "highest" },
  { ...base, risk: "none" },
  { ...base, risk: null },
  { ...base, risk: undefined },
];

/** Each condition with the store's main currency it is converted in. */
const CONDITIONS: [RuleCondition, string][] = [
  [{ kind: "total_at_least", amountMinor: 200000 }, CURRENCY],
  [{ kind: "total_below", amountMinor: 200000 }, CURRENCY],
  [{ kind: "total_at_least", amountMinor: 1999 }, "EUR"],
  [{ kind: "total_below", amountMinor: 2000 }, "EUR"],
  ...(
    [
      { kind: "country_in", countries: ["SE"] },
      { kind: "country_in", countries: ["DK", "NO"] },
      { kind: "buyer_is", buyer: "business" },
      { kind: "buyer_is", buyer: "consumer" },
      { kind: "first_order", value: true },
      { kind: "first_order", value: false },
      { kind: "has_product", productIds: ["11111111-1111-4111-8111-111111111111"] },
      { kind: "has_product", productIds: ["33333333-3333-4333-8333-333333333333", "22222222-2222-4222-8222-222222222222"] },
      { kind: "delivery_is", deliveries: ["pickup"] },
      { kind: "delivery_is", deliveries: ["local", "none"] },
      { kind: "has_backorder" },
      { kind: "is_gift" },
      { kind: "source_is", sources: ["draft"] },
      { kind: "source_is", sources: ["subscription", "delivery"] },
      { kind: "has_tag", tagKey: "big order", label: "Big order" },
      { kind: "seller_is", seller: "host" },
      { kind: "seller_is", seller: "store" },
      { kind: "risk", level: "highest" },
      { kind: "risk", level: "elevated" },
    ] satisfies RuleCondition[]
  ).map((c): [RuleCondition, string] => [c, CURRENCY]),
];

/** What a workflow on order.paid reads: the payload (its market) and the facts beside it. */
const dataOf = (facts: RuleFacts & { mainCurrency: string }) => ({ order: { market: facts.marketCode, total: facts.totalMinor / 100, ...paidFactsData(facts) } });

describe("a rule's conditions as a workflow's", () => {
  it("holds for exactly the orders the rule's condition held for, kind by kind", () => {
    const kinds = new Set<string>();
    for (const [condition, currency] of CONDITIONS) {
      const converted = conditionToWorkflow(condition, currency);
      expect(converted, condition.kind).not.toBeNull();
      // A total is compared in the main currency the facts are in (the store's): the EUR orders against the EUR amounts.
      for (const facts of VARIANTS.filter((f) => f.mainCurrency === currency)) {
        const rule = conditionMet(condition, facts).met;
        expect(workflowMatches([converted!], dataOf(facts)), `${JSON.stringify(condition)} on ${JSON.stringify(facts)}`).toBe(rule);
      }
      kinds.add(condition.kind);
    }
    // Every kind of condition a rule has is covered.
    expect([...kinds].sort()).toEqual(
      ["buyer_is", "country_in", "delivery_is", "first_order", "has_backorder", "has_product", "has_tag", "is_gift", "risk", "seller_is", "source_is", "total_at_least", "total_below"].sort(),
    );
  });

  it("writes a total in the main currency's units, and a list as one of", () => {
    expect(conditionToWorkflow({ kind: "total_at_least", amountMinor: 199950 }, "NOK")).toEqual({ field: "order.total_main", op: "at_least", value: "1999.5" });
    expect(conditionToWorkflow({ kind: "total_below", amountMinor: 5000 }, "HUF")).toMatchObject({ op: "less_than" });
    expect(conditionToWorkflow({ kind: "country_in", countries: ["SE", "DK"] }, "NOK")).toEqual({ field: "order.market", op: "is_one_of", value: "SE, DK" });
    expect(conditionToWorkflow({ kind: "country_in", countries: ["SE"] }, "NOK")).toEqual({ field: "order.market", op: "is", value: "SE" });
    expect(conditionToWorkflow({ kind: "has_tag", tagKey: "big order", label: "Big order" }, "NOK")).toEqual({ field: "order.tags", op: "is", value: "big order" });
    expect(conditionToWorkflow({ kind: "country_in", countries: [] }, "NOK")).toBeNull();
  });
});

describe("a rule's actions as a workflow's", () => {
  it("tags, holds and asks the same, and notifies staff by email with the rule's name and note", () => {
    expect(actionToWorkflow({ kind: "tag", label: "Big order" }, "R")).toEqual({ kind: "tag_order", tag: "Big order" });
    expect(actionToWorkflow({ kind: "hold", reason: "Check the stock" }, "R")).toEqual({ kind: "hold_order", reason: "Check the stock" });
    expect(actionToWorkflow({ kind: "ask", question: "Is it fraud?" }, "R")).toEqual({ kind: "ask_ai_manager", question: "Is it fraud?" });
    expect(actionToWorkflow({ kind: "notify", note: "Pack it with care" }, "Big order")).toEqual({ kind: "email_staff", subject: "Big order", text: "Pack it with care" });
  });
});

describe("a rule as a workflow", () => {
  const rule = (over: Partial<OrderRule>): Pick<OrderRule, "name" | "match" | "conditions" | "actions"> => ({
    name: "Big order",
    match: "all",
    conditions: [{ kind: "total_at_least", amountMinor: 100000 }, { kind: "country_in", countries: ["SE", "DK"] }],
    actions: [{ kind: "tag", label: "Big order" }, { kind: "hold", reason: "Check it" }, { kind: "notify", note: "Look" }, { kind: "ask", question: "Why?" }],
    ...over,
  });

  it("is a valid workflow on order.paid with the rule's name, conditions and actions in their order", () => {
    const move = ruleToWorkflow(rule({}), "NOK");
    expect(move.ok).toBe(true);
    if (!move.ok) return;
    expect(move.workflow).toMatchObject({ name: "Big order", trigger: "order.paid", schedule: null });
    expect(move.workflow.conditions.map((c) => c.field)).toEqual(["order.total_main", "order.market"]);
    expect(move.workflow.actions.map((a) => a.kind)).toEqual(["tag_order", "hold_order", "email_staff", "ask_ai_manager"]);
    expect(workflowProblems(move.workflow)).toEqual([]);
  });

  it("matches the orders the rule matched, all of its conditions or one alone", () => {
    for (const r of [rule({}), rule({ match: "any", conditions: [{ kind: "is_gift" }] }), rule({ conditions: [] })]) {
      const move = ruleToWorkflow(r, CURRENCY);
      if (!move.ok) throw new Error(move.why);
      for (const facts of VARIANTS.filter((f) => f.mainCurrency === CURRENCY)) {
        expect(workflowMatches(move.workflow.conditions, dataOf(facts))).toBe(ruleMatches(r, facts).matched);
      }
    }
  });

  it("stays a rule when any one of several conditions is enough, or a list has nothing in it", () => {
    expect(ruleToWorkflow(rule({ match: "any" }), "NOK")).toEqual({ ok: false, why: "any" });
    expect(ruleToWorkflow(rule({ conditions: [{ kind: "delivery_is", deliveries: [] }] }), "NOK")).toEqual({ ok: false, why: "empty" });
  });
});
