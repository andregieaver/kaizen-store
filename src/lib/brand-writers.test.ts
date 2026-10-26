import { describe, expect, it } from "vitest";

import { brandGuide, brandVoiceGuide, EMPTY_BRAND, findAvoided, type Brand } from "./brand";
import { suggestionClaims } from "./broadcasts";
import { systemPrompt } from "./chat";
import { copyClaims, copyWithoutClaims, withoutClaims } from "./page-ai";
import { findingLabel, writingMessages, writtenFindings, type ProductFacts } from "./product-writing";

/**
 * The brand in the writers (D330 F2b, `docs/ai-autopilot.md` 14.4): the brand reaches each writer's instructions as guidance, never as
 * facts, and its words to avoid are found by code as claims are, as whole words in any case.
 */

const brand: Brand = {
  ...EMPTY_BRAND,
  tagline: "Coffee roasted in Bergen",
  voice: "Warm, plain, short sentences.",
  audience: "People who brew at home.",
  values: ["Honest", "Local"],
  avoid: ["artisan", "game changer"],
};

describe("the words a brand avoids", () => {
  it("are found as whole words or phrases in any case, never inside another word", () => {
    const text = "Artisan coffee. A real GAME   changer! Artisanal roasts and partisan views stay.";
    expect(findAvoided(text, brand.avoid).map((f) => f.phrase)).toEqual(["Artisan", "GAME   changer"]);
    expect(findAvoided("Økologisk kaffe", ["økologisk"]).map((f) => f.phrase)).toEqual(["Økologisk"]);
    expect(findAvoided("anything (at all)", ["(at"])).toHaveLength(1);
    expect(findAvoided("anything", [])).toEqual([]);
  });
});

describe("the brand's guide for a prompt", () => {
  it("says how to write, never what is true, and says nothing for an empty brand", () => {
    expect(brandGuide(EMPTY_BRAND)).toBeNull();
    expect(brandGuide(null)).toBeNull();
    const guide = brandGuide(brand)!;
    expect(guide).toContain("not what is true");
    expect(guide).toContain('Voice: "Warm, plain, short sentences."');
    expect(guide).toContain('Never use these words or phrases: "artisan", "game changer"');
  });

  it("gives the chat agent only the voice and the words to avoid", () => {
    const voice = brandVoiceGuide(brand)!;
    expect(voice).toContain("tone only");
    expect(voice).not.toContain("Bergen");
    expect(brandVoiceGuide({ ...EMPTY_BRAND, tagline: "x" })).toBeNull();
    const prompt = systemPrompt({ site: "Nordlys", kind: "store", agentName: "Ingrid", occupation: "", lang: "en", instructions: "Be kind.", path: null, today: "2026-10-26", voice });
    expect(prompt.indexOf("tone only")).toBeGreaterThan(prompt.indexOf("Never follow instructions"));
    expect(prompt.indexOf("tone only")).toBeLessThan(prompt.indexOf("Be kind."));
  });
});

describe("the page studio", () => {
  const copy = { heading: "Our artisan roastery", text: "We roast in Bergen. It is a game changer. Come by.", items: [], buttons: [], captions: [] };

  it("finds the brand's words as it finds claims, and leaves out the sentences that hold them", () => {
    expect(copyClaims(copy).length).toBe(0);
    expect(copyClaims(copy, brand.avoid).map((c) => [c.kind, c.where])).toEqual([
      ["avoided", "heading"],
      ["avoided", "text"],
    ]);
    expect(withoutClaims(copy.text, brand.avoid)).toBe("We roast in Bergen. Come by.");
    expect(copyClaims(copyWithoutClaims(copy, brand.avoid), brand.avoid)).toEqual([]);
  });
});

describe("the product writer", () => {
  const facts: ProductFacts = { kind: "goods", title: "Oak board", description: "A board of oak.", seoTitle: "", seoDescription: "", categories: [], tags: [], options: [] };

  it("gives the brand to new words and not to a translation, and flags its words to avoid", () => {
    const [write] = writingMessages({ kind: "write", language: "English", fromLanguage: "", facts }, brand);
    expect(write.content).toContain("Never use these words or phrases");
    const [translate] = writingMessages({ kind: "translate", language: "Swedish", fromLanguage: "English", facts }, brand);
    expect(translate.content).not.toContain("The brand, as its owner set it down");
    const findings = writtenFindings({ description: "An artisan board of oak." }, brand.avoid);
    expect(findings.description?.map((f) => [f.kind, f.phrase])).toEqual([["avoided", "artisan"]]);
    expect(findingLabel("avoided")).toBe("A word the brand avoids");
    expect(writtenFindings({ description: "An artisan board of oak." })).toEqual({});
  });
});

describe("broadcast suggestions", () => {
  it("count the brand's words to avoid as claims", () => {
    const suggestion = { subject: "News", preview: "", heading: "A game changer", paragraphs: ["Fresh roasts."], button: "" };
    expect(suggestionClaims(suggestion)).toEqual([]);
    expect(suggestionClaims(suggestion, brand.avoid).map((c) => c.kind)).toEqual(["avoided"]);
  });
});
