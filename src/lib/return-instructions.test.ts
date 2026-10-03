import { describe, expect, it } from "vitest";

import { cleanTranslations, instructionsIn, translationProblems } from "./return-instructions";
import { MAX_INSTRUCTIONS } from "./withdrawal";

describe("the instructions in a customer's language", () => {
  const translations = { "sv-SE": "Packa väl.", da: "Pak godt." };

  it("use the translation when there is one, else the store's own language", () => {
    expect(instructionsIn("Pakk godt.", translations, "sv-SE")).toBe("Packa väl.");
    expect(instructionsIn("Pakk godt.", translations, "nb-NO")).toBe("Pakk godt.");
    expect(instructionsIn("Pakk godt.", {}, "sv-SE")).toBe("Pakk godt.");
    expect(instructionsIn("Pakk godt.", null, "sv-SE")).toBe("Pakk godt.");
  });

  it("find a language by its first part, as the other store texts do", () => {
    expect(instructionsIn("Pakk godt.", translations, "da-DK")).toBe("Pak godt.");
  });

  it("do not use an empty translation", () => {
    expect(instructionsIn("Pakk godt.", { "sv-SE": "   " }, "sv-SE")).toBe("Pakk godt.");
  });
});

describe("what is stored as translations", () => {
  it("keeps only the languages the store offers, with words, trimmed", () => {
    expect(cleanTranslations({ "sv-SE": " Packa. ", "da-DK": "", xx: "Nope", "en-GB": 3 }, ["sv-SE", "da-DK", "en-GB"])).toEqual({ "sv-SE": "Packa." });
    for (const bad of [null, undefined, "text", ["a"], 4]) expect(cleanTranslations(bad, ["sv-SE"])).toEqual({});
  });

  it("is checked: a language the store does not offer, text that is not text and text that is too long are problems", () => {
    expect(translationProblems(undefined, ["sv-SE"])).toEqual([]);
    expect(translationProblems({ "sv-SE": "Packa." }, ["sv-SE"])).toEqual([]);
    expect(translationProblems({ "fr-FR": "Emballez." }, ["sv-SE"])[0]).toMatchObject({ locale: "fr-FR" });
    expect(translationProblems({ "sv-SE": 4 }, ["sv-SE"])[0]).toMatchObject({ locale: "sv-SE", message: "Instructions are text." });
    expect(translationProblems({ "sv-SE": "x".repeat(MAX_INSTRUCTIONS + 1) }, ["sv-SE"])[0].message).toContain(String(MAX_INSTRUCTIONS));
    expect(translationProblems({ "sv-SE": "x".repeat(MAX_INSTRUCTIONS) }, ["sv-SE"])).toEqual([]);
    expect(translationProblems(["a"], ["sv-SE"])).toHaveLength(1);
  });
});
