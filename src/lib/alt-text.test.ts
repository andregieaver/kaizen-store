import { describe, expect, it } from "vitest";

import { ALT_TEXT_MAX, altRunInput, altTextPrompt, altTextsInput, cleanAltText, parseAltTexts, splitAltTexts } from "./alt-text";

const languages = [
  { locale: "nb-NO", name: "Norwegian Bokmål" },
  { locale: "en", name: "English" },
];

describe("alt texts written by the site's AI (D89)", () => {
  it("asks for what the picture shows in each language, told where it is used, as JSON", () => {
    const { system, user } = altTextPrompt({
      siteName: "Olas Butikk",
      languages,
      fileName: "hvit-kopp.webp",
      uses: ["Product: Demo: Keramikkopp", "Page: Om oss"],
    });
    expect(system).toContain("Olas Butikk");
    expect(system).toContain('{"nb-NO":"…","en":"…"}');
    expect(system).toMatch(/Never state prices/);
    expect(user).toContain("nb-NO (Norwegian Bokmål), en (English)");
    expect(user).toContain("File name: hvit-kopp.webp");
    expect(user).toContain("Used in: Product: Demo: Keramikkopp; Page: Om oss");
    expect(altTextPrompt({ siteName: "Kaizen", languages, fileName: "x.webp", uses: [] }).user).toContain("Not used on the site yet.");
  });

  it("cleans a text: one line, no quotes, links or opener, cut at a word", () => {
    expect(cleanAltText('  "Image of a white mug\non a table."  ')).toBe("A white mug on a table.");
    expect(cleanAltText("Bilde av en hvit kopp")).toBe("En hvit kopp");
    expect(cleanAltText("Foto som viser en sykkel ved sjøen")).toBe("En sykkel ved sjøen");
    expect(cleanAltText("**A lamp** see https://example.com")).toBe("A lamp see");
    expect(cleanAltText("   ")).toBe("");
    const long = cleanAltText(`${"word ".repeat(80)}end`);
    expect(long.length).toBeLessThanOrEqual(ALT_TEXT_MAX);
    expect(long.endsWith("word")).toBe(true);
  });

  it("reads the answer's JSON, keeps the languages asked for, and leaves out claims", () => {
    const reply = [
      "Here you go:",
      '```json\n{"nb-NO": "En hvit keramikkopp på et trebord", "en": "A sustainable white mug, only today", "de": "Eine Tasse"}\n```',
    ].join("\n");
    const { texts, dropped } = parseAltTexts(reply, ["nb-NO", "en", "sv-SE"]);
    expect(texts).toEqual({ "nb-NO": "En hvit keramikkopp på et trebord" });
    expect(dropped).toEqual([
      { locale: "en", reason: "green" },
      { locale: "sv-SE", reason: "missing" },
    ]);
    // A language code without its country is taken, and one language may answer in plain words.
    expect(parseAltTexts('{"nb": "En lampe"}', ["nb-NO"]).texts).toEqual({ "nb-NO": "En lampe" });
    expect(parseAltTexts("A green desk lamp", ["en"]).texts).toEqual({ en: "A green desk lamp" });
    expect(parseAltTexts("not json {", ["nb-NO", "en"]).texts).toEqual({});
    expect(parseAltTexts('{"en": "A mug for 199 kr"}', ["en"]).dropped).toEqual([{ locale: "en", reason: "price" }]);
  });

  it("keeps the main language's text as the alt and the others as translations", () => {
    expect(splitAltTexts({ "nb-NO": "En kopp", en: "A mug" }, "nb-NO")).toEqual({ alt: "En kopp", translations: { en: "A mug" } });
    expect(splitAltTexts({ en: "A mug" }, "nb-NO")).toEqual({ alt: "", translations: { en: "A mug" } });
  });

  it("checks what the library sends", () => {
    expect(altTextsInput.safeParse({ alt: "En kopp", translations: { en: "A mug", "sv-SE": "" } }).success).toBe(true);
    expect(altTextsInput.safeParse({ alt: "En kopp", translations: { "<script>": "x" } }).success).toBe(false);
    expect(altRunInput.safeParse({ since: new Date().toISOString(), rewrite: false }).success).toBe(true);
    expect(altRunInput.safeParse({ since: new Date(Date.now() - 2 * 86_400_000).toISOString(), rewrite: false }).success).toBe(false);
    expect(altRunInput.safeParse({ since: "yesterday", rewrite: true }).success).toBe(false);
  });
});
