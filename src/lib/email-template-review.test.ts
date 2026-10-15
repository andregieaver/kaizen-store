import { describe, expect, it } from "vitest";

import { templateProblems } from "./email-template";

/**
 * Security review (wave 3, D238 4.2): "no web addresses" in a store's email text. Mail apps (Gmail, Outlook, Apple Mail) turn any bare domain into a link,
 * whatever its top-level domain, so the check must not depend on a short list of TLDs: a member with `settings:write` could otherwise put a payment
 * phishing address into every order confirmation the store sends.
 */
describe("templateProblems refuses web addresses of any top-level domain", () => {
  for (const text of ["Pay the rest at secure-pay-kaizen.ru today", "See kaizen-refunds.top for your refund", "Track it at parcel-help.click", "Go to evil.cn/pay"]) {
    it(text, () => {
      expect(templateProblems({ body: text }, "order.confirmation").some((p) => p.code === "address")).toBe(true);
    });
  }
});

describe("templateProblems' address check, further spellings", () => {
  const hasAddress = (text: string) => templateProblems({ body: text }, "order.confirmation").some((p) => p.code === "address");
  it("refuses an uppercase, an IDN, a punycode and a fullwidth- or ideographic-dot address", () => {
    for (const text of ["PAY AT SECURE-PAY.RU NOW", "Betal på butikk.рф i dag", "Se xn--bttikk-wxa.xn--p1ai", "Gå til evil．top", "Gå til evil。top/pay", "Se shop.example.co.uk/x"]) {
      expect([text, hasAddress(text)]).toEqual([text, true]);
    }
  });
  it("lets ordinary prose, numbers, emails and dotted abbreviations through", () => {
    for (const text of [
      "Takk for handelen. Vi sees!",
      "Det koster 2.50 i gebyr.",
      "Ta kontakt, f.eks. på telefon, bl.a. om levering.",
      "Kontakta oss, t.ex. per telefon, m.fl.",
      "E.g. a gift, i.e. something nice.",
      "Skriv til hjelp@butikken om noe er galt.",
    ]) {
      expect([text, hasAddress(text)]).toEqual([text, false]);
    }
  });
});
