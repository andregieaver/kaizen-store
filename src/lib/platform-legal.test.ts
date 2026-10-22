import { describe, expect, it } from "vitest";

import { EMPTY_BUSINESS } from "./navigation";
import { pageInput, pageBlocks, blockText } from "./page-content";
import { localizePage, translationProgress } from "./page-translation";
import {
  feeWords,
  legalDoc,
  legalPageContent,
  legalTopics,
  missingFacts,
  PLATFORM_LEGAL_KINDS,
  PLATFORM_LEGAL_NB_LOCALE,
  PLATFORM_LEGAL_SLUGS,
  PLATFORM_LEGAL_WORDS,
  type PlatformLegalFacts,
} from "./platform-legal";

const business = { legalName: "Kaizena AS", organisationNumber: "999 999 999", postalAddress: "Gata 1\n0150 Oslo", contactEmail: "hei@example.com" };
const facts: PlatformLegalFacts = { business, saleFeeBps: 199, today: new Date("2026-10-22T12:00:00Z") };
const blank: PlatformLegalFacts = { ...facts, business: EMPTY_BUSINESS };

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const words = (content: ReturnType<typeof legalPageContent>) => pageBlocks(content).map(blockText).join(" ");

describe("Kaizena Flow's legal pages", () => {
  it("has the same sections in the same order in English and Norwegian", () => {
    for (const kind of PLATFORM_LEGAL_KINDS) expect(legalTopics(kind, "nb", facts)).toEqual(legalTopics(kind, "en", facts));
  });

  it("writes every heading and text in Norwegian, never the English", () => {
    for (const kind of PLATFORM_LEGAL_KINDS) {
      const en = legalDoc(kind, "en", facts);
      const nb = legalDoc(kind, "nb", facts);
      expect(nb.title).not.toBe(en.title);
      nb.sections.forEach((section, i) => {
        expect(section.heading).not.toBe(en.sections[i].heading);
        if (section.topic !== "contact") expect(section.body).not.toBe(en.sections[i].body);
      });
    }
  });

  it("is a page the builder accepts, with every text translated into Norwegian", () => {
    for (const kind of PLATFORM_LEGAL_KINDS) {
      const content = legalPageContent(kind, facts, ids);
      expect(pageInput.safeParse(content).success).toBe(true);
      expect(content.slug).toBe(PLATFORM_LEGAL_SLUGS[kind]);
      const { done, of } = translationProgress(content, PLATFORM_LEGAL_NB_LOCALE);
      // The contact block is the same words in both languages; everything else has its own.
      expect(of - done).toBeLessThanOrEqual(1);
      expect(localizePage(content, PLATFORM_LEGAL_NB_LOCALE).title).toBe(legalDoc(kind, "nb", facts).title);
    }
  });

  it("fills in the business details and the sale fee", () => {
    const terms = words(legalPageContent("terms", facts, ids));
    expect(terms).toContain("Kaizena AS");
    expect(terms).toContain("999 999 999");
    expect(terms).toContain("Gata 1, 0150 Oslo");
    expect(terms).toContain("1.99 %");
    expect(words(localizePage(legalPageContent("terms", facts, ids), PLATFORM_LEGAL_NB_LOCALE))).toContain("1,99 %");
    expect(feeWords(250, "en")).toBe("2.5 %");
  });

  it("shows a placeholder for a missing fact, never an invented one", () => {
    expect(missingFacts(EMPTY_BUSINESS)).toEqual(["legalName", "organisationNumber", "postalAddress", "contactEmail"]);
    expect(missingFacts(business)).toEqual([]);
    for (const lang of ["en", "nb"] as const) {
      const privacy = legalDoc("privacy", lang, blank).sections.map((s) => s.body).join(" ");
      for (const placeholder of Object.values(PLATFORM_LEGAL_WORDS[lang].missing)) {
        if (placeholder !== PLATFORM_LEGAL_WORDS[lang].missing.postalAddress) expect(privacy).toContain(placeholder);
      }
    }
  });

  it("links each language's pages in that language", () => {
    for (const lang of ["en", "nb"] as const) {
      const prefix = lang === "nb" ? "/no/" : "/";
      for (const kind of PLATFORM_LEGAL_KINDS) {
        for (const section of legalDoc(kind, lang, facts).sections) {
          for (const [, href] of section.body.matchAll(/\]\(([^)]+)\)/g)) expect(href.startsWith(prefix) && !href.startsWith(lang === "en" ? "/no/" : "//")).toBe(true);
        }
      }
    }
  });

  it("names the law in each language's own words", () => {
    const en = PLATFORM_LEGAL_KINDS.map((kind) => JSON.stringify(legalDoc(kind, "en", facts))).join(" ");
    expect(en).not.toMatch(/artikkel|personvernforordningen|bokføringsloven/);
    const nb = PLATFORM_LEGAL_KINDS.map((kind) => JSON.stringify(legalDoc(kind, "nb", facts))).join(" ");
    expect(nb).not.toMatch(/\bGDPR\b|Article \d/);
    // The glossary's words (src/lib/i18n-glossary.ts).
    for (const term of ["personopplysninger", "behandlingsansvarlig", "databehandleravtale", "personvernerklæring", "samtykke", "rett til å", "informasjonskapsler", "merverdiavgift"]) {
      expect(nb).toContain(term);
    }
    // Every right the privacy notice names cites its article.
    const rights = legalDoc("privacy", "nb", facts).sections.find((s) => s.topic === "rights")!.body;
    for (const article of ["15", "16", "17", "18", "20", "21"]) expect(rights).toMatch(new RegExp(`artikkel ${article}\\b`));
  });
});
