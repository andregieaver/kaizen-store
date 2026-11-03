import { describe, expect, it } from "vitest";

import { checkMessage } from "./forms";
import { t } from "./i18n";
import { questionFieldsOf, questionForm, questionKindOf, quoteFieldsOf } from "./product-question";

const words = { company: "Company", message: "Your question", button: "Send the question", sent: "Thank you." };

describe("the product question (D431)", () => {
  it("is a question unless set to a request for a quote", () => {
    expect(questionKindOf({})).toBe("question");
    expect(questionKindOf({ questionKind: "quote" })).toBe("quote");
  });

  it("asks each kind's own fields unless the owner chose otherwise", () => {
    expect(questionFieldsOf({})).toEqual({ name: "required", phone: "hidden", company: "hidden", message: "required" });
    expect(questionFieldsOf({ questionKind: "quote" })).toEqual({ name: "required", phone: "optional", company: "optional", message: "optional" });
    expect(questionFieldsOf({ questionFields: { phone: "required", name: "hidden" } })).toMatchObject({ name: "hidden", phone: "required" });
    expect(quoteFieldsOf({ questionKind: "quote", questionFields: { message: "required" } })).toEqual({ name: "required", phone: "optional", company: "optional", note: "required" });
  });

  it("draws a question as the site's email form: the email always asked and needed, hidden fields left out", () => {
    const form = questionForm({ id: "q1", questionFields: { phone: "optional", message: "required" } }, words);
    expect(form.type).toBe("emailForm");
    expect(form.fields.map((f) => [f.id, f.kind, f.required])).toEqual([
      ["name", "name", true],
      ["email", "email", true],
      ["phone", "phone", false],
      ["message", "textarea", true],
    ]);
    expect(form.submitLabel).toBe("Send the question");
    expect(form.successMessage).toBe("Thank you.");
    const own = questionForm({ id: "q1", buttonLabel: "Ask us", successMessage: "We will be in touch.", questionFields: { email: "hidden" } as never }, words);
    expect(own.fields.some((f) => f.id === "email" && f.required)).toBe(true);
    expect(own.submitLabel).toBe("Ask us");
    expect(own.successMessage).toBe("We will be in touch.");
  });

  it("is checked by the form's own check: a missing email and an empty question are refused", () => {
    const form = questionForm({ id: "q1" }, words);
    const m = t("en");
    const refused = checkMessage(form, { name: "Kari", email: "", message: "" }, false, m, m);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(Object.keys(refused.errors).sort()).toEqual(["email", "message"]);
    const sent = checkMessage(form, { name: "Kari", email: "kari@example.com", message: "Does it come in blue?" }, false, m, m);
    expect(sent).toMatchObject({ ok: true, replyTo: "kari@example.com" });
  });
});
