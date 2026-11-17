import { describe, expect, it } from "vitest";

import {
  FORM_KEEP_MONTHS_MAX,
  FORM_STARTERS,
  blankDraft,
  contactOf,
  draftFromStarter,
  formAsBlock,
  formTakesAnswers,
  newQuestionId,
  type FormRecord,
} from "./form-records";
import { formDraftSchema } from "./form-records-schema";
import { checkMessage, shownQuestions } from "./forms";
import { t } from "./i18n";
import { pageBlockSchema } from "./page-content";
import { ruleFor } from "./retention";

const ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

const contact: FormRecord = {
  id: ID,
  storeId: null,
  kind: "message",
  name: "Contact",
  status: "active",
  questions: [
    { id: "q1", kind: "name", label: { text: "", byLocale: {} }, required: true },
    { id: "q2", kind: "email", label: { text: "", byLocale: {} }, required: true },
    { id: "q3", kind: "select", label: { text: "Topic", byLocale: { nb: "Emne" } }, options: [{ text: "Orders", byLocale: { nb: "Bestillinger" } }, { text: "Other", byLocale: {} }] },
  ],
  words: { submit: { text: "Send it", byLocale: { nb: "Send" } } },
  delivery: { recipients: ["owner@example.com"], subject: "Hello" },
  signup: null,
  keepMonths: 12,
  madeFrom: null,
};

describe("a form as a page's form (D705)", () => {
  it("draws a message form in a language, with the form's id and the component's look, and keeps the main words without one", () => {
    const nb = formAsBlock(contact, "nb", { button: { variant: "outline" } });
    expect(nb).toMatchObject({ id: ID, type: "emailForm", submitLabel: "Send", button: { variant: "outline" } });
    if (nb.type !== "emailForm") throw new Error("a message form");
    expect(nb.fields[2]).toMatchObject({ label: "Emne", options: ["Bestillinger", "Other"] });
    const main = formAsBlock(contact, null);
    if (main.type !== "emailForm") throw new Error("a message form");
    expect(main.fields[2].label).toBe("Topic");
    expect(main.submitLabel).toBe("Send it");
    expect(pageBlockSchema.safeParse(main).success).toBe(true);
  });

  it("checks answers with the page form's own checks, a choice by its place whatever the language", () => {
    const block = formAsBlock(contact, null);
    if (block.type !== "emailForm") throw new Error("a message form");
    const checked = checkMessage(block, { q1: "Ada", q2: "ada@example.com", q3: "0" }, false, t("nb"), t("en"));
    expect(checked).toMatchObject({ ok: true, replyTo: "ada@example.com" });
    if (checked.ok) expect(checked.answers.at(-1)).toEqual({ label: "Topic", value: "Orders" });
  });

  it("draws a sign-up with its settings and layout", () => {
    const signup = formAsBlock({ ...contact, kind: "signup", questions: [], signup: { confirm: false, askName: true, tags: ["vip"] } }, "en", { layout: "stacked" });
    expect(signup).toMatchObject({ type: "newsletter", confirm: false, askName: true, tags: ["vip"], layout: "stacked", recipients: ["owner@example.com"] });
  });

  it("takes answers only while active, with an address and something to ask", () => {
    expect(formTakesAnswers(contact)).toBe(true);
    expect(formTakesAnswers({ ...contact, status: "archived" })).toBe(false);
    expect(formTakesAnswers({ ...contact, delivery: { recipients: [], subject: "" } })).toBe(false);
    expect(formTakesAnswers({ ...contact, questions: [] })).toBe(false);
    expect(formTakesAnswers({ ...contact, kind: "signup", questions: [] })).toBe(true);
  });

  it("finds a response's address in the first email answered, lower case", () => {
    expect(contactOf(contact, { q1: "Ada", q2: " Ada@Example.com " })).toBe("ada@example.com");
    expect(contactOf(contact, { q1: "Ada" })).toBeNull();
    expect(contactOf({ kind: "signup", questions: [] }, { email: "B@Example.com" })).toBe("b@example.com");
  });
});

describe("Kaizena Flow's starters (D705)", () => {
  it("makes a valid form from every starter in every hand-written language, sending to the owner", () => {
    for (const starter of FORM_STARTERS) {
      for (const lang of ["en", "nb", "sv", "da", "de"]) {
        const draft = draftFromStarter(starter, lang, [lang, "en"], ["owner@example.com"]);
        const parsed = formDraftSchema.safeParse(draft);
        expect(parsed.success, `${starter.key} in ${lang}: ${parsed.error?.issues.map((i) => i.message).join(", ")}`).toBe(true);
        expect(draft.delivery.recipients).toEqual(["owner@example.com"]);
        expect(formTakesAnswers({ ...draft, status: "active" })).toBe(true);
      }
    }
  });

  it("writes the main language's words with the others the store sells in", () => {
    const quote = FORM_STARTERS.find((s) => s.key === "quote")!;
    const draft = draftFromStarter(quote, "nb", ["nb", "sv", "en"], []);
    expect(draft.name).toBe("Be om tilbud");
    expect(draft.questions[1].label).toEqual({ text: "Firma", byLocale: { sv: "Företag", en: "Company" } });
    // A language the starter does not have reads in English.
    expect(draftFromStarter(quote, "de", ["de"], []).questions[1].label).toEqual({ text: "Company", byLocale: {} });
  });

  it("has a blank form of each kind, and new question ids that are free", () => {
    expect(formDraftSchema.safeParse(blankDraft("message", "New", [])).success).toBe(true);
    expect(formDraftSchema.safeParse(blankDraft("signup", "New", [])).success).toBe(true);
    expect(newQuestionId([{ id: "q1" }, { id: "q3" }])).toBe("q4");
    expect(newQuestionId([{ id: "q3" }])).toBe("q2");
  });
});

describe("saving a form (D705)", () => {
  it("refuses a sign-up without its settings, a message form with them, a choice without choices and a short text without words", () => {
    const base = blankDraft("message", "Contact", ["owner@example.com"]);
    expect(formDraftSchema.safeParse({ ...base, signup: { confirm: true, askName: false } }).success).toBe(false);
    expect(formDraftSchema.safeParse({ ...blankDraft("signup", "News", []), signup: null }).success).toBe(false);
    expect(formDraftSchema.safeParse({ ...base, questions: [{ id: "q1", kind: "select", label: { text: "Topic", byLocale: {} }, options: [] }] }).success).toBe(false);
    expect(formDraftSchema.safeParse({ ...base, questions: [{ id: "q1", kind: "text", label: { text: "", byLocale: {} } }] }).success).toBe(false);
    expect(formDraftSchema.safeParse({ ...base, keepMonths: 37 }).success).toBe(false);
    expect(formDraftSchema.safeParse({ ...base, delivery: { recipients: ["not an address"], subject: "" } }).success).toBe(false);
  });

  it("drops a sign-up's questions, empty translations and a non-choice's options", () => {
    const parsed = formDraftSchema.parse({
      ...blankDraft("message", "Contact", []),
      questions: [{ id: "q1", kind: "text", label: { text: "Company", byLocale: { nb: "Firma", sv: "" } }, options: [{ text: "x", byLocale: {} }] }],
    });
    expect(parsed.questions[0]).toEqual({ id: "q1", kind: "text", label: { text: "Company", byLocale: { nb: "Firma" } } });
    expect(formDraftSchema.parse({ ...blankDraft("signup", "News", []), questions: blankDraft("message", "x", []).questions }).questions).toEqual([]);
  });

  it("keeps responses at most as long as the retention rule allows", () => {
    expect(ruleFor("form_responses", null, "2026-11-17")).toMatchObject({ periodValue: FORM_KEEP_MONTHS_MAX, periodUnit: "months" });
  });
});

describe("F3: more kinds of question, and questions asked on earlier answers (D705)", () => {
  const fields = [
    { id: "topic", kind: "radio", label: "Topic", options: ["Order", "Other"], required: true },
    { id: "order", kind: "number", label: "Order number", min: 1000, max: 9999, required: true, showWhen: [{ question: "topic", op: "is", values: [0] }] },
    { id: "extras", kind: "checklist", label: "Extras", options: ["Gift wrap", "Card", "Bag"] },
    { id: "note", kind: "text", label: "Card text", showWhen: [{ question: "extras", op: "any_of", values: [1] }] },
    { id: "when", kind: "date", label: "Delivery day", min: 1, max: 30 },
  ] as const;
  const block = { fields: fields as never, consent: undefined };
  const check = (values: Record<string, string | boolean>) => checkMessage(block, values, false, t("en"), t("en"), "2026-11-17");

  it("asks a question only while its conditions hold, and neither checks nor sends one that is not asked", () => {
    expect(shownQuestions(fields as never, { topic: "1" }).map((f) => f.id)).toEqual(["topic", "extras", "when"]);
    expect(shownQuestions(fields as never, { topic: "0", extras: "0,1" }).map((f) => f.id)).toEqual(["topic", "order", "extras", "note", "when"]);
    // Not asked: its required number is not missing, and what was typed into it is not sent.
    const other = check({ topic: "1", order: "abc", note: "Hi" });
    expect(other).toMatchObject({ ok: true });
    if (other.ok) expect(other.answers.map((a) => a.label)).toEqual(["Topic"]);
    expect(check({ topic: "0" })).toMatchObject({ ok: false, errors: { order: expect.any(String) } });
  });

  it("checks a radio choice, a tick list, a number and a date within their bounds", () => {
    const ok = check({ topic: "0", order: "1042", extras: "2,0", when: "2026-11-20" });
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.answers).toEqual([
      { label: "Topic", value: "Order" },
      { label: "Order number", value: "1042" },
      { label: "Extras", value: "Gift wrap, Bag" },
      { label: "Delivery day", value: "2026-11-20" },
    ]);
    expect(check({ topic: "0", order: "99" })).toMatchObject({ ok: false, errors: { order: t("en").form.invalidNumber } });
    expect(check({ topic: "1", when: "2026-11-17" })).toMatchObject({ ok: false, errors: { when: t("en").form.invalidDate } });
    expect(check({ topic: "1", extras: "0,9" })).toMatchObject({ ok: false, errors: { extras: t("en").form.chooseSome } });
    expect(check({ topic: "5" })).toMatchObject({ ok: false, errors: { topic: t("en").form.required } });
  });

  it("refuses a condition on a question below, a choice not offered, and a tick on what cannot be ticked", () => {
    const q = (over: Record<string, unknown>) => ({ id: "x", kind: "text", label: { text: "X", byLocale: {} }, ...over });
    const radio = { id: "r", kind: "radio", label: { text: "R", byLocale: {} }, options: [{ text: "A", byLocale: {} }] };
    const draft = (questions: unknown[]) => formDraftSchema.safeParse({ ...blankDraft("message", "F", []), questions });
    expect(draft([radio, q({ showWhen: [{ question: "r", op: "is", values: [0] }] })]).success).toBe(true);
    expect(draft([q({ showWhen: [{ question: "r", op: "is", values: [0] }] }), radio]).success).toBe(false);
    expect(draft([radio, q({ showWhen: [{ question: "r", op: "is", values: [3] }] })]).success).toBe(false);
    expect(draft([radio, q({ showWhen: [{ question: "r", op: "ticked" }] })]).success).toBe(false);
    expect(draft([q({ kind: "date", bounds: { min: 5, max: 2 } })]).success).toBe(false);
    expect(draft([q({ kind: "date", bounds: { min: -1 } })]).success).toBe(false);
    expect(draft([q({ kind: "number", bounds: { min: -5, max: 5 } })]).success).toBe(true);
  });

  it("draws a question's help, width, bounds and conditions for the site", () => {
    const form = { ...contact, questions: [{ id: "n", kind: "number" as const, label: { text: "Guests", byLocale: {} }, help: { text: "Up to 8", byLocale: { nb: "Opptil 8" } }, width: "half" as const, bounds: { min: 1, max: 8 } }] };
    const block = formAsBlock(form, "nb");
    if (block.type !== "emailForm") throw new Error("a message form");
    expect(block.fields[0]).toEqual({ id: "n", kind: "number", label: "Guests", help: "Opptil 8", width: "half", min: 1, max: 8 });
  });
});
