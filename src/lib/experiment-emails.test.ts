import { describe, expect, it } from "vitest";


import { renderEmail } from "./email-layout";
import { staffEmailsEn } from "@/lib/admin-messages/staff-emails.en";
import { answeredEmail, guardrailEmail, orderRate, type GuardrailFacts } from "./experiment-emails";
import { staffEmailsNb } from "./admin-messages/staff-emails.nb";

const facts: GuardrailFacts = {
  storeName: "Fjord Goods",
  testName: "Longer story",
  target: "/om-oss",
  version: { key: "b", name: "Versjon B", visitors: 5000, buyers: 130 },
  original: { visitors: 5000, buyers: 250 },
  days: 6,
  url: "https://kaizenaflow.com/admin/fjord/experiments/abc",
};

describe("orderRate", () => {
  it("says orders per hundred visitors, with a decimal below ten", () => {
    expect(orderRate(130, 5000)).toBe("2.6 %");
    expect(orderRate(250, 5000)).toBe("5 %");
    expect(orderRate(1200, 5000)).toBe("24 %");
    expect(orderRate(3, 0)).toBe("0 %");
  });
});

describe("guardrailEmail", () => {
  const email = renderEmail(guardrailEmail(facts, staffEmailsEn));

  it("names the test, the version and the figures that were counted", () => {
    expect(email.subject).toBe('Your A/B test "Longer story" was stopped: fewer orders in version B');
    expect(email.text).toContain("130 of 5,000 visitors who saw version B ordered (2.6 %), against 250 of 5,000 who saw the original (5 %).");
    expect(email.text).toContain("had run for 6 days");
    expect(email.text).toContain("/om-oss");
  });

  it("says which guardrail stopped it, with what that guardrail counted (D148 phase 19)", () => {
    const speed = renderEmail(guardrailEmail({ ...facts, guardrail: { kind: "speed", version: { n: 2000, bad: 400 }, original: { n: 2000, bad: 200 } } }, staffEmailsEn));
    expect(speed.subject).toBe('Your A/B test "Longer story" was stopped: slower pages in version B');
    expect(speed.text).toContain("400 of 2,000 page loads of version B took more than 2.5 seconds to show their main content (20 %), against 200 of 2,000 of the original (10 %).");
    const checkout = renderEmail(guardrailEmail({ ...facts, guardrail: { kind: "checkout", version: { n: 300, bad: 60 }, original: { n: 300, bad: 6 } } }, staffEmailsNb, "nb"));
    expect(checkout.subject).toBe("A/B-testen «Longer story» ble stoppet: flere mislykkede betalinger i versjon B");
    expect(checkout.text).toContain("60 av 300 besøkende som startet i kassen i versjon B, fikk en mislykket betaling (20 %), mot 6 av 300 i originalen (2 %).");
  });

  it("says what changed for visitors and what the owner may do, and that nothing is applied by itself", () => {
    expect(email.text).toContain("everyone sees the page as it was before the test");
    expect(email.text).toContain("Kaizena Flow does not apply anything by itself");
    expect(email.text).toContain(facts.url);
  });

  it("does not say why the version did worse, and makes no promise about the future", () => {
    expect(email.text).not.toMatch(/because|will lose|guarantee/i);
  });

  it("says one day in the singular and escapes what the owner wrote", () => {
    const html = renderEmail(guardrailEmail({ ...facts, days: 1, testName: "<b>x</b>" }, staffEmailsEn));
    expect(html.text).toContain("had run for 1 day when");
    expect(html.html).not.toContain("<b>x</b>");
  });
});

describe("answeredEmail (D662)", () => {
  const facts = {
    storeName: "Fjord Goods",
    testName: "Shorter hero",
    target: "Front page: Forside",
    headline: "B is better than the original.",
    detail: "B got 29 % more visitors who added to the cart than the original (9.08 % to 11.7 %).",
    days: 16,
    url: "https://kaizenaflow.com/admin/fjord/experiments/abc",
  };

  it("says the test has an answer, gives the store's own verdict, and leaves deciding to the owner", () => {
    const email = renderEmail(answeredEmail(facts, staffEmailsEn));
    expect(email.subject).toBe('Your A/B test "Shorter hero" has an answer');
    expect(email.text).toContain("has run for 16 days");
    expect(email.text).toContain("B is better than the original. B got 29 % more visitors");
    expect(email.text).toContain("does not change your page by itself");
    expect(email.text).toContain(facts.url);
  });

  it("is written in the reader's language", () => {
    const email = renderEmail(answeredEmail({ ...facts, days: 1 }, staffEmailsNb, "nb"));
    expect(email.subject).toBe("A/B-testen din «Shorter hero» har et svar");
    expect(email.text).toContain("har gått i 1 dag");
  });
});
