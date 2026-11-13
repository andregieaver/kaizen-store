import { describe, expect, it } from "vitest";

import { checkoutQuestionSummary, questionChange, saveCheckoutQuestionInput } from "./checkout-question-tools";
import { FIELDS_MAX, type CheckoutField } from "./checkout-rules";

const LOCALES = ["nb-NO", "en", "sv-SE"];
const door: CheckoutField = { id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", kind: "text", required: true, label: { text: "Portkode", byLocale: { en: "Door code" } }, help: null };
const read = (raw: unknown) => saveCheckoutQuestionInput.parse(raw);

describe("the AI manager's checkout question, laid over the question as it is (D357)", () => {
  it("adds one with the page's defaults: a line to type, optional, on, at the end", () => {
    expect(questionChange(read({ question: "Gavehilsen" }), null, LOCALES, 2)).toEqual({
      ok: true,
      change: { field: { kind: "text", required: false, label: { text: "Gavehilsen", byLocale: {} }, help: null }, on: undefined, to: undefined },
    });
  });

  it("changes only what is given, keeping the other languages, and matches a language to the store's locale", () => {
    const changed = questionChange(read({ id: door.id, question_in: [{ language: "sv", text: "Portkod" }], required: false }), door, LOCALES, 1);
    expect(changed).toEqual({
      ok: true,
      change: { field: { kind: "text", required: false, label: { text: "Portkode", byLocale: { en: "Door code", "sv-SE": "Portkod" } }, help: null }, on: undefined, to: undefined },
    });
    const gone = questionChange(read({ id: door.id, question_in: [{ language: "en", text: "" }] }), door, LOCALES, 1);
    expect(gone.ok && gone.change.field?.label.byLocale).toEqual({});
  });

  it("moves or switches without touching the words, its place counted from 1", () => {
    expect(questionChange(read({ id: door.id, place: 1, on: false }), door, LOCALES, 3)).toEqual({ ok: true, change: { field: null, on: false, to: 0 } });
  });

  it("refuses what the page refuses, in words the model can repeat", () => {
    expect(questionChange(read({ id: door.id }), null, LOCALES, 1)).toEqual({ ok: false, problems: ["That question is not one of this store's. Read checkout_questions."] });
    expect(questionChange(read({ kind: "checkbox" }), null, LOCALES, 0)).toMatchObject({ ok: false, problems: ["Give the question in the store's main language (question)."] });
    expect(questionChange(read({ question: "One more" }), null, LOCALES, FIELDS_MAX)).toMatchObject({ ok: false, problems: [`A checkout asks at most ${FIELDS_MAX} questions; this store has ${FIELDS_MAX}.`] });
    expect(questionChange(read({ id: door.id, question_in: [{ language: "de", text: "Türcode" }] }), door, LOCALES, 1)).toMatchObject({ ok: false, problems: ["de is not one of the store's other languages (en, sv-SE)."] });
    expect(questionChange(read({ id: door.id }), door, LOCALES, 1)).toMatchObject({ ok: false, problems: ["Say what changes: the words, kind, required, on or place."] });
    expect(() => read({ place: 0 })).toThrow();
  });

  it("says what the owner approves from the call's own arguments", () => {
    expect(checkoutQuestionSummary({ question: "Gavehilsen", kind: "text" })).toBe('Ask shoppers a new question at checkout: "Gavehilsen" (a line to type, optional). The answers are kept on the order.');
    expect(checkoutQuestionSummary({ question: "Ikke ring på", kind: "checkbox", required: true, on: false, place: 1 })).toBe(
      'Ask shoppers a new question at checkout: "Ikke ring på" (a tick box, required), kept off for now; ask it in place 1. The answers are kept on the order.',
    );
    expect(checkoutQuestionSummary({ id: door.id, place: 2, required: false }, "Portkode")).toBe('Change the checkout question "Portkode": make it optional; ask it in place 2.');
  });
});
