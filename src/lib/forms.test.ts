import { describe, expect, it } from "vitest";

import { checkMessage, checkSignup, formRequest, looksAutomated, publicForm, returnPath, withoutRecipients } from "./forms";
import { t } from "./i18n";
import type { EmailFormBlock, NewsletterBlock } from "./page-content";

const nb = t("nb");
const en = t("en");

const form: EmailFormBlock = {
  id: "f",
  type: "emailForm",
  recipients: ["post@example.com"],
  subject: "Hemmelig emne",
  fields: [
    { id: "name", kind: "name", label: "", required: true },
    { id: "mail", kind: "email", label: "", required: true },
    { id: "tel", kind: "phone", label: "Mobil" },
    { id: "topic", kind: "select", label: "Emne", options: ["Bestilling", "Annet"], required: true },
    { id: "msg", kind: "textarea", label: "", required: true },
    { id: "news", kind: "checkbox", label: "Send meg tilbud" },
  ],
  submitLabel: "",
  successMessage: "",
  consent: "Jeg godtar at dere lagrer meldingen.",
};

describe("forms (D93)", () => {
  it("never carries where a form sends to the browser", () => {
    expect(publicForm(form)).not.toHaveProperty("recipients");
    expect(publicForm(form)).not.toHaveProperty("subject");
    const newsletter: NewsletterBlock = { id: "n", type: "newsletter", recipients: ["a@x.no"], placeholder: "", submitLabel: "", successMessage: "", consent: "" };
    expect(publicForm(newsletter)).not.toHaveProperty("recipients");
    expect(JSON.stringify(withoutRecipients({ rows: [{ blocks: [form, newsletter, { type: "heading", recipients: "x" }] }] }))).not.toContain("@");
  });

  it("labels the answers in the owner's language, choices by their place, and replies to the visitor", () => {
    const checked = checkMessage(
      form,
      { name: " Kari\nNordmann ", mail: "kari@example.com", tel: "+47 900 00 000", topic: "1", msg: "Hei!\r\n\r\nHar dere ...", news: true },
      true,
      en,
      nb,
    );
    expect(checked).toEqual({
      ok: true,
      replyTo: "kari@example.com",
      answers: [
        { label: "Navn", value: "Kari Nordmann" },
        { label: "E-post", value: "kari@example.com" },
        { label: "Mobil", value: "+47 900 00 000" },
        { label: "Emne", value: "Annet" },
        { label: "Melding", value: "Hei!\n\nHar dere ..." },
        { label: "Send meg tilbud", value: "Ja" },
      ],
    });
  });

  it("says what to correct, by field, in the visitor's language", () => {
    const checked = checkMessage(form, { name: "", mail: "kari@", tel: "12", topic: "7", msg: "x".repeat(5001) }, false, en, nb);
    expect(checked).toEqual({
      ok: false,
      errors: {
        name: en.form.required,
        mail: en.form.invalidEmail,
        tel: en.form.invalidPhone,
        topic: en.form.required,
        msg: en.form.tooLong,
        consent: en.form.consentNeeded,
      },
    });
  });

  it("signs up an address in lower case, with a name only if asked, and never without consent", () => {
    expect(checkSignup({ askName: true }, { email: " Kari@Example.com ", name: "Kari" }, true, nb)).toEqual({ ok: true, email: "kari@example.com", name: "Kari" });
    expect(checkSignup({}, { email: "kari@example.com", name: "Kari" }, true, nb)).toEqual({ ok: true, email: "kari@example.com", name: "" });
    expect(checkSignup({}, { email: "nope" }, false, nb)).toEqual({ ok: false, errors: { email: nb.form.invalidEmail, consent: nb.form.consentNeeded } });
  });

  it("reads requests from the site's own pages only, and tells robots apart", () => {
    const base = { store: null, block: "f", values: {}, path: "/s/demo/no/kontakt" };
    expect(formRequest.safeParse(base).success).toBe(true);
    for (const path of ["https://evil.example/", "//evil.example", "/a\\b", "/a b"]) expect(formRequest.safeParse({ ...base, path }).success).toBe(false);
    expect(looksAutomated({ website: "", elapsed: 5000 })).toBe(false);
    expect(looksAutomated({ website: "http://spam", elapsed: 5000 })).toBe(true);
    expect(looksAutomated({ website: "", elapsed: 300 })).toBe(true);
  });

  it("returns a confirmed sign-up to its page, marked for its form", () => {
    expect(returnPath("/s/demo/no/nyhetsbrev?utm=x#top", "n1", "confirmed")).toBe("/s/demo/no/nyhetsbrev?utm=x&newsletter=confirmed&form=n1");
    expect(returnPath("/", "n1", "expired")).toBe("/?newsletter=expired&form=n1");
  });
});
