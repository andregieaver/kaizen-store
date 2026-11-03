import { describe, expect, it } from "vitest";

import { localeFor, productWordsForTool, productWordsFromArgs, quoteToolSummary, wordsOverlay } from "./quote-tools";

/** The AI manager's quotes and price display, the pure parts (D437). */
describe("a language the model names", () => {
  const locales = ["nb-NO", "en", "sv-SE"];
  it("is the store's locale itself, or the first with that language, or none", () => {
    expect(localeFor("nb-NO", locales)).toBe("nb-NO");
    expect(localeFor("NB", locales)).toBe("nb-NO");
    expect(localeFor("sv", locales)).toBe("sv-SE");
    expect(localeFor("en-GB", locales)).toBe("en");
    expect(localeFor("fi", locales)).toBeNull();
  });
});

describe("words around a price, as the model gives them", () => {
  it("are laid over the store's, tidied, and refused with the reason the editor gives", () => {
    const laid = wordsOverlay([{ language: "nb", before: "  Fra ", after: "/stk" }], { en: { prefix: "From", suffix: "" } }, ["nb-NO", "en"]);
    expect(laid).toEqual({ ok: true, words: { en: { prefix: "From", suffix: "" }, "nb-NO": { prefix: "Fra", suffix: "/stk" } } });
    const refused = wordsOverlay([{ language: "en", before: "Now 20 % off", after: "" }, { language: "fi", before: "Vain", after: "" }], {}, ["nb-NO", "en"]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.problems.join(" ")).toMatch(/percentage/);
      expect(refused.problems.join(" ")).toMatch(/no language fi/);
    }
  });

  it("make a product's choice and read it back the same way", () => {
    expect(productWordsFromArgs({ follow: "store" }, ["nb-NO"])).toEqual({ ok: true, words: { mode: "inherit" } });
    expect(productWordsFromArgs({ follow: "none" }, ["nb-NO"])).toEqual({ ok: true, words: { mode: "none" } });
    expect(productWordsFromArgs({ follow: "own" }, ["nb-NO"]).ok).toBe(false);
    const own = productWordsFromArgs({ follow: "own", words: [{ language: "nb", before: "Fra", after: "" }] }, ["nb-NO"]);
    expect(own).toEqual({ ok: true, words: { mode: "own", words: { "nb-NO": { prefix: "Fra", suffix: "" } } } });
    expect(productWordsForTool(null)).toEqual({ follow: "store" });
    expect(productWordsForTool({ mode: "none" })).toEqual({ follow: "none" });
    expect(productWordsForTool({ mode: "own", words: { "nb-NO": { prefix: "Fra", suffix: "" } } })).toEqual({ follow: "own", words: [{ language: "nb-NO", before: "Fra", after: "" }] });
  });
});

describe("what the owner is asked to approve", () => {
  it("is written from the call's arguments", () => {
    expect(quoteToolSummary("set_quote_requests", { who: "business" })).toBe("Offer Request a quote to business buyers only.");
    expect(quoteToolSummary("decline_quote", { draft: "D-12", reply: "Not before March." })).toMatch(/^Decline the request for a quote D-12 and email the customer this reply: "Not before March."/);
    const display = quoteToolSummary("set_price_display", { decimals: "hide_whole", countries: [{ country: "se", decimals: "store" }], words: [{ language: "nb", before: "Fra", after: "" }], quantity_chooser: "buttons" });
    expect(display).toBe('Change how the shop shows prices: show whole amounts without decimals; SE: as the store; in nb, "Fra" before and "" after a product\'s price; product pages offer − and + around a number.');
    expect(quoteToolSummary("list_orders", {})).toBeNull();
  });
});
