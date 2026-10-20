import { describe, expect, it } from "vitest";

import {
  CONDITIONS_MAX,
  countSegment,
  describeCondition,
  describeRules,
  holds,
  matches,
  SEGMENT_STARTERS,
  segmentInput,
  segmentRulesSchema,
  type Condition,
  type Person,
} from "./segments";

const today = new Date("2026-10-20T12:00:00Z");
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();

const person = (p: Partial<Person> = {}): Person => ({
  email: "kari@example.com",
  customerId: null,
  name: "",
  account: false,
  language: "nb",
  country: "no",
  groupId: null,
  company: false,
  orders: 2,
  firstOrderAt: daysAgo(400),
  lastOrderAt: daysAgo(40),
  spentMinor: 150_000,
  consent: "subscribed",
  rfm: "Loyal",
  tags: ["vip"],
  ...p,
});

const ctx = { money: (minor: number) => `${minor / 100} kr` };

describe("a condition (D296)", () => {
  it("reads every fact as its words say", () => {
    const p = person();
    const cases: [Condition, boolean][] = [
      [{ kind: "consent", statuses: ["subscribed"] }, true],
      [{ kind: "consent", statuses: ["none", "unsubscribed"] }, false],
      [{ kind: "orders", op: "atLeast", value: 2 }, true],
      [{ kind: "orders", op: "atMost", value: 1 }, false],
      [{ kind: "orders", op: "exactly", value: 2 }, true],
      [{ kind: "spent", op: "atLeast", minor: 150_000 }, true],
      [{ kind: "spent", op: "atMost", minor: 149_999 }, false],
      [{ kind: "lastOrder", op: "within", days: 41 }, true],
      [{ kind: "lastOrder", op: "within", days: 40 }, false],
      [{ kind: "lastOrder", op: "before", days: 40 }, true],
      [{ kind: "lastOrder", op: "never" }, false],
      [{ kind: "firstOrder", op: "before", days: 365 }, true],
      [{ kind: "firstOrder", op: "within", days: 365 }, false],
      [{ kind: "rfm", groups: ["VIP", "Loyal"] }, true],
      [{ kind: "country", codes: ["se"] }, false],
      [{ kind: "country", codes: ["no"] }, true],
      [{ kind: "language", codes: ["nb"] }, true],
      [{ kind: "group", ids: ["11111111-1111-4111-8111-111111111111"] }, false],
      [{ kind: "company", has: false }, true],
      [{ kind: "account", has: true }, false],
      [{ kind: "tag", tags: ["VIP "] }, true],
      [{ kind: "tag", tags: ["other"] }, false],
    ];
    for (const [c, want] of cases) expect([c, holds(c, p, today)]).toEqual([c, want]);
  });

  it("never holds on a fact that is not known", () => {
    const p = person({ spentMinor: null, lastOrderAt: null, firstOrderAt: null, rfm: null, country: null, language: null, orders: 0 });
    expect(holds({ kind: "spent", op: "atMost", minor: 1_000_000 }, p, today)).toBe(false);
    expect(holds({ kind: "lastOrder", op: "before", days: 1 }, p, today)).toBe(false);
    expect(holds({ kind: "lastOrder", op: "never" }, p, today)).toBe(true);
    expect(holds({ kind: "rfm", groups: ["Lost"] }, p, today)).toBe(false);
    expect(holds({ kind: "country", codes: ["no"] }, p, today)).toBe(false);
  });
});

describe("a segment's rules", () => {
  it("match all or any, and everyone without conditions", () => {
    const rules = (match: "all" | "any") => ({ match, conditions: [{ kind: "orders", op: "atLeast", value: 5 }, { kind: "tag", tags: ["vip"] }] as Condition[] });
    expect(matches(rules("all"), person(), today)).toBe(false);
    expect(matches(rules("any"), person(), today)).toBe(true);
    expect(matches({ match: "all", conditions: [] }, person(), today)).toBe(true);
  });

  it("count the people, those who want the emails, and those money could not judge", () => {
    const people = [person(), person({ consent: "none" }), person({ spentMinor: null })];
    expect(countSegment({ match: "all", conditions: [{ kind: "spent", op: "atLeast", minor: 1 }] }, people, today)).toEqual({ people: 2, subscribed: 1, moneyUnknown: 1 });
    expect(countSegment({ match: "all", conditions: [] }, people, today)).toEqual({ people: 3, subscribed: 2, moneyUnknown: 0 });
  });

  it("are checked: a closed list of conditions, at most twenty, days where needed, valid tags", () => {
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "lastOrder", op: "within" }] }).success).toBe(false);
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "lastOrder", op: "never" }] }).success).toBe(true);
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "tag", tags: ["a,b"] }] }).success).toBe(false);
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "sql", text: "1=1" }] }).success).toBe(false);
    const many = Array.from({ length: CONDITIONS_MAX + 1 }, () => ({ kind: "account", has: true }));
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: many }).success).toBe(false);
    expect(segmentRulesSchema.parse({ match: "any", conditions: [{ kind: "country", codes: ["NO"] }] }).conditions[0]).toEqual({ kind: "country", codes: ["no"] });
    expect(segmentInput.safeParse({ name: " ", rules: { match: "all", conditions: [] } }).success).toBe(false);
  });

  it("read as sentences", () => {
    expect(describeCondition({ kind: "orders", op: "atLeast", value: 2 }, ctx)).toBe("Ordered at least 2 times");
    expect(describeCondition({ kind: "lastOrder", op: "before", days: 90 }, ctx)).toBe("Last order more than 90 days ago");
    expect(describeCondition({ kind: "spent", op: "atLeast", minor: 50_000 }, ctx)).toBe("Spent at least 500 kr (without VAT)");
    expect(describeCondition({ kind: "consent", statuses: ["subscribed", "pending"] }, ctx)).toBe("People who want your emails or are waiting for their confirmation link");
    expect(describeCondition({ kind: "group", ids: ["x"] }, { ...ctx, groupName: () => "Gold" })).toBe("In the customer group Gold");
    expect(describeRules({ match: "any", conditions: [{ kind: "account", has: true }, { kind: "company", has: true }] }, ctx)).toBe("Has an account · or Buys for a company");
    expect(describeRules({ match: "all", conditions: [] }, ctx)).toBe("Everyone");
  });

  it("start from ready sets that are valid rules", () => {
    for (const s of SEGMENT_STARTERS) expect(segmentRulesSchema.safeParse(s.rules).success).toBe(true);
    expect(new Set(SEGMENT_STARTERS.map((s) => s.key)).size).toBe(SEGMENT_STARTERS.length);
  });
});
