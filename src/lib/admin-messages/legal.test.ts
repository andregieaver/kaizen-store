import { describe, expect, it } from "vitest";

import { A11Y_STATUS_WORDS } from "../a11y-statement";
import { TERMS_MODE_WORDS, termsSettingNotice } from "../checkout-terms";
import { CODE_PLACE_LABELS } from "../custom-code";
import { missingFacts, type LegalFacts } from "../legal-facts";
import { LEGAL_ROLE_COPY } from "../legal-roles";
import { languageNames } from "../legal-admin-words";

import { legalEn } from "./legal.en";
import { legalNb } from "./legal.nb";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function pairs(en: unknown, nb: unknown, path = ""): [string, string, string][] {
  if (typeof en === "string") return [[path, en, String(nb)]];
  return Object.entries(en as Record<string, unknown>).flatMap(([key, value]) => pairs(value, (nb as Record<string, unknown>)[key], `${path}.${key}`));
}

describe("the legal catalogue (D312 A8)", () => {
  it("says in English what the libraries say", () => {
    expect(legalEn.pages.roles).toEqual(LEGAL_ROLE_COPY);
    expect(legalEn.terms.modes).toEqual(TERMS_MODE_WORDS);
    expect(legalEn.a11y.statuses).toEqual(A11Y_STATUS_WORDS);
    expect(legalEn.cookies.code.places).toEqual(CODE_PLACE_LABELS);
    expect(termsSettingNotice("link", [])).toBe(legalEn.terms.noTerms);
    expect(termsSettingNotice("checkbox", [{ role: "privacy", title: "P", href: "/p" }])).toBe(legalEn.terms.noTickTerms);
  });

  it("knows every detail missingFacts() names", () => {
    const empty = { legalName: "", organisationNumber: "", address: "", email: "", country: "", vat: { registered: true, number: "" }, markets: [], shipping: [{ rateMinor: null }] } as unknown as LegalFacts;
    expect(missingFacts(empty).sort()).toEqual(Object.values(legalEn.pages.missing).sort());
  });

  it("keeps every placeholder in Norwegian", () => {
    for (const [path, en, nb] of pairs(legalEn, legalNb)) expect(placeholders(nb), path).toEqual(placeholders(en));
  });

  it("names the languages a draft was written in, in the admin's language", () => {
    expect(languageNames(["nb", "sv"], "en")).toBe("Norwegian Bokmål, Swedish");
    expect(languageNames(["sv"], "nb")).toBe("svensk");
  });
});
