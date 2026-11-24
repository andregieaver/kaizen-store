import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { registerFactsEn } from "@/lib/admin-messages/register-facts.en";
import type { RegisterView } from "@/lib/register-facts";

import { RegisterFactsCard, RegisterLine } from "./register-facts-card";

/** A company's facts from Brønnøysund (D891) as the owner and the platform read them. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

const company = (over: Partial<NonNullable<RegisterView["facts"]>> = {}, accounts: RegisterView["accounts"] | null = undefined as never): RegisterView => ({
  number: "923609016",
  status: "company",
  facts: {
    name: "Nordfjord Energi AS",
    orgForm: "AS",
    orgFormName: "Aksjeselskap",
    industryCode: "35.111",
    industryName: "Produksjon av elektrisitet fra vannkraft",
    employees: 120,
    founded: "2009-03-01",
    municipality: "Bergen",
    website: "nordfjord-energi.no",
    redFlag: null,
    redFlagOn: null,
    ...over,
  },
  accounts:
    accounts === undefined
      ? { year: 2025, currency: "NOK", revenueMinor: 840020200, operatingResultMinor: 20157000, profitMinor: 15117100, equityMinor: 300000000, previousRevenueMinor: 708935200 }
      : accounts,
  checkedAt: "2026-11-24T08:00:00.000Z",
  flaggedAt: null,
});

describe("the company facts card (D891)", () => {
  it("shows what the company is and its latest accounts, with the source", () => {
    const markup = html(h(RegisterFactsCard, { view: company(), words: registerFactsEn, lang: "en" }));
    expect(markup).toContain(registerFactsEn.title);
    expect(markup).toContain("Produksjon av elektrisitet fra vannkraft");
    expect(markup).toContain("120");
    expect(markup).toContain("Bergen");
    expect(markup).toContain('href="https://nordfjord-energi.no"');
    expect(markup).toContain("Revenue 2025");
    expect(markup).toMatch(/NOK\s?8\.4m/i);
    expect(markup).toContain("+18% on the year before");
    expect(markup).toContain("Source: Brønnøysundregistrene, checked");
    expect(markup).not.toContain('role="alert"');
  });

  it("puts a red flag first, and says to turn payment terms off when the company buys on them", () => {
    const flagged = company({ redFlag: "bankrupt", redFlagOn: "2026-11-23" });
    const markup = html(h(RegisterFactsCard, { view: flagged, words: registerFactsEn, lang: "en", termsOn: true }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Bankrupt since 23 Nov 2026");
    expect(markup).toContain(registerFactsEn.termsAdvice);
    expect(html(h(RegisterFactsCard, { view: flagged, words: registerFactsEn, lang: "en" }))).not.toContain(registerFactsEn.termsAdvice);
  });

  it("warns of negative equity, and says when there are no accounts", () => {
    const negative = company({}, { year: 2025, currency: "NOK", revenueMinor: 100, operatingResultMinor: 0, profitMinor: 0, equityMinor: -5, previousRevenueMinor: null });
    expect(html(h(RegisterFactsCard, { view: negative, words: registerFactsEn, lang: "en" }))).toContain(registerFactsEn.negativeEquity);
    expect(html(h(RegisterFactsCard, { view: company({}, null), words: registerFactsEn, lang: "en" }))).toContain(registerFactsEn.noAccounts);
  });

  it("keeps nothing of a sole trader, and says what is missing otherwise", () => {
    const sole: RegisterView = { number: "923609016", status: "sole_trader", facts: null, accounts: null, checkedAt: "2026-11-24T08:00:00.000Z", flaggedAt: null };
    expect(html(h(RegisterFactsCard, { view: sole, words: registerFactsEn, lang: "en" }))).toContain(registerFactsEn.soleTrader);
    expect(html(h(RegisterFactsCard, { view: { ...sole, status: "not_found" }, words: registerFactsEn, lang: "en" }))).toContain(registerFactsEn.notFound);
    expect(html(h(RegisterFactsCard, { view: null, words: registerFactsEn, lang: "en" }))).toContain(registerFactsEn.notLookedUp);
  });

  it("writes the register's words as text, never markup", () => {
    const markup = html(h(RegisterFactsCard, { view: company({ industryName: "<img src=x onerror=alert(1)>" }), words: registerFactsEn, lang: "en" }));
    expect(markup).not.toContain("<img");
  });
});

describe("the visiting company's line (D891)", () => {
  it("is the revenue and the founding year, with a red flag as a chip, and nothing for what is not a company", () => {
    expect(html(h(RegisterLine, { view: company(), words: registerFactsEn, lang: "en" }))).toMatch(/revenue NOK\s?8\.4m \(2025\) · founded 2009/i);
    expect(html(h(RegisterLine, { view: company({ redFlag: "winding_up", redFlagOn: "2026-10-01" }), words: registerFactsEn, lang: "en" }))).toContain("Being wound up");
    expect(html(h(RegisterLine, { view: undefined, words: registerFactsEn, lang: "en" }))).toBe("");
  });
});
