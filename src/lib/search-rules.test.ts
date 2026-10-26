import { describe, expect, it } from "vitest";

import { merchandise, readRule, ruleApplies, rulesFor, searchRedirect, type SearchRule } from "./search-rules";

/** Search merchandising (wave 6 unit F2, D324, `docs/wave-6-catalogue.md` F.2). */

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T1 = "10000000-0000-4000-8000-000000000001";

let made = 0;
const rule = (over: Partial<SearchRule>): SearchRule => ({
  id: `r${++made}`,
  action: "boost",
  productId: null,
  termId: null,
  target: null,
  queries: [],
  match: "contains",
  position: 0,
  ...over,
});

describe("which searches a rule is for", () => {
  it("holds the phrase as whole words, or is it exactly, or every search when it names none", () => {
    const contains = rule({ queries: ["red sofa"] });
    expect(ruleApplies(contains, "big Red Sofa")).toBe(true);
    expect(ruleApplies(contains, "red sofas")).toBe(false);
    expect(ruleApplies(contains, "sofa red")).toBe(false);
    const exact = rule({ queries: ["sofa"], match: "exact" });
    expect(ruleApplies(exact, " Sofa ")).toBe(true);
    expect(ruleApplies(exact, "red sofa")).toBe(false);
    expect(ruleApplies(rule({}), "anything")).toBe(true);
    expect(rulesFor([contains, exact], "sofa").map((r) => r.id)).toEqual([exact.id]);
  });

  it("sends a search on, an exact rule before one it holds", () => {
    const rules = [
      rule({ action: "redirect", target: "/category/sofas", queries: ["sofa"] }),
      rule({ action: "redirect", target: "/sale", queries: ["sofa sale"], match: "exact" }),
    ];
    expect(searchRedirect(rules, "sofa sale")).toBe("/sale");
    expect(searchRedirect(rules, "grey sofa")).toBe("/category/sofas");
    expect(searchRedirect(rules, "chair")).toBeNull();
    expect(searchRedirect([rule({ queries: ["sofa"] })], "sofa")).toBeNull();
  });
});

describe("merchandise", () => {
  const ids = [P(1), P(2), P(3), P(4), P(5)];
  const none = { inTerm: () => false, addPins: true };

  it("puts pins first in their order, then the boosted, the rest and the buried, each in the search's order", () => {
    const rules = [
      rule({ action: "pin", productId: P(4), queries: ["x"], position: 2 }),
      rule({ action: "pin", productId: P(5), queries: ["x"], position: 1 }),
      rule({ action: "boost", productId: P(3) }),
      rule({ action: "bury", productId: P(1) }),
    ];
    expect(merchandise(ids, rules, none)).toEqual([P(5), P(4), P(3), P(2), P(1)]);
  });

  it("moves a category's products, and leaves one both boosted and buried where it was", () => {
    const facts = { inTerm: (id: string, term: string) => term === T1 && (id === P(2) || id === P(4)), addPins: false };
    expect(merchandise(ids, [rule({ action: "boost", termId: T1 })], facts)).toEqual([P(2), P(4), P(1), P(3), P(5)]);
    expect(merchandise(ids, [rule({ action: "bury", termId: T1 })], facts)).toEqual([P(1), P(3), P(5), P(2), P(4)]);
    expect(merchandise(ids, [rule({ action: "boost", termId: T1 }), rule({ action: "bury", productId: P(2) })], facts)).toEqual([
      P(4),
      P(1),
      P(2),
      P(3),
      P(5),
    ]);
  });

  it("adds a pinned product the search did not find only when it may", () => {
    const pins = [rule({ action: "pin", productId: P(9), queries: ["x"] })];
    expect(merchandise(ids, pins, none)[0]).toBe(P(9));
    expect(merchandise(ids, pins, { ...none, addPins: false })).toEqual(ids);
    expect(merchandise([], [], none)).toEqual([]);
  });
});

describe("readRule", () => {
  const value = (raw: unknown) => {
    const read = readRule(raw);
    return read.ok ? read.value : read.problems;
  };

  it("keeps what each action needs and drops the rest", () => {
    expect(value({ action: "pin", productId: P(1), termId: T1, target: "/x", queries: [" Red  Sofa ", "red sofa", ""], position: 3 })).toEqual({
      id: null,
      action: "pin",
      productId: P(1),
      termId: null,
      target: null,
      queries: ["red sofa"],
      match: "contains",
      position: 3,
    });
    expect(value({ action: "boost", productId: P(1), termId: T1 })).toMatchObject({ productId: P(1), termId: null, queries: [] });
    expect(value({ action: "bury", termId: T1, position: 5 })).toMatchObject({ termId: T1, position: 0 });
    expect(value({ action: "redirect", productId: P(1), target: " /sale ", queries: ["sale"] })).toMatchObject({ productId: null, target: "/sale" });
  });

  it("says what is missing", () => {
    expect(value({ action: "pin", queries: [] })).toEqual([{ code: "queries_needed" }, { code: "product_needed" }]);
    expect(value({ action: "boost" })).toEqual([{ code: "subject_needed" }]);
    expect(value({ action: "redirect", target: " ", queries: ["sale"] })).toEqual([{ code: "target_needed" }]);
    expect(value({ action: "redirect", target: "/x", queries: ["y".repeat(101)] })).toEqual([{ code: "query", query: "y".repeat(40) }, { code: "queries_needed" }]);
    expect(value({ action: "lift" })).toEqual([{ code: "shape" }]);
  });
});
