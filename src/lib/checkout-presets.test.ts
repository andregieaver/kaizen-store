import { describe, expect, it } from "vitest";

import { allergenQuestion, EU_ALLERGEN_COUNT } from "./checkout-presets";
import { boundsProblems, checklistProblems, fieldInputSchema } from "./checkout-rules-schema";

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
    expect(checklistProblems({ kind: "text", options: [{ label: w("A") }] })).toEqual(["Only a tick list, a dropdown or a choice of one has options."]);
    expect(checklistProblems({ kind: "text" })).toEqual([]);
  });
  it("gives a dropdown and a choice of one at least two options and no None of these", () => {
    for (const kind of ["select", "radio"] as const) {
      expect(checklistProblems({ kind, options: [{ label: w("A") }] })).toEqual(["Give the question at least two options to choose from."]);
      expect(checklistProblems({ kind, options: [{ label: w("A") }, { label: w("B"), none: true }] })).toEqual(["Only a tick list has a None of these option."]);
      expect(checklistProblems({ kind, options: [{ label: w("A") }, { label: w("B") }] })).toEqual([]);
    }
    expect(checklistProblems({ kind: "textarea", options: [{ label: w("A") }] })).toEqual(["Only a tick list, a dropdown or a choice of one has options."]);
  });
  it("lets only a number or a date have bounds, the lowest not above the highest, and a date's days 0 to 730", () => {
    expect(boundsProblems({ kind: "number", bounds: { min: -5, max: 5 } })).toEqual([]);
    expect(boundsProblems({ kind: "number", bounds: { min: 6, max: 5 } })).toEqual(["The lowest answer is above the highest."]);
    expect(boundsProblems({ kind: "date", bounds: { min: -1 } })).toEqual(["Count a date's days from today: 0 to 730."]);
    expect(boundsProblems({ kind: "text", bounds: { max: 3 } })).toEqual(["Only a number or a date has a lowest and a highest answer."]);
    expect(boundsProblems({ kind: "text", bounds: {} })).toEqual([]);
  });
});
