import { describe, expect, it } from "vitest";

import { allergenQuestion, EU_ALLERGEN_COUNT } from "./checkout-presets";
import { checklistProblems, fieldInputSchema } from "./checkout-rules-schema";

describe("the EU allergen list (Regulation (EU) No 1169/2011, Annex II)", () => {
  it("has the 14 allergens and None of these, in the store's main language and its others", () => {
    const q = allergenQuestion(["nb-NO", "sv-SE", "en"]);
    expect(EU_ALLERGEN_COUNT).toBe(14);
    expect(q.options).toHaveLength(15);
    expect(q.label).toEqual({ text: "Allergier vi bør vite om", byLocale: { "sv-SE": "Allergier vi bör känna till", en: "Allergies we should know about" } });
    expect(q.options[0].label).toEqual({ text: "Korn som inneholder gluten", byLocale: { "sv-SE": "Spannmål som innehåller gluten", en: "Cereals containing gluten" } });
    expect(q.options.at(-1)).toEqual({ label: { text: "Ingen av disse", byLocale: { "sv-SE": "Inget av dessa", en: "None of these" } }, none: true });
    expect(q.sensitive).toBe(true);
    expect(allergenQuestion(["da-DK"]).options[2].label.text).toBe("Æg");
    expect(allergenQuestion(["de-DE"]).options[6].label.text).toBe("Milk");
  });

  it("is a tick list the editor's own checks accept", () => {
    const q = allergenQuestion(["en"]);
    const input = fieldInputSchema.parse({ kind: "checklist", required: true, label: q.label, help: q.help, options: q.options, sensitive: true });
    expect(checklistProblems(input)).toEqual([]);
  });
});

describe("a tick list's own rules (checklistProblems)", () => {
  const w = (text: string) => ({ text, byLocale: {} });
  it("needs an option, at most one None of these and distinct ids; the other kinds take none", () => {
    expect(checklistProblems({ kind: "checklist", options: [] })).toEqual(["Give the tick list at least one option."]);
    expect(checklistProblems({ kind: "checklist", options: [{ label: w("A") }, { label: w("No"), none: true }, { label: w("Nope"), none: true }] })).toEqual([
      "Only one option can be None of these.",
    ]);
    expect(checklistProblems({ kind: "checklist", options: [{ id: "a", label: w("A") }, { id: "a", label: w("B") }] })).toEqual(["Two options have the same id."]);
    expect(checklistProblems({ kind: "text", options: [{ label: w("A") }] })).toEqual(["Only a tick list has options."]);
    expect(checklistProblems({ kind: "text" })).toEqual([]);
  });
});
