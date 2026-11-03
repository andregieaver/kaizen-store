import { describe, expect, it } from "vitest";

import { priceWordProblem, priceWordSentence, wordsProblems, cleanWords, cleanPriceWord } from "./price-words-check";
import {
  afterAmount,
  beforeAmount,
  parseProductPriceWords,
  parseWordsByLocale,
  productWordsColumn,
  shownPriceWords,
  withWords,
  wordsIn,
  type StoreWords,
} from "./price-words";

// D429: the owner's words before and after a product's price.
const store: StoreWords = { byLocale: { "nb-NO": { prefix: "Kun", suffix: ",-" }, "sv-SE": { prefix: "", suffix: "" } }, main: "nb-NO" };

describe("the words a shopper reads around a product's price", () => {
  it("takes the language's own words, else the main language's; an empty pair of its own says none", () => {
    expect(shownPriceWords(store, { mode: "inherit" }, "nb-NO")).toEqual({ prefix: "Kun", suffix: ",-" });
    expect(shownPriceWords(store, { mode: "inherit" }, "en-GB")).toEqual({ prefix: "Kun", suffix: ",-" });
    expect(shownPriceWords(store, { mode: "inherit" }, "sv-SE")).toBeNull();
    expect(wordsIn({}, "nb-NO", "nb-NO")).toEqual({ prefix: "", suffix: "" });
  });

  it("follows a product's own choice over the store's: none, or its own by the same fallback", () => {
    expect(shownPriceWords(store, { mode: "none" }, "nb-NO")).toBeNull();
    const own = { mode: "own" as const, words: { "nb-NO": { prefix: "", suffix: " /stk " } } };
    expect(shownPriceWords(store, own, "nb-NO")).toEqual({ prefix: "", suffix: "/stk" });
    expect(shownPriceWords(store, own, "da-DK")).toEqual({ prefix: "", suffix: "/stk" });
    expect(shownPriceWords(undefined, { mode: "inherit" }, "nb-NO")).toBeNull();
  });

  it("puts a space after a word and none after a sign, and before a word but not before a sign", () => {
    expect(beforeAmount("Kun")).toBe("Kun ");
    expect(beforeAmount("ca.")).toBe("ca. ");
    expect(beforeAmount("~")).toBe("~");
    expect(beforeAmount("  ")).toBe("");
    expect(afterAmount(",-")).toBe(",-");
    expect(afterAmount("/stk")).toBe("/stk");
    expect(afterAmount("per pakke")).toBe(" per pakke");
    expect(withWords("499 kr", { prefix: "Kun", suffix: "/stk" })).toBe("Kun 499 kr/stk");
    expect(withWords("499", { prefix: "", suffix: ",-" })).toBe("499,-");
    expect(withWords("499 kr", null)).toBe("499 kr");
  });

  it("reads what the columns keep, leaving out anything else, and writes null to follow the store", () => {
    expect(parseWordsByLocale({ "nb-NO": { prefix: "Kun" }, x: "no", y: [] })).toEqual({ "nb-NO": { prefix: "Kun", suffix: "" } });
    expect(parseWordsByLocale(null)).toEqual({});
    expect(parseProductPriceWords(null)).toEqual({ mode: "inherit" });
    expect(parseProductPriceWords({ mode: "none" })).toEqual({ mode: "none" });
    expect(parseProductPriceWords({ mode: "own", words: { "nb-NO": { prefix: "a", suffix: "b" } } })).toEqual({
      mode: "own",
      words: { "nb-NO": { prefix: "a", suffix: "b" } },
    });
    expect(parseProductPriceWords({ mode: "store" })).toEqual({ mode: "inherit" });
    expect(productWordsColumn({ mode: "inherit" })).toBeNull();
    expect(productWordsColumn({ mode: "none" })).toEqual({ mode: "none" });
  });
});

describe("what an owner may write around a price", () => {
  it("takes short plain words", () => {
    for (const word of ["Kun", "Fra kun", "/stk", ",-", "per pakke", "Only", "ca.", "", "x".repeat(24)]) expect(priceWordProblem(word)).toBeNull();
  });

  it("refuses long words, tags, line breaks and percentages", () => {
    expect(priceWordProblem("x".repeat(25))).toEqual({ kind: "long", max: 24 });
    expect(priceWordProblem("<b>Kun</b>")).toEqual({ kind: "plain" });
    expect(priceWordProblem("Kun\nnå")).toEqual({ kind: "plain" });
    expect(priceWordProblem("Kun nå")).toEqual({ kind: "plain" });
    expect(priceWordProblem("-20 %")).toEqual({ kind: "percent" });
    expect(priceWordProblem("%30 off")).toEqual({ kind: "percent" });
  });

  it("refuses what the claims filter finds: best or lowest price, urgency, stock", () => {
    expect(priceWordProblem("Beste pris")).toMatchObject({ kind: "claim", claim: "bestPrice" });
    expect(priceWordProblem("Lowest price")).toMatchObject({ kind: "claim", claim: "bestPrice" });
    expect(priceWordProblem("Kun i dag")).toMatchObject({ kind: "claim", claim: "urgency" });
  });

  it("tidies spaces, keeps only the languages given, and says where a problem is", () => {
    expect(cleanPriceWord("  Fra   kun ")).toBe("Fra kun");
    expect(cleanWords({ "nb-NO": { prefix: " Kun ", suffix: "" }, "xx-XX": { prefix: "a", suffix: "" } }, ["nb-NO"])).toEqual({
      "nb-NO": { prefix: "Kun", suffix: "" },
    });
    const found = wordsProblems({ "nb-NO": { prefix: "", suffix: "y".repeat(30) }, "de-DE": { prefix: "<", suffix: "" } }, ["nb-NO", "de-DE"]);
    expect(found).toEqual([
      { locale: "nb-NO", place: "suffix", problem: { kind: "long", max: 24 } },
      { locale: "de-DE", place: "prefix", problem: { kind: "plain" } },
    ]);
    expect(priceWordSentence(found[0])).toBe("After the price in nb-NO: at most 24 characters.");
  });
});
