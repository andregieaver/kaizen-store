import { describe, expect, it } from "vitest";

import { EVAL_CASES, scoreCase } from "./query-eval";
import {
  cleanFilters,
  hasFilters,
  parseModelJson,
  plainFilters,
  understandingMessages,
  worthUnderstanding,
  type UnderstandingContext,
} from "./query-understanding";

const context: UnderstandingContext = {
  locale: "nb-NO",
  currency: "NOK",
  currencyDigits: 2,
  categories: [
    { slug: "belysning", name: "Belysning" },
    { slug: "papir", name: "Papir" },
  ],
  tags: [{ slug: "nyhet", name: "Nyhet" }],
};

describe("query understanding (D75)", () => {
  it("asks the model only about searches that may hold more than words", () => {
    expect(worthUnderstanding("kopp")).toBe(false);
    expect(worthUnderstanding("keramikk kopp")).toBe(false);
    expect(worthUnderstanding("billig kopp")).toBe(true);
    expect(worthUnderstanding("kopp 200")).toBe(true);
    expect(worthUnderstanding("lamp €50")).toBe(true);
    expect(worthUnderstanding("hvit keramikk kopp")).toBe(true);
    expect(worthUnderstanding("   ")).toBe(false);
  });

  it("reads the JSON in a reply, fenced or not", () => {
    expect(parseModelJson('```json\n{"text": "lampe"}\n```')).toEqual({ text: "lampe" });
    expect(parseModelJson('Here: {"a": 1} done')).toEqual({ a: 1 });
    expect(parseModelJson("no json")).toBeNull();
    expect(parseModelJson("{broken")).toBeNull();
  });

  it("keeps only what the store has, prices in minor units, and the shopper's own words", () => {
    const filters = cleanFilters(
      {
        text: "lampe billig messing",
        categories: ["belysning", "BELYSNING", "hagemøbler"],
        tags: ["nyhet", "salg"],
        minPrice: 900,
        maxPrice: 100.5,
        kind: "spaceship",
        inStock: "yes",
        sort: "priceLow",
      },
      "billig lampe under 900 kr",
      context,
    );
    // "inStock" as a string is not the right shape.
    expect(filters).toBeNull();

    expect(
      cleanFilters(
        { text: "lampe messing", categories: ["belysning", "BELYSNING", "hagemøbler"], tags: ["nyhet", "salg"], minPrice: 900, maxPrice: 100.5, kind: "spaceship", sort: "cheapest" },
        "billig lampe under 900 kr",
        context,
      ),
    ).toEqual({
      // "messing" was not typed, so it is dropped.
      text: "lampe",
      categories: ["belysning"],
      tags: ["nyhet"],
      // A reversed range is put right.
      minPriceMinor: 10050,
      maxPriceMinor: 90000,
      kind: null,
      inStock: false,
      sort: "relevance",
    });
    expect(cleanFilters({ minPrice: -5, maxPrice: 1e12, kind: "stay" }, "hytte", context)).toMatchObject({
      text: "hytte",
      minPriceMinor: null,
      maxPriceMinor: null,
      kind: "stay",
    });
    expect(cleanFilters("not an object", "kopp", context)).toBeNull();
  });

  it("says whether filters change the search", () => {
    expect(hasFilters(plainFilters("Kopp"))).toBe(false);
    expect(plainFilters(" Kopp ").text).toBe("kopp");
    expect(hasFilters({ ...plainFilters("kopp"), sort: "priceLow" })).toBe(true);
    expect(hasFilters({ ...plainFilters("kopp"), maxPriceMinor: 100 })).toBe(true);
  });

  it("tells the model the store's categories and tags, and the currency", () => {
    const [system, user] = understandingMessages("  Lampe under 500 KR ", context);
    expect(system.content).toContain("belysning (Belysning), papir (Papir)");
    expect(system.content).toContain("nyhet (Nyhet)");
    expect(system.content).toContain("amounts in NOK");
    expect(user).toEqual({ role: "user", content: "lampe under 500 kr" });
  });

  it("scores the eval: every filter a case does not name must be empty, and any reading it accepts passes", () => {
    const lamp = EVAL_CASES.find((c) => c.query === "lampe under 500 kr")!;
    const answer = { ...plainFilters("lampe"), maxPriceMinor: 50000 };
    expect(scoreCase(lamp, answer)).toEqual({ pass: true, problems: [] });
    expect(scoreCase(lamp, { ...answer, text: "", categories: ["belysning"] }).pass).toBe(true);
    const invented = scoreCase(lamp, { ...answer, tags: ["nyhet"] });
    expect(invented.pass).toBe(false);
    expect(invented.problems[0]).toMatch(/tags/);
    expect(scoreCase(lamp, { ...answer, text: "lampe 500 kr" }).problems).toEqual(['text "lampe 500 kr" keeps "500"', 'text "lampe 500 kr" keeps "kr"']);
  });

  it("has an eval whose every case can pass, with words the shopper typed", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
    for (const testCase of EVAL_CASES) {
      for (const expected of testCase.accept) {
        const typed = new Set(plainFilters(testCase.query).text.split(" "));
        for (const word of expected.textHas ?? []) expect(typed.has(word), `${testCase.query}: ${word}`).toBe(true);
        for (const slug of expected.categories ?? []) expect(testCase.context.categories.map((c) => c.slug)).toContain(slug);
        for (const slug of expected.tags ?? []) expect(testCase.context.tags.map((c) => c.slug)).toContain(slug);
      }
    }
  });
});
