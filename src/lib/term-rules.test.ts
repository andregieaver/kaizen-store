import { describe, expect, it } from "vitest";

import { RULE_KINDS, RULES_MAX, describeRules, keepOwnIds, newCondition, parseTermRules, ruleFieldIds, ruleManufacturerIds, ruleTermIds, termRulesSchema, type RuleNames } from "./term-rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const M = "33333333-3333-4333-8333-333333333333";

const names: RuleNames = {
  terms: new Map([[A, { name: "Lamps", kind: "category" }]]),
  manufacturers: new Map([[M, "Lysverket"]]),
  fields: new Map([["f1", "Colour"]]),
  money: (minor) => `${(minor / 100).toFixed(2)} kr`,
  kinds: { goods: "goods", rental: "rental" },
};

describe("a collection's rules", () => {
  it("are all or any of one to ten conditions, each checked by its kind", () => {
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "inStock" }] }).data).toEqual({ match: "all", conditions: [{ kind: "inStock" }] });
    expect(termRulesSchema.safeParse({ match: "any", conditions: [] }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: Array.from({ length: RULES_MAX + 1 }, () => ({ kind: "inStock" })) }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "price", min: null, max: null }] }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "price", min: 500, max: 100 }] }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "term", termId: "not-an-id" }] }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "newWithin", days: 400 }] }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "kind", values: ["spaceship"] }] }).success).toBe(false);
    expect(termRulesSchema.safeParse({ conditions: [{ kind: "sql", where: "true" }] }).success).toBe(false);
  });

  it("start every kind from values the editor shows, and read stored rules leniently", () => {
    for (const kind of RULE_KINDS) expect(newCondition(kind).kind).toBe(kind);
    expect(parseTermRules(null)).toBeNull();
    expect(parseTermRules({ conditions: "everything" })).toBeNull();
    expect(parseTermRules({ match: "any", conditions: [{ kind: "newWithin", days: 30 }] })?.match).toBe("any");
  });

  it("say what they hold in words, naming what is gone as gone", () => {
    const rules = termRulesSchema.parse({
      conditions: [
        { kind: "term", termId: A },
        { kind: "term", termId: B, not: true },
        { kind: "price", max: 50000 },
        { kind: "manufacturer", ids: [M] },
        { kind: "newWithin", days: 1 },
      ],
    });
    expect(describeRules(rules, names)).toBe(
      "Products in category Lamps and not in a category or tag that is gone and priced up to 500.00 kr and made by Lysverket and added in the last 1 day",
    );
    expect(describeRules({ match: "any", conditions: [{ kind: "inStock" }, { kind: "field", fieldId: "f1", value: "red", min: null, max: null, unit: null }] }, names)).toBe(
      "Products in stock or Colour is red",
    );
  });

  it("keep only the store's own ids, dropping a condition that names none", () => {
    const rules = termRulesSchema.parse({
      match: "all",
      conditions: [
        { kind: "term", termId: A },
        { kind: "term", termId: B },
        { kind: "manufacturer", ids: [M, B] },
        { kind: "field", fieldId: "other", value: "x" },
        { kind: "inStock" },
      ],
    });
    expect(ruleTermIds(rules)).toEqual([A, B]);
    expect(ruleManufacturerIds(rules)).toEqual([M, B]);
    expect(ruleFieldIds(rules)).toEqual(["other"]);
    const own = keepOwnIds(rules, { terms: new Set([A]), manufacturers: new Set([M]), fields: new Set() });
    expect(own?.conditions).toEqual([{ kind: "term", termId: A, not: false }, { kind: "manufacturer", ids: [M] }, { kind: "inStock" }]);
    expect(keepOwnIds(termRulesSchema.parse({ conditions: [{ kind: "term", termId: B }] }), { terms: new Set(), manufacturers: new Set(), fields: new Set() })).toBeNull();
  });
});
