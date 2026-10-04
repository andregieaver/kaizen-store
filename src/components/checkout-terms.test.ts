import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { sentenceParts, termsDisplay, termsPagesOf, termsTemplate, type TermsDisplay } from "@/lib/checkout-terms";
import { t } from "@/lib/i18n";

import { CheckoutTerms } from "./checkout-terms";
import { isTicked, resetTicks, setTicked, termsKey } from "./terms-choice";

/**
 * The sentence by the pay button (wave 1, 1e, `docs/wave-1-trust.md` 2.4): the three modes, one page or two, the words in the
 * shopper's language, links that open in a new tab, a box that must be ticked, and a tick kept in memory only.
 */
const TERMS = { title: "Kjøpsvilkår", href: "/s/demo/no/kjopsvilkar" };
const PRIVACY = { title: "Personvern", href: "/s/demo/no/personvern" };

const display = (mode: "link" | "checkbox", pages: Parameters<typeof termsPagesOf>[0]): TermsDisplay => {
  const shown = termsDisplay(mode, termsPagesOf(pages));
  if (!shown) throw new Error("nothing to show");
  return shown;
};

const draw = (lang: string, shown: TermsDisplay) => {
  const words = t(lang).terms;
  return renderToString(
    createElement(CheckoutTerms, {
      store: "demo",
      market: "no",
      display: shown,
      template: termsTemplate(words, shown),
      newTab: words.newTab,
    }),
  );
};

describe("the sentence's template", () => {
  it("is in the shopper's language and puts the links where the language wants them", () => {
    const both = display("link", { terms: TERMS, privacy: PRIVACY });
    expect(termsTemplate(t("nb").terms, both)).toBe("Ved å bestille godtar du {terms} og bekrefter at du har lest {privacy}.");
    expect(termsTemplate(t("sv").terms, both)).toBe("Genom att beställa godkänner du {terms} och bekräftar att du har läst {privacy}.");
    expect(termsTemplate(t("da").terms, both)).toBe("Når du bestiller, accepterer du {terms} og bekræfter, at du har læst {privacy}.");
    expect(termsTemplate(t("en").terms, both)).toBe("By ordering you accept {terms} and confirm that you have read {privacy}.");
  });

  it("names only the page the store has", () => {
    expect(termsTemplate(t("en").terms, display("link", { terms: TERMS }))).toBe("By ordering you accept {terms}.");
    expect(termsTemplate(t("en").terms, display("link", { privacy: PRIVACY }))).toBe(
      "By ordering you confirm that you have read {privacy}.",
    );
    expect(termsTemplate(t("en").terms, display("checkbox", { terms: TERMS }))).toBe("I accept {terms}.");
    expect(termsTemplate(t("en").terms, display("checkbox", { terms: TERMS, privacy: PRIVACY }))).toBe(
      "I accept {terms} and confirm that I have read {privacy}.",
    );
  });

  it("is cut on its markers, in the order the language put them, and drops a marker it has no page for", () => {
    expect(sentenceParts("A {privacy} then {terms}.")).toEqual([
      { text: "A " },
      { role: "privacy" },
      { text: " then " },
      { role: "terms" },
      { text: "." },
    ]);
    expect(sentenceParts("Plain.")).toEqual([{ text: "Plain." }]);
  });

  it("has words in every hand-written language, and a language with none falls back to English", () => {
    for (const lang of ["nb", "sv", "da", "en", "fr"]) {
      const words = t(lang).terms;
      expect(words.both("{terms}", "{privacy}"), lang).toContain("{terms}");
      expect(words.hint.length, lang).toBeGreaterThan(5);
      expect(words.newTab, lang).toMatch(/\(.+\)/);
    }
    expect(t("fr").terms.hint).toBe(t("en").terms.hint);
  });
});

describe("the sentence in link mode", () => {
  it("is words with the two pages as links that open in a new tab, and no box", () => {
    const html = draw("nb", display("link", { terms: TERMS, privacy: PRIVACY }));
    expect(html).toContain("Ved å bestille godtar du");
    expect(html).toContain('href="/s/demo/no/kjopsvilkar"');
    expect(html).toContain('href="/s/demo/no/personvern"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener"/g)).toHaveLength(2);
    expect(html).toContain("(åpnes i en ny fane)");
    expect(html).not.toContain('type="checkbox"');
  });

  it("names one page when the store has one", () => {
    const html = draw("en", display("link", { terms: TERMS }));
    expect(html).toContain("kjopsvilkar");
    expect(html).not.toContain("personvern");
  });
});

describe("the sentence in checkbox mode", () => {
  it("is a required box, unticked, with the sentence as its label", () => {
    const html = draw("sv", display("checkbox", { terms: TERMS, privacy: PRIVACY }));
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toMatch(/<input[^>]*required/);
    expect(html).not.toMatch(/<input[^>]*checked/);
    const id = /<input[^>]*id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain("Jag godkänner");
    expect(html).toContain('target="_blank"');
  });
});

describe("the tick", () => {
  beforeEach(() => resetTicks());

  it("is kept in memory for one checkout of one store and market, unticked to begin with", () => {
    const key = termsKey("demo", "no");
    expect(isTicked(key)).toBe(false);
    setTicked(key, true);
    expect(isTicked(key)).toBe(true);
    expect(isTicked(termsKey("demo", "se"))).toBe(false);
    resetTicks();
    expect(isTicked(key)).toBe(false);
  });

  it("uses no cookie and no storage", () => {
    for (const file of ["components/terms-choice.ts", "components/checkout-terms.tsx"]) {
      const text = readFileSync(join(process.cwd(), "src", file), "utf8");
      expect(text, file).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/);
    }
  });
});

describe("where the sentence is drawn", () => {
  it("is by the pay button unless the page holds the terms piece, so never twice and never not at all", () => {
    const section = readFileSync(join(process.cwd(), "src/app/s/[store]/[market]/checkout/checkout-section.tsx"), "utf8");
    // The payment form draws it itself while `drawTerms` is true, and the piece draws it on its own.
    expect(section).toMatch(/termsSlot=\{drawTerms \? termsNode\(/);
    expect(section).toMatch(/export async function CheckoutTerms\(/);
    const parts = readFileSync(join(process.cwd(), "src/components/store-part-section.tsx"), "utf8");
    expect(parts).toMatch(/const holdsTerms = route\.holds\?\.includes\("checkout_terms"\)/);
    expect(parts.match(/drawTerms=\{!holdsTerms\}/g)).toHaveLength(2);
  });
});
