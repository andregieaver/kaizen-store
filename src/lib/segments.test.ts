import { describe, expect, it } from "vitest";

import { marketingEn } from "./admin-messages/marketing.en";
import { marketingNb } from "./admin-messages/marketing.nb";
import { OWNER_TOOLS_BY_NAME } from "./owner-tools";
import {
  CONDITION_GROUPS,
  CONDITION_KIND_WORDS,
  conditionOffered,
  conditionSchema,
  CONDITIONS_MAX,
  countSegment,
  describeCondition,
  describeRules,
  holds,
  matches,
  newCondition,
  SEGMENT_STARTERS,
  segmentInput,
  segmentNeeds,
  segmentRulesSchema,
  type Condition,
  type ConditionKind,
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

const ctx = { money: (minor: number) => `${minor / 100} kr`, words: marketingEn.describe };

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

// Ecosystem plan E3.6 (D718): what people bought, their deals, support, reviews, subscriptions and consent to texts.
const MUG = "11111111-1111-4111-8111-111111111111";
const TEA = "22222222-2222-4222-8222-222222222222";
const SHOES = "33333333-3333-4333-8333-333333333333";
const NEW_KINDS: ConditionKind[] = ["bought", "boughtCategory", "deal", "support", "review", "subscription", "sms"];

describe("the conditions on what people bought and how they deal with the store (E3.6)", () => {
  const known = person({
    boughtProducts: { [MUG]: daysAgo(10) },
    boughtCategories: { [SHOES]: daysAgo(100) },
    deals: { open: 1, won: 0 },
    support: { lastAt: daysAgo(5), ratedBad: true },
    reviews: { count: 2, lowestStars: 2 },
    subscriptions: 1,
    sms: "subscribed",
  });

  it("read the facts as their words say", () => {
    const cases: [Condition, boolean][] = [
      [{ kind: "bought", has: true, products: [MUG] }, true],
      [{ kind: "bought", has: true, products: [TEA, MUG] }, true],
      [{ kind: "bought", has: true, products: [TEA] }, false],
      [{ kind: "bought", has: true, products: [MUG], days: 11 }, true],
      [{ kind: "bought", has: true, products: [MUG], days: 10 }, false],
      [{ kind: "bought", has: false, products: [TEA] }, true],
      [{ kind: "bought", has: false, products: [MUG] }, false],
      [{ kind: "bought", has: false, products: [MUG], days: 10 }, true],
      [{ kind: "boughtCategory", has: true, categories: [SHOES] }, true],
      [{ kind: "boughtCategory", has: true, categories: [SHOES], days: 30 }, false],
      [{ kind: "boughtCategory", has: false, categories: [SHOES], days: 30 }, true],
      [{ kind: "deal", status: "open" }, true],
      [{ kind: "deal", status: "won" }, false],
      [{ kind: "support", op: "within", days: 6 }, true],
      [{ kind: "support", op: "within", days: 5 }, false],
      [{ kind: "support", op: "ratedBad" }, true],
      [{ kind: "review" }, true],
      [{ kind: "review", maxStars: 2 }, true],
      [{ kind: "review", maxStars: 1 }, false],
      [{ kind: "subscription", has: true }, true],
      [{ kind: "subscription", has: false }, false],
      [{ kind: "sms", statuses: ["subscribed"] }, true],
      [{ kind: "sms", statuses: ["none", "unsubscribed"] }, false],
    ];
    for (const [c, want] of cases) expect([c, holds(c, known, today)]).toEqual([c, want]);
  });

  it("count none as none: no deal, no conversation, no review, no subscription, never asked for texts", () => {
    const none = person({ boughtProducts: {}, deals: { open: 0, won: 0 }, support: { lastAt: null, ratedBad: false }, reviews: { count: 0, lowestStars: null }, subscriptions: 0, sms: "none" });
    expect(holds({ kind: "bought", has: false, products: [MUG] }, none, today)).toBe(true);
    expect(holds({ kind: "deal", status: "open" }, none, today)).toBe(false);
    expect(holds({ kind: "support", op: "within", days: 3650 }, none, today)).toBe(false);
    expect(holds({ kind: "review" }, none, today)).toBe(false);
    expect(holds({ kind: "subscription", has: false }, none, today)).toBe(true);
    expect(holds({ kind: "sms", statuses: ["none"] }, none, today)).toBe(true);
  });

  it("hold for nobody, either way, where the fact was not read (a feature off, or a reader not asked)", () => {
    const unread = person();
    for (const c of [
      { kind: "bought", has: true, products: [MUG] },
      { kind: "bought", has: false, products: [MUG] },
      { kind: "boughtCategory", has: false, categories: [SHOES] },
      { kind: "deal", status: "open" },
      { kind: "support", op: "ratedBad" },
      { kind: "review" },
      { kind: "subscription", has: false },
      { kind: "sms", statuses: ["none"] },
    ] as Condition[]) {
      expect([c.kind, holds(c, unread, today)]).toEqual([c.kind, false]);
    }
  });

  it("are checked: products and categories by id, days where support counts them, stars 1 to 5, the text consents", () => {
    const ok = (c: unknown) => segmentRulesSchema.safeParse({ match: "all", conditions: [c] }).success;
    expect(ok({ kind: "bought", has: true, products: [MUG] })).toBe(true);
    expect(ok({ kind: "bought", has: true, products: [] })).toBe(false);
    expect(ok({ kind: "bought", has: true, products: ["mug"] })).toBe(false);
    expect(ok({ kind: "bought", has: true, products: Array.from({ length: 51 }, () => MUG) })).toBe(false);
    expect(ok({ kind: "boughtCategory", has: true, categories: [SHOES], days: 0 })).toBe(false);
    expect(ok({ kind: "deal", status: "lost" })).toBe(false);
    expect(ok({ kind: "support", op: "within" })).toBe(false);
    expect(ok({ kind: "support", op: "ratedBad" })).toBe(true);
    expect(ok({ kind: "review", maxStars: 6 })).toBe(false);
    expect(ok({ kind: "sms", statuses: ["maybe"] })).toBe(false);
  });

  it("start from a condition the builder can show, valid once its products or categories are chosen", () => {
    for (const kind of NEW_KINDS) {
      const fresh = newCondition(kind);
      const filled = fresh.kind === "bought" ? { ...fresh, products: [MUG] } : fresh.kind === "boughtCategory" ? { ...fresh, categories: [SHOES] } : fresh;
      expect([kind, conditionSchema.safeParse(filled).success]).toEqual([kind, true]);
    }
  });

  it("read as sentences, by the products' and categories' names, in English and Norwegian", () => {
    const named = { ...ctx, productName: (id: string) => (id === MUG ? "Mug" : id === TEA ? "Tea" : undefined), categoryName: (id: string) => (id === SHOES ? "Shoes" : undefined) };
    expect(describeCondition({ kind: "bought", has: true, products: [MUG, TEA] }, named)).toBe("Bought “Mug” or “Tea”");
    expect(describeCondition({ kind: "bought", has: false, products: [MUG], days: 30 }, named)).toBe("Has not bought “Mug” in the last 30 days");
    expect(describeCondition({ kind: "bought", has: true, products: [SHOES] }, named)).toBe("Bought a product that no longer exists");
    expect(describeCondition({ kind: "bought", has: true, products: [MUG, TEA] }, ctx)).toBe("Bought any of 2 chosen products");
    expect(describeCondition({ kind: "boughtCategory", has: true, categories: [SHOES], days: 1 }, named)).toBe("Bought from “Shoes” in the last 1 day");
    expect(describeCondition({ kind: "boughtCategory", has: false, categories: [SHOES] }, ctx)).toBe("Has not bought from a chosen category");
    expect(describeCondition({ kind: "deal", status: "won" }, ctx)).toBe("Has a deal you won");
    expect(describeCondition({ kind: "support", op: "within", days: 14 }, ctx)).toBe("Talked to your support in the last 14 days");
    expect(describeCondition({ kind: "support", op: "ratedBad" }, ctx)).toBe("Rated a support conversation bad");
    expect(describeCondition({ kind: "review", maxStars: 1 }, ctx)).toBe("Wrote a review of at most 1 star");
    expect(describeCondition({ kind: "review" }, ctx)).toBe("Wrote a review");
    expect(describeCondition({ kind: "subscription", has: false }, ctx)).toBe("Has no active subscription");
    expect(describeCondition({ kind: "sms", statuses: ["subscribed", "pending"] }, ctx)).toBe("People who want your texts or wait for their order to be paid to get your texts");
    const nb = { ...named, words: marketingNb.describe };
    expect(describeCondition({ kind: "bought", has: true, products: [MUG], days: 7 }, nb)).toBe("Har kjøpt «Mug» de siste 7 dager");
    expect(describeCondition({ kind: "review", maxStars: 3 }, nb)).toBe("Har skrevet en anmeldelse med høyst 3 stjerner");
    expect(describeRules({ match: "all", conditions: [{ kind: "deal", status: "open" }, { kind: "subscription", has: true }] }, nb)).toBe("Har en åpen avtale · og Har et aktivt abonnement");
  });

  it("keep every placeholder and every word in Norwegian", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const flat = (o: object, at = ""): [string, string][] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[`${at}${k}`, v] as [string, string]] : flat(v as object, `${at}${k}.`)));
    const nb = new Map(flat({ describe: marketingNb.describe, editor: marketingNb.editor, kinds: marketingNb.kinds }));
    for (const [key, english] of flat({ describe: marketingEn.describe, editor: marketingEn.editor, kinds: marketingEn.kinds })) {
      expect([key, names(nb.get(key) ?? "missing {x}")]).toEqual([key, names(english)]);
    }
  });
});

describe("what the people reader reads for some rules (E3.6)", () => {
  it("only the families the conditions ask for, and the products and categories they name once each", () => {
    const needs = segmentNeeds([
      { match: "all", conditions: [{ kind: "bought", has: true, products: [MUG, TEA] }, { kind: "deal", status: "open" }] },
      { match: "any", conditions: [{ kind: "bought", has: false, products: [MUG] }, { kind: "boughtCategory", has: true, categories: [SHOES] }, { kind: "rfm", groups: ["VIP"] }] },
    ]);
    expect(needs).toEqual({ rfm: true, products: [MUG, TEA], categories: [SHOES], deals: true, support: false, reviews: false, subscriptions: false, sms: false, clicks: false, fields: [] });
    expect(segmentNeeds([{ match: "all", conditions: [{ kind: "orders", op: "atLeast", value: 1 }] }])).toEqual({
      rfm: false,
      products: [],
      categories: [],
      deals: false,
      support: false,
      reviews: false,
      subscriptions: false,
      sms: false,
      clicks: false,
      fields: [],
    });
  });
});

describe("the rule builder's list of conditions (E3.6)", () => {
  it("puts every condition in one group, with words in both languages", () => {
    const grouped = CONDITION_GROUPS.flatMap((g) => g.kinds);
    expect([...grouped].sort()).toEqual((Object.keys(CONDITION_KIND_WORDS) as ConditionKind[]).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const g of CONDITION_GROUPS) expect(marketingNb.editor.groups[g.id]).toBeTruthy();
    for (const kind of grouped) expect([kind, Boolean(marketingEn.kinds[kind] && marketingNb.kinds[kind])]).toEqual([kind, true]);
  });

  it("offers a condition behind a feature only while it is on", () => {
    const off = { rfmReady: false, deals: false, reviews: false, subscriptions: false, sms: false };
    expect(CONDITION_GROUPS.flatMap((g) => g.kinds).filter((k) => !conditionOffered(k, off)).sort()).toEqual(["deal", "field", "review", "rfm", "sms", "subscription"]);
    expect(conditionOffered("deal", { ...off, deals: true })).toBe(true);
    expect(conditionOffered("field", { ...off, fields: true })).toBe(true);
    expect(conditionOffered("bought", off)).toBe(true);
    expect(conditionOffered("support", off)).toBe(true);
  });
});

describe("the AI manager's segment tools (E3.6)", () => {
  it("take every condition the editor offers, as the editor's own rules", () => {
    const input = OWNER_TOOLS_BY_NAME.count_segment.input;
    for (const kind of NEW_KINDS) {
      const c = newCondition(kind);
      expect([kind, input.safeParse({ rules: { match: "all", conditions: [c.kind === "bought" ? { ...c, products: [MUG] } : c.kind === "boughtCategory" ? { ...c, categories: [MUG] } : c] } }).success]).toEqual([kind, true]);
    }
    expect(input.safeParse({ rules: { match: "all", conditions: [{ kind: "lastOrder", op: "within" }] } }).success).toBe(false);
  });
});

describe("email engagement (M2.4)", () => {
  it("holds who pressed a link in the last days, who has not within the clicks kept, and nobody where it was not read", async () => {
    const { holds } = await import("./segments");
    expect(holds({ kind: "clicked", op: "within", days: 30 }, person({ lastClickAt: daysAgo(10) }), today)).toBe(true);
    expect(holds({ kind: "clicked", op: "within", days: 5 }, person({ lastClickAt: daysAgo(10) }), today)).toBe(false);
    expect(holds({ kind: "clicked", op: "never" }, person({ lastClickAt: null }), today)).toBe(true);
    expect(holds({ kind: "clicked", op: "never" }, person({ lastClickAt: daysAgo(10) }), today)).toBe(false);
    expect(holds({ kind: "clicked", op: "never" }, person(), today)).toBe(false);
  });

  it("keeps the days it says in step with the clicks kept, asks for days only with within, and reads clicks only when asked", async () => {
    const { SEGMENT_CLICK_DAYS, segmentRulesSchema, segmentNeeds } = await import("./segments");
    const { CLICK_DAYS } = await import("./email-clicks");
    expect(SEGMENT_CLICK_DAYS).toBe(CLICK_DAYS);
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "clicked", op: "within" }] }).success).toBe(false);
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "clicked", op: "never" }] }).success).toBe(true);
    expect(segmentNeeds([{ match: "all", conditions: [{ kind: "clicked", op: "never" }] }]).clicks).toBe(true);
    expect(segmentNeeds([{ match: "all", conditions: [{ kind: "orders", op: "atLeast", value: 1 }] }]).clicks).toBe(false);
  });
});

describe("customer fields marked for marketing (M2.4)", () => {
  it("hold on what a field says, or whether it is filled in, and for nobody where fields were not read", async () => {
    const { holds, segmentNeeds, segmentRulesSchema } = await import("./segments");
    const p = person({ fields: { tier: ["gold"], note: [] } });
    expect(holds({ kind: "field", field: "tier", op: "is", value: "Gold" }, p, today)).toBe(true);
    expect(holds({ kind: "field", field: "tier", op: "isNot", value: "gold" }, p, today)).toBe(false);
    expect(holds({ kind: "field", field: "tier", op: "filled" }, p, today)).toBe(true);
    expect(holds({ kind: "field", field: "note", op: "empty" }, p, today)).toBe(true);
    expect(holds({ kind: "field", field: "gone", op: "empty" }, p, today)).toBe(true);
    expect(holds({ kind: "field", field: "tier", op: "filled" }, person(), today)).toBe(false);
    expect(segmentNeeds([{ match: "all", conditions: [{ kind: "field", field: "tier", op: "filled" }, { kind: "field", field: "tier", op: "empty" }] }]).fields).toEqual(["tier"]);
    expect(segmentRulesSchema.safeParse({ match: "all", conditions: [{ kind: "field", field: "tier", op: "is" }] }).success).toBe(false);
  });
});
