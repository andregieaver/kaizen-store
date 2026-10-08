import { describe, expect, it } from "vitest";

import { toRates } from "./currency";
import { pageKnowledgeText } from "./knowledge";
import { newPageContent, pageExcerpt, pageInput, type PageBlock, type PageRow } from "./page-content";
import { sanitizeTemplate } from "./template-content";
import {
  CONDITIONAL_PARTS_MAX,
  KAIZEN_FACTS,
  conditionHolds,
  displayFactsProblem,
  displaysProblem,
  factsOffered,
  keepRuleIds,
  localClock,
  pageRuleIds,
  publicRows,
  ruleIds,
  showSchema,
  showsFor,
  withoutRuleIds,
  type Condition,
  type Show,
  type VisitorFacts,
} from "./visibility";

/**
 * Who sees a part (D179 phase 4, `docs/responsive-editing.md` 6): the rules' shapes, how each fact and operator holds,
 * time in the store's time zone across daylight saving, cart values compared in minor units across currencies, OR between
 * groups and AND within, the limits, and the ids a rule names cleaned when a part crosses to another store.
 */

const TIER = "11111111-1111-4111-8111-111111111111";
const TIER2 = "22222222-2222-4222-8222-222222222222";
const COMPANY = "33333333-3333-4333-8333-333333333333";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const CATEGORY = "55555555-5555-4555-8555-555555555555";

const guest: VisitorFacts = {
  signedIn: false,
  tierIds: [],
  company: { id: null },
  buyer: "private",
  boughtBefore: false,
  country: "NO",
  language: "nb",
  currency: "NOK",
  now: new Date("2026-10-08T10:00:00Z"),
  timeZone: "Europe/Oslo",
  cart: { minor: 0, currency: "NOK", products: [], categories: [] },
  rates: toRates([{ currency: "NOK", rate: 11.5, roundTo: 1 }]),
  query: {},
};
const member: VisitorFacts = {
  ...guest,
  signedIn: true,
  tierIds: [TIER],
  company: { id: COMPANY },
  buyer: "business",
  boughtBefore: true,
  cart: { minor: 50_000, currency: "NOK", products: [PRODUCT], categories: [CATEGORY] },
};
/** Kaizen's own pages: no store's facts at all. */
const kaizen: VisitorFacts = {
  ...guest,
  tierIds: null,
  company: null,
  buyer: null,
  boughtBefore: null,
  country: null,
  currency: null,
  cart: null,
  rates: null,
  language: "en",
  query: null,
};

const holds = (c: Condition, facts: VisitorFacts) => conditionHolds(showSchemaCondition(c), facts);
/** A condition as the schema reads it (so tests use only shapes that are saved). */
function showSchemaCondition(c: Condition): Condition {
  const parsed = showSchema.parse({ rules: [[c]] });
  return (parsed as { rules: Condition[][] }).rules[0][0];
}

describe("the shapes of a display", () => {
  it("takes the four plain displays and conditional logic, and refuses anything else", () => {
    for (const plain of ["always", "never", "signedIn", "signedOut"]) expect(showSchema.safeParse(plain).success).toBe(true);
    expect(showSchema.safeParse("sometimes").success).toBe(false);
    expect(showSchema.safeParse({ rules: [] }).success).toBe(false);
    expect(showSchema.safeParse({ rules: [[]] }).success).toBe(false);
    expect(showSchema.safeParse({ rules: [[{ fact: "mood", op: "is", value: true }]] }).success).toBe(false);
    expect(showSchema.safeParse({ rules: [[{ fact: "signedIn", op: "in", value: true }]] }).success).toBe(false);
  });

  it("refuses conditions that cannot mean anything", () => {
    const bad: unknown[] = [
      { fact: "date", op: "between", value: {} },
      { fact: "date", op: "between", value: { from: "2026-10-09T00:00", to: "2026-10-08T00:00" } },
      { fact: "date", op: "between", value: { from: "2026-13-01T00:00" } },
      { fact: "hour", op: "between", value: { from: "09:00", to: "09:00" } },
      { fact: "hour", op: "between", value: { from: "24:00", to: "09:00" } },
      { fact: "cartValue", op: "gte", value: { currency: "NOK" } },
      { fact: "cartValue", op: "between", value: { currency: "NOK", min: 500, max: 100 } },
      { fact: "cartValue", op: "gte", value: { currency: "nok", min: 1 } },
      { fact: "query", op: "is", value: { name: "utm" } },
      { fact: "query", op: "exists", value: { name: "a b" } },
      { fact: "company", op: "is", value: [COMPANY] },
      { fact: "company", op: "in", value: true },
      { fact: "customerGroup", op: "in", value: ["not-an-id"] },
      { fact: "country", op: "in", value: [] },
      { fact: "country", op: "in", value: ["no"] },
      { fact: "weekday", op: "in", value: [8] },
    ];
    for (const c of bad) expect(showSchema.safeParse({ rules: [[c]] }).success, JSON.stringify(c)).toBe(false);
  });

  it("keeps a condition that chooses no ids (one deleted since), and limits groups, conditions and choices", () => {
    expect(showSchema.safeParse({ rules: [[{ fact: "cartProduct", op: "in", value: [] }]] }).success).toBe(true);
    const one = { fact: "signedIn", op: "is", value: true };
    expect(showSchema.safeParse({ rules: Array.from({ length: 11 }, () => [one]) }).success).toBe(false);
    expect(showSchema.safeParse({ rules: [Array.from({ length: 11 }, () => one)] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(showSchema.safeParse({ rules: [[{ fact: "cartProduct", op: "in", value: many }]] }).success).toBe(false);
  });

  it("stores Always as nothing and keeps the rest with the size visibility", () => {
    const block = (visibility: unknown): PageBlock =>
      pageInput.parse({ ...newPageContent(), title: "T", slug: "t", rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "b", type: "separator", visibility }] }] }] }).rows[0].columns[0].blocks[0];
    expect(block({ show: "always" }).visibility).toBeUndefined();
    expect(block({ show: "always", hideAt: ["sm"] }).visibility).toEqual({ hideAt: ["sm"] });
    expect(block({ show: "signedOut", hideAt: ["sm"] }).visibility).toEqual({ hideAt: ["sm"], show: "signedOut" });
    const rules: Show = { rules: [[{ fact: "weekday", op: "in", value: [6, 7] }]] };
    expect(block({ show: rules }).visibility).toEqual({ show: rules });
  });
});

describe("whether a part shows", () => {
  it("always, never, signed in and signed out", () => {
    expect(showsFor(undefined, guest)).toBe(true);
    expect(showsFor("always", guest)).toBe(true);
    expect(showsFor("never", member)).toBe(false);
    expect(showsFor("signedIn", guest)).toBe(false);
    expect(showsFor("signedIn", member)).toBe(true);
    expect(showsFor("signedOut", guest)).toBe(true);
    expect(showsFor("signedOut", member)).toBe(false);
  });

  it("OR between groups, AND within one", () => {
    const signedIn: Condition = { fact: "signedIn", op: "is", value: true };
    const norway: Condition = { fact: "country", op: "in", value: ["NO"] };
    const sweden: Condition = { fact: "country", op: "in", value: ["SE"] };
    expect(showsFor({ rules: [[signedIn, norway]] }, member)).toBe(true);
    expect(showsFor({ rules: [[signedIn, sweden]] }, member)).toBe(false);
    expect(showsFor({ rules: [[signedIn, sweden], [norway]] }, guest)).toBe(true);
    expect(showsFor({ rules: [[signedIn], [sweden]] }, guest)).toBe(false);
  });
});

describe("each fact and operator", () => {
  it("the visitor: sign-in, groups, company, buyer, bought before", () => {
    expect(holds({ fact: "signedIn", op: "is", value: false }, guest)).toBe(true);
    expect(holds({ fact: "customerGroup", op: "in", value: [TIER, TIER2] }, member)).toBe(true);
    expect(holds({ fact: "customerGroup", op: "in", value: [TIER2] }, member)).toBe(false);
    expect(holds({ fact: "customerGroup", op: "notIn", value: [TIER] }, member)).toBe(false);
    // A guest is in no group.
    expect(holds({ fact: "customerGroup", op: "in", value: [TIER] }, guest)).toBe(false);
    expect(holds({ fact: "customerGroup", op: "notIn", value: [TIER] }, guest)).toBe(true);
    expect(holds({ fact: "company", op: "is", value: true }, member)).toBe(true);
    expect(holds({ fact: "company", op: "is", value: false }, guest)).toBe(true);
    expect(holds({ fact: "company", op: "in", value: [COMPANY] }, member)).toBe(true);
    expect(holds({ fact: "company", op: "notIn", value: [COMPANY] }, member)).toBe(false);
    expect(holds({ fact: "company", op: "notIn", value: [COMPANY] }, guest)).toBe(true);
    expect(holds({ fact: "buyer", op: "is", value: "business" }, member)).toBe(true);
    expect(holds({ fact: "buyer", op: "isNot", value: "business" }, member)).toBe(false);
    expect(holds({ fact: "buyer", op: "is", value: "private" }, guest)).toBe(true);
    expect(holds({ fact: "boughtBefore", op: "is", value: true }, member)).toBe(true);
    expect(holds({ fact: "boughtBefore", op: "is", value: true }, guest)).toBe(false);
  });

  it("place and language", () => {
    expect(holds({ fact: "country", op: "in", value: ["NO", "SE"] }, guest)).toBe(true);
    expect(holds({ fact: "country", op: "notIn", value: ["NO"] }, guest)).toBe(false);
    expect(holds({ fact: "language", op: "in", value: ["en"] }, guest)).toBe(false);
    expect(holds({ fact: "language", op: "notIn", value: ["en"] }, guest)).toBe(true);
    expect(holds({ fact: "currency", op: "in", value: ["EUR"] }, { ...guest, currency: "EUR" })).toBe(true);
  });

  it("a fact a place does not have never holds, whatever the operator (Kaizen's pages)", () => {
    const store: Condition[] = [
      { fact: "customerGroup", op: "notIn", value: [TIER] },
      { fact: "company", op: "is", value: false },
      { fact: "buyer", op: "isNot", value: "business" },
      { fact: "boughtBefore", op: "is", value: false },
      { fact: "country", op: "notIn", value: ["NO"] },
      { fact: "currency", op: "notIn", value: ["NOK"] },
      { fact: "cartValue", op: "lte", value: { currency: "NOK", max: 100 } },
      { fact: "cartProduct", op: "notIn", value: [PRODUCT] },
      { fact: "cartCategory", op: "notIn", value: [CATEGORY] },
      { fact: "query", op: "notExists", value: { name: "x" } },
    ];
    for (const c of store) expect(holds(c, kaizen), c.fact).toBe(false);
    expect(holds({ fact: "language", op: "in", value: ["en"] }, kaizen)).toBe(true);
  });

  it("the cart: products and categories", () => {
    expect(holds({ fact: "cartProduct", op: "in", value: [PRODUCT] }, member)).toBe(true);
    expect(holds({ fact: "cartProduct", op: "notIn", value: [PRODUCT] }, member)).toBe(false);
    expect(holds({ fact: "cartProduct", op: "notIn", value: [PRODUCT] }, guest)).toBe(true);
    expect(holds({ fact: "cartCategory", op: "in", value: [CATEGORY] }, member)).toBe(true);
    // Nothing chosen (the product was deleted): "is one of" holds for nobody, "is none of" for everybody.
    expect(holds({ fact: "cartProduct", op: "in", value: [] }, member)).toBe(false);
    expect(holds({ fact: "cartProduct", op: "notIn", value: [] }, member)).toBe(true);
  });

  it("the address's parameters", () => {
    const facts = { ...guest, query: { utm_campaign: "Spring-Sale", tag: ["a", "b"], empty: "" } };
    expect(holds({ fact: "query", op: "exists", value: { name: "empty" } }, facts)).toBe(true);
    expect(holds({ fact: "query", op: "notExists", value: { name: "ref" } }, facts)).toBe(true);
    expect(holds({ fact: "query", op: "is", value: { name: "utm_campaign", text: "Spring-Sale" } }, facts)).toBe(true);
    expect(holds({ fact: "query", op: "is", value: { name: "utm_campaign", text: "spring-sale" } }, facts)).toBe(false);
    expect(holds({ fact: "query", op: "isNot", value: { name: "utm_campaign", text: "x" } }, facts)).toBe(true);
    expect(holds({ fact: "query", op: "contains", value: { name: "utm_campaign", text: "sale" } }, facts)).toBe(true);
    expect(holds({ fact: "query", op: "is", value: { name: "tag", text: "b" } }, facts)).toBe(true);
  });
});

describe("time, in the store's time zone", () => {
  const at = (iso: string, timeZone = "Europe/Oslo") => ({ ...guest, now: new Date(iso), timeZone });

  it("reads the local date, time and day of the week", () => {
    expect(localClock(new Date("2026-10-08T10:00:00Z"), "Europe/Oslo")).toEqual({ stamp: "2026-10-08T12:00", time: "12:00", weekday: 4 });
    // 22:30 on a Thursday in UTC is half past midnight on Friday in Oslo.
    expect(localClock(new Date("2026-10-08T22:30:00Z"), "Europe/Oslo").weekday).toBe(5);
    expect(localClock(new Date("2026-10-08T22:30:00Z"), "UTC").weekday).toBe(4);
    expect(localClock(new Date("2026-10-08T23:30:00Z"), "Europe/Oslo").time).toBe("01:30");
  });

  it("a date span: from inclusive, until exclusive, either end open", () => {
    const span: Condition = { fact: "date", op: "between", value: { from: "2026-10-08T12:00", to: "2026-10-09T00:00" } };
    expect(holds(span, at("2026-10-08T09:59:59Z"))).toBe(false);
    expect(holds(span, at("2026-10-08T10:00:00Z"))).toBe(true);
    expect(holds(span, at("2026-10-08T21:59:00Z"))).toBe(true);
    expect(holds(span, at("2026-10-08T22:00:00Z"))).toBe(false);
    expect(holds({ fact: "date", op: "between", value: { from: "2026-10-08T12:00" } }, at("2030-01-01T00:00:00Z"))).toBe(true);
    expect(holds({ fact: "date", op: "between", value: { to: "2026-10-08T12:00" } }, at("2026-10-08T10:00:00Z"))).toBe(false);
    // The same moment in another store's time zone.
    expect(holds(span, at("2026-10-08T10:00:00Z", "America/New_York"))).toBe(false);
  });

  it("daylight saving: the hour that does not exist and the hour that happens twice", () => {
    const night: Condition = { fact: "hour", op: "between", value: { from: "02:00", to: "03:00" } };
    // 29 March 2026: Oslo's clocks go from 02:00 to 03:00, so no moment is in 02:00–03:00.
    expect(localClock(new Date("2026-03-29T00:59:00Z"), "Europe/Oslo").time).toBe("01:59");
    expect(localClock(new Date("2026-03-29T01:00:00Z"), "Europe/Oslo").time).toBe("03:00");
    expect(holds(night, at("2026-03-29T00:59:00Z"))).toBe(false);
    expect(holds(night, at("2026-03-29T01:00:00Z"))).toBe(false);
    // 25 October 2026: 02:00–03:00 happens twice (CEST, then CET), and both are in it.
    expect(holds(night, at("2026-10-25T00:30:00Z"))).toBe(true);
    expect(holds(night, at("2026-10-25T01:30:00Z"))).toBe(true);
    expect(holds(night, at("2026-10-25T02:00:00Z"))).toBe(false);
    // A date span ending at 03:00 local on the change day ends at the right UTC moment.
    const until: Condition = { fact: "date", op: "between", value: { to: "2026-03-29T03:00" } };
    expect(holds(until, at("2026-03-29T00:59:00Z"))).toBe(true);
    expect(holds(until, at("2026-03-29T01:00:00Z"))).toBe(false);
  });

  it("hours of the day, over midnight too, and days of the week", () => {
    const work: Condition = { fact: "hour", op: "between", value: { from: "09:00", to: "17:00" } };
    expect(holds(work, at("2026-10-08T06:59:00Z"))).toBe(false);
    expect(holds(work, at("2026-10-08T07:00:00Z"))).toBe(true);
    expect(holds(work, at("2026-10-08T14:59:00Z"))).toBe(true);
    expect(holds(work, at("2026-10-08T15:00:00Z"))).toBe(false);
    const late: Condition = { fact: "hour", op: "between", value: { from: "22:00", to: "06:00" } };
    expect(holds(late, at("2026-10-08T20:00:00Z"))).toBe(true);
    expect(holds(late, at("2026-10-08T03:59:00Z"))).toBe(true);
    expect(holds(late, at("2026-10-08T04:00:00Z"))).toBe(false);
    const weekend: Condition = { fact: "weekday", op: "in", value: [6, 7] };
    expect(holds(weekend, at("2026-10-10T12:00:00Z"))).toBe(true);
    expect(holds(weekend, at("2026-10-09T21:59:00Z"))).toBe(false);
    expect(holds(weekend, at("2026-10-09T22:00:00Z"))).toBe(true);
    expect(holds({ fact: "weekday", op: "notIn", value: [6, 7] }, at("2026-10-09T22:00:00Z"))).toBe(false);
  });
});

describe("the cart's value, in minor units", () => {
  const cart = (minor: number, currency = "NOK") => ({ ...guest, currency, cart: { minor, currency, products: [], categories: [] } });

  it("at least, at most and between, at their edges", () => {
    const atLeast: Condition = { fact: "cartValue", op: "gte", value: { currency: "NOK", min: 50_000 } };
    expect(holds(atLeast, cart(49_999))).toBe(false);
    expect(holds(atLeast, cart(50_000))).toBe(true);
    const atMost: Condition = { fact: "cartValue", op: "lte", value: { currency: "NOK", max: 50_000 } };
    expect(holds(atMost, cart(50_000))).toBe(true);
    expect(holds(atMost, cart(50_001))).toBe(false);
    const between: Condition = { fact: "cartValue", op: "between", value: { currency: "NOK", min: 100, max: 200 } };
    expect(holds(between, cart(99))).toBe(false);
    expect(holds(between, cart(100))).toBe(true);
    expect(holds(between, cart(200))).toBe(true);
    expect(holds(between, cart(201))).toBe(false);
    // An empty cart is worth nothing.
    expect(holds({ fact: "cartValue", op: "lte", value: { currency: "NOK", max: 0 } }, guest)).toBe(true);
  });

  it("an amount in another currency is compared at the store's rates, unrounded; without a rate it never holds", () => {
    // 500 NOK at 11.5 NOK to the euro is 43.478… EUR: 4348 euro cents is above it, 4347 below.
    const nok: Condition = { fact: "cartValue", op: "gte", value: { currency: "NOK", min: 50_000 } };
    expect(holds(nok, cart(4348, "EUR"))).toBe(true);
    expect(holds(nok, cart(4347, "EUR"))).toBe(false);
    // 50 EUR is 575 NOK.
    const eur: Condition = { fact: "cartValue", op: "gte", value: { currency: "EUR", min: 5000 } };
    expect(holds(eur, cart(57_500))).toBe(true);
    expect(holds(eur, cart(57_499))).toBe(false);
    // A currency with no rate (the zloty has none here), and one Kaizen does not know.
    expect(holds({ fact: "cartValue", op: "gte", value: { currency: "PLN", min: 0 } }, cart(10))).toBe(false);
    expect(holds({ fact: "cartValue", op: "gte", value: { currency: "XYZ", min: 0 } }, cart(10))).toBe(false);
    // Between two currencies that both have rates, neither the euro.
    const sek = { ...cart(10_000, "SEK"), rates: toRates([{ currency: "SEK", rate: 11, roundTo: 1 }, { currency: "DKK", rate: 7.5, roundTo: 100 }]) };
    // 10 000 öre is 100 SEK, 68.18… DKK: 6 818 øre is below it, 6 819 above (the DKK step of 100 rounds prices, not a threshold).
    expect(holds({ fact: "cartValue", op: "gte", value: { currency: "DKK", min: 6818 } }, sek)).toBe(true);
    expect(holds({ fact: "cartValue", op: "gte", value: { currency: "DKK", min: 6819 } }, sek)).toBe(false);
  });
});

describe("limits and parts that are always shown", () => {
  const rowWith = (blocks: PageBlock[], extra: Partial<PageRow> = {}): PageRow => ({ id: `r-${blocks[0]?.id ?? "x"}`, type: "row", layout: "1", columns: [{ id: `c-${blocks[0]?.id ?? "x"}`, blocks }], ...extra });
  const separator = (id: string, show?: Show): PageBlock => ({ id, type: "separator", ...(show && { visibility: { show } }) }) as PageBlock;

  it(`takes at most ${CONDITIONAL_PARTS_MAX} parts checked per request; Never is not one`, () => {
    const parts = (n: number, show: Show) => Array.from({ length: n }, (_, i) => separator(`b${i}`, show));
    expect(displaysProblem([rowWith(parts(CONDITIONAL_PARTS_MAX, "signedIn"))])).toBeNull();
    expect(displaysProblem([rowWith(parts(CONDITIONAL_PARTS_MAX + 1, "signedIn"))])).toMatch(/at most 30/);
    expect(displaysProblem([rowWith(parts(CONDITIONAL_PARTS_MAX + 1, "never"))])).toBeNull();
    // pageInput holds it.
    const page = { ...newPageContent(), title: "T", slug: "t", rows: [rowWith(parts(CONDITIONAL_PARTS_MAX + 1, { rules: [[{ fact: "signedIn", op: "is", value: true }]] }))] };
    expect(pageInput.safeParse(page).success).toBe(false);
  });

  it("never hides the checkout's payment form, terms or the whole checkout, nor the row and column around them, nor the withdrawal link", () => {
    for (const part of ["checkout", "checkout_payment", "checkout_terms"]) {
      const pay = { id: "pay", type: "storePart", part } as PageBlock;
      expect(displaysProblem([rowWith([{ ...pay, visibility: { show: "signedIn" } } as PageBlock])])).toMatch(/always shown/);
      expect(displaysProblem([rowWith([pay], { visibility: { show: "never" } })])).toMatch(/always shown/);
    }
    const totals = { id: "t", type: "storePart", part: "checkout_totals", visibility: { show: "signedIn" } } as PageBlock;
    expect(displaysProblem([rowWith([totals])])).toBeNull();
    const withdrawal = { id: "w", type: "site", part: "withdrawal", visibility: { show: "signedOut" } } as PageBlock;
    expect(displaysProblem([rowWith([withdrawal])])).toMatch(/withdrawal/);
  });

  it("Kaizen's pages ask only sign-in, language, time and address; a header or footer never the address", () => {
    expect(factsOffered("kaizen", "page")).toEqual([...KAIZEN_FACTS]);
    expect(factsOffered("store", "header")).not.toContain("query");
    expect(factsOffered("store", "page")).toContain("query");
    const cartRule = [rowWith([separator("a", { rules: [[{ fact: "cartValue", op: "gte", value: { currency: "NOK", min: 1 } }]] })])];
    expect(displayFactsProblem(cartRule, "kaizen", "page")).toMatch(/Kaizen/);
    expect(displayFactsProblem(cartRule, "store", "page")).toBeNull();
    const queryRule = [rowWith([separator("q", { rules: [[{ fact: "query", op: "exists", value: { name: "x" } }]] })])];
    expect(displayFactsProblem(queryRule, "store", "footer")).toMatch(/Address parameters/);
    expect(displayFactsProblem(queryRule, "kaizen", "page")).toBeNull();
  });
});

describe("the ids a rule names", () => {
  const rules: Show = {
    rules: [
      [
        { fact: "customerGroup", op: "in", value: [TIER, TIER2] },
        { fact: "company", op: "notIn", value: [COMPANY] },
      ],
      [
        { fact: "cartProduct", op: "in", value: [PRODUCT] },
        { fact: "cartCategory", op: "notIn", value: [CATEGORY] },
        { fact: "company", op: "is", value: true },
        { fact: "weekday", op: "in", value: [1] },
      ],
    ],
  };

  it("are found by kind, and kept only where the store has them", () => {
    expect(ruleIds(rules)).toEqual({ tier: [TIER, TIER2], company: [COMPANY], product: [PRODUCT], category: [CATEGORY] });
    const kept = keepRuleIds(rules, (kind, id) => kind !== "tier" || id === TIER) as { rules: Condition[][] };
    expect(kept.rules[0][0].value).toEqual([TIER]);
    expect(kept.rules[1][3].value).toEqual([1]);
    expect(kept.rules[1][2].value).toBe(true);
    expect(keepRuleIds("signedIn", () => false)).toBe("signedIn");
  });

  it("go when a part crosses to another store as a template; the rest of the display stays", () => {
    const block = { id: "b", type: "separator", visibility: { hideAt: ["sm"], show: rules } } as PageBlock;
    const row: PageRow = { id: "r", type: "row", layout: "1", visibility: { show: "signedIn" }, columns: [{ id: "c", blocks: [block], visibility: { show: rules } }] };
    const from = { id: null, slug: "other", hosts: [] };
    const copied = sanitizeTemplate("row", row, from) as PageRow;
    expect(copied.visibility).toEqual({ show: "signedIn" });
    expect(pageRuleIds([copied])).toEqual({ tier: [], company: [], product: [], category: [] });
    const shown = copied.columns[0].blocks[0].visibility!;
    expect(shown.hideAt).toEqual(["sm"]);
    const cleaned = shown.show as { rules: Condition[][] };
    // The conditions stay, choosing nothing: a part never starts showing because its rule was cut.
    expect(cleaned.rules[0][0]).toEqual({ fact: "customerGroup", op: "in", value: [] });
    expect(cleaned.rules[1][3]).toEqual({ fact: "weekday", op: "in", value: [1] });
    // A whole page layout, a column and a component alone too.
    expect(pageRuleIds([(sanitizeTemplate("page", { pageType: "page", rows: [row], css: "" }, from) as { rows: PageRow[] }).rows[0]]).tier).toEqual([]);
    expect(pageRuleIds([{ ...row, columns: [sanitizeTemplate("column", row.columns[0], from) as PageRow["columns"][0]] }]).tier).toEqual([]);
    expect(ruleIds((withoutRuleIds(block).visibility!.show))).toEqual({ tier: [], company: [], product: [], category: [] });
  });
});

describe("what anyone may read of a page", () => {
  const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const text = (id: string, words: string, show?: Show) => ({ id, type: "richText", doc: doc(words), ...(show && { visibility: { show } }) }) as PageBlock;
  const rows: PageRow[] = [
    { id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [text("a", "For everyone."), text("b", "Sign in for more.", "signedOut"), text("c", "Members' secret.", "signedIn")] }] },
    { id: "r2", type: "row", layout: "1", visibility: { show: "never" }, columns: [{ id: "c2", blocks: [text("d", "A draft never shown.")] }] },
    { id: "r3", type: "row", layout: "1", columns: [{ id: "c3", visibility: { show: { rules: [[{ fact: "customerGroup", op: "in", value: [TIER] }]] } }, blocks: [text("e", "VIP prices.")] }] },
  ];

  it("leaves out parts never shown, shown to signed-in or signed-out visitors or by conditions, from the description and the chat agent's knowledge", () => {
    expect(publicRows(rows).flatMap((r) => r.columns.flatMap((c) => c.blocks.map((b) => b.id)))).toEqual(["a"]);
    const excerpt = pageExcerpt({ rows });
    expect(excerpt).toContain("For everyone.");
    for (const hidden of ["Sign in", "Members", "draft", "VIP"]) expect(excerpt).not.toContain(hidden);
    const knowledge = pageKnowledgeText({ title: "T", rows });
    expect(knowledge).toContain("For everyone.");
    for (const hidden of ["Members", "draft", "VIP"]) expect(knowledge).not.toContain(hidden);
  });
});
