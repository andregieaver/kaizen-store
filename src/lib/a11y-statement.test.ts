import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { A11Y_TEXTS } from "./a11y-statement-text";
import {
  A11Y_KEYS_META,
  A11Y_REQUIRED_TOPICS,
  A11Y_REVIEW_MANIFEST,
  A11Y_STATUSES,
  DEFAULT_A11Y_SETTINGS,
  ENFORCEMENT_BODIES,
  a11yProblems,
  accessibilityStatement,
  effectiveStatus,
  enforcementBodyOf,
  statementSections,
  type A11yFacts,
  type A11ySettings,
} from "./a11y-statement";
import { STARTER_LANGUAGES, type StarterLanguage } from "./legal-starters";
import { blockingIssues, pageIssues } from "./page-a11y";
import { newPageContent, parsePageContent } from "./page-content";

const counter = () => {
  let n = 0;
  return () => `s${++n}`;
};

const facts: A11yFacts = {
  storeName: "Demo Butikk",
  siteAddresses: ["https://demo.example/s/demo/no"],
  languages: ["norsk", "English"],
  countries: ["NO", "SE", "DK", "DE"],
  themeWarnings: 2,
  mediaWithoutAlt: { missing: 3, total: 40 },
  pagesWithBlockingIssues: 1,
};
const bare: A11yFacts = { storeName: "", siteAddresses: [], languages: [], countries: [], themeWarnings: 0, mediaWithoutAlt: null, pagesWithBlockingIssues: null };
const settings = (over: Partial<A11ySettings> = {}): A11ySettings => ({ ...DEFAULT_A11Y_SETTINGS, contactEmail: "uu@demo.example", ...over });
const text = (language: StarterLanguage, s: A11ySettings, f = facts) => JSON.stringify(statementSections(language, s, f));

describe("the statement's status", () => {
  it("is not assessed by default, and says exactly that, in every language", () => {
    expect(DEFAULT_A11Y_SETTINGS.status).toBe("not_assessed");
    for (const language of STARTER_LANGUAGES) {
      const sections = statementSections(language, settings(), facts);
      const status = JSON.stringify(sections.find((s) => s.topic === "status"));
      expect(status).toContain(A11Y_TEXTS[language].m["a11y.status.not_assessed"].replace("{store}", "Demo Butikk"));
      expect(status).not.toContain(A11Y_TEXTS[language].m["a11y.status.full"].slice(0, 40));
      expect(JSON.stringify(sections.find((s) => s.topic === "assessment"))).toContain(A11Y_TEXTS[language].m["a11y.assessment.none"]);
    }
    expect(text("en", settings())).toMatch(/has not assessed this website/);
    expect(text("en", settings())).toMatch(/so we do not say that it does/);
  });

  it("never says the site conforms without an assessor and a date", () => {
    expect(effectiveStatus(settings({ status: "full" }))).toBe("not_assessed");
    expect(effectiveStatus(settings({ status: "full", assessedBy: "Audit AS" }))).toBe("not_assessed");
    expect(effectiveStatus(settings({ status: "full", assessedOn: "2026-09-01" }))).toBe("not_assessed");
    expect(effectiveStatus(settings({ status: "full", assessedBy: "  ", assessedOn: "2026-09-01" }))).toBe("not_assessed");
    expect(effectiveStatus(settings({ status: "full", assessedBy: "Audit AS", assessedOn: "2026-09-01" }))).toBe("full");
    // Even a forced "full" with nothing behind it builds the not-assessed text.
    for (const language of STARTER_LANGUAGES) {
      expect(text(language, settings({ status: "full" }))).not.toContain(A11Y_TEXTS[language].m["a11y.status.full"].slice(0, 50));
    }
    expect(effectiveStatus(settings({ status: "partial" }))).toBe("not_assessed");
    expect(effectiveStatus(settings({ status: "partial", assessmentNote: "Missing labels on the search form" }))).toBe("partial");
    expect(effectiveStatus(settings({ status: "not_assessed", assessedBy: "Audit AS", assessedOn: "2026-09-01" }))).toBe("not_assessed");
  });

  it("says who assessed it, when, and where the report is, once it has been", () => {
    const s = settings({ status: "full", assessedBy: "Audit AS", assessedOn: "2026-09-01", reportUrl: "https://audit.example/report", assessmentNote: "Tested with NVDA." });
    const out = text("en", s);
    expect(out).toContain("conforms to the Web Content Accessibility Guidelines");
    expect(out).toContain("Assessed by Audit AS on 2026-09-01.");
    expect(out).toContain("https://audit.example/report");
    expect(out).toContain("Tested with NVDA.");
    expect(text("nb", s)).toContain("Vurdert av Audit AS den 2026-09-01.");
    expect(text("sv", s)).toContain("Bedömd av Audit AS den 2026-09-01.");
    expect(text("da", s)).toContain("Vurderet af Audit AS den 2026-09-01.");
  });

  it("says partial conformity in its own words", () => {
    const out = text("en", settings({ status: "partial", assessedBy: "Audit AS", assessedOn: "2026-09-01" }));
    expect(out).toContain("partly conforms");
    expect(out).not.toContain("This website conforms");
  });
});

describe("what the site knows and the owner says", () => {
  it("lists the site's own findings and the owner's known issues, one line each", () => {
    const out = text("en", settings({ knownIssues: "The size chart is a picture.\n\n  The map has no text alternative.  " }));
    expect(out).toContain("below the recommended contrast of 4.5 to 1, so some text can be hard to read: 2.");
    expect(out).toContain("with no alt text: 3 of 40.");
    expect(out).toContain("empty links: 1.");
    expect(out).toContain("The size chart is a picture.");
    expect(out).toContain("The map has no text alternative.");
    const known = statementSections("en", settings({ knownIssues: "A\nB" }), facts).find((s) => s.topic === "known_issues")!;
    expect("ul" in known.blocks[0] && known.blocks[0].ul).toHaveLength(5);
  });

  it("does not claim there are no issues, only that none is known, when there are none", () => {
    const known = JSON.stringify(statementSections("en", settings(), bare).find((s) => s.topic === "known_issues"));
    expect(known).toContain("We know of no issues");
    expect(known).toContain("This does not mean there are none");
  });

  it("names the payment form as a part from another provider, which we have not assessed", () => {
    for (const language of STARTER_LANGUAGES) expect(text(language, settings())).toContain("Stripe");
    expect(text("en", settings())).toMatch(/not assessed its accessibility ourselves/);
  });

  it("has the microenterprise sentence only when the owner ticked it, with a check for the reviewer", () => {
    expect(text("en", settings())).not.toMatch(/microenterprise/i);
    const out = text("en", settings({ microenterprise: true }));
    expect(out).toContain("fewer than 10 staff");
    expect(out).toContain("EUR 2 million");
    expect(out).toContain("Article 4(5)");
    expect(out).toMatch(/\[\[Check: that the business meets the conditions/);
    for (const language of STARTER_LANGUAGES) expect(statementSections(language, settings({ microenterprise: true }), facts).some((s) => s.topic === "microenterprise")).toBe(true);
  });

  it("gives the contact, the site and the dates, and a placeholder for what it lacks", () => {
    const out = text("en", settings({ preparedOn: "2026-10-03", reviewedOn: "2026-10-10" }));
    expect(out).toContain("uu@demo.example");
    expect(out).toContain("https://demo.example/s/demo/no");
    expect(out).toContain("norsk and English");
    expect(out).toContain("prepared on 2026-10-03");
    expect(out).toContain("last reviewed on 2026-10-10");
    const none = text("en", settings({ contactEmail: null }), bare);
    expect(none).toContain("[[Add: contact email]]");
    expect(none).toContain("[[Add: the website address]]");
    expect(none).toContain("[[Add: date]]");
    expect(none).toContain("[[Add: store name]]");
    expect(none).toContain("[[Check: the information the European Accessibility Act asks for");
  });
});

describe("who to complain to", () => {
  it("has an entry for Norway, Sweden and Denmark, every one unverified, with its source and the day it was read", () => {
    expect(Object.keys(ENFORCEMENT_BODIES).sort()).toEqual(["DK", "NO", "SE"]);
    for (const body of Object.values(ENFORCEMENT_BODIES)) {
      expect(body.verified).toBe(false);
      expect(body.checkedOn).toBe("2026-10-03");
      expect(body.source.length).toBeGreaterThan(20);
      expect(body.body.length).toBeGreaterThan(3);
    }
    expect(enforcementBodyOf("no")?.body).toMatch(/Digdir/);
    expect(enforcementBodyOf("SE")?.body).toMatch(/PTS/);
    expect(enforcementBodyOf("DE")).toBeNull();
  });

  it("prints each unverified body with 'check with the authority', and says Norway's position is not confirmed", () => {
    const en = text("en", settings());
    expect(en).toContain("Norway: possibly Digitaliseringsdirektoratet (Digdir), UU-tilsynet. This has not been verified: check with the authority.");
    expect(en).toContain("Sweden: possibly Post- och telestyrelsen (PTS)");
    expect(en).toContain("Denmark: possibly Erhvervsstyrelsen");
    expect(en).toContain("Germany: the national market surveillance authority for accessibility");
    expect(en).toContain("The rules that apply to you in Norway: check with Digdir.");
    expect(text("nb", settings())).toContain("sjekk med myndigheten");
    expect(text("sv", settings())).toContain("hör med myndigheten");
    expect(text("da", settings())).toContain("tjek med myndigheden");
  });

  it("would print a verified body plainly", () => {
    const original = ENFORCEMENT_BODIES.NO.verified;
    ENFORCEMENT_BODIES.NO.verified = true;
    try {
      expect(text("en", settings())).toContain("Norway: Digitaliseringsdirektoratet (Digdir), UU-tilsynet.");
    } finally {
      ENFORCEMENT_BODIES.NO.verified = original;
    }
  });
});

describe("what the owner may save", () => {
  it("refuses full without an assessor and a date, and partial without any evidence", () => {
    expect(a11yProblems(settings())).toEqual([]);
    expect(a11yProblems(settings({ status: "full" }))[0]).toMatch(/who assessed it and on what date/);
    expect(a11yProblems(settings({ status: "full", assessedBy: "Audit AS" }))).toHaveLength(1);
    expect(a11yProblems(settings({ status: "full", assessedBy: "Audit AS", assessedOn: "2026-09-01" }))).toEqual([]);
    expect(a11yProblems(settings({ status: "partial" }))[0]).toMatch(/who assessed/);
    expect(a11yProblems(settings({ status: "partial", assessmentNote: "Notes" }))).toEqual([]);
  });

  it("checks dates, addresses and lengths", () => {
    expect(a11yProblems(settings({ assessedOn: "2026-02-30" }))[0]).toMatch(/not a date/);
    expect(a11yProblems(settings({ assessedOn: "01.09.2026" }))[0]).toMatch(/not a date/);
    expect(a11yProblems(settings({ reportUrl: "ftp://x" }))[0]).toMatch(/http/);
    expect(a11yProblems(settings({ reportUrl: "javascript:alert(1)" }))[0]).toMatch(/http/);
    expect(a11yProblems(settings({ contactEmail: "nobody" }))[0]).toMatch(/not an email/);
    expect(a11yProblems(settings({ knownIssues: "x".repeat(4001) }))[0]).toMatch(/4000/);
    expect(a11yProblems(settings({ assessmentNote: "x".repeat(2001) }))[0]).toMatch(/2000/);
    expect(a11yProblems(settings({ preparedOn: "2026-10-03", reviewedOn: "2026-10-01" }))[0]).toMatch(/before it was prepared/);
    expect(a11yProblems(settings({ preparedOn: "2026-10-03", reviewedOn: "2026-10-03" }))).toEqual([]);
    expect(A11Y_STATUSES).toEqual(["not_assessed", "partial", "full"]);
  });
});

describe("the page it makes", () => {
  it("is a draft with the notice first, in every language, that the site accepts as page content", () => {
    for (const language of STARTER_LANGUAGES) {
      const made = accessibilityStatement(language, settings(), facts, counter());
      expect(made.ok).toBe(true);
      if (!made.ok) continue;
      expect(made.page.rows).toHaveLength(2);
      expect(made.page.rows[0].columns[0].blocks[0]).toMatchObject({ type: "richText", className: "legal-review-notice" });
      expect(parsePageContent({ ...newPageContent(), title: made.page.title, slug: made.page.slug, rows: made.page.rows })).not.toBeNull();
      const topics = made.page.rows[1].columns[0].blocks.filter((b) => b.type === "heading" && b.level === 2).map((b) => (b as { htmlId?: string }).htmlId);
      for (const topic of A11Y_REQUIRED_TOPICS) expect(topics).toContain(`t-${topic}`);
    }
  });

  it("refuses to make a statement from settings that cannot hold", () => {
    const made = accessibilityStatement("en", settings({ status: "full" }), facts, counter());
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.problems[0]).toMatch(/who assessed it/);
  });

  it("has the same sections in every language, and the checker blocks it for its notice and placeholders only", () => {
    const variants: A11ySettings[] = [settings(), settings({ microenterprise: true, status: "partial", assessmentNote: "n" }), settings({ status: "full", assessedBy: "A", assessedOn: "2026-09-01", reportUrl: "https://a.example", preparedOn: "2026-10-03", reviewedOn: "2026-10-04" })];
    for (const variant of variants) {
      const shapes = STARTER_LANGUAGES.map((language) => statementSections(language, variant, facts).map((s) => [s.topic, s.blocks.map((b) => ("p" in b ? "p" : `ul${b.ul.length}`))]));
      for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    }
    const made = accessibilityStatement("en", settings(), bare, counter());
    if (!made.ok) throw new Error("expected a page");
    expect(new Set(blockingIssues(pageIssues({ title: made.page.title, rows: made.page.rows })).map((i) => i.rule))).toEqual(new Set(["legal_notice", "placeholder"]));
    const full = accessibilityStatement("en", settings({ preparedOn: "2026-10-03" }), facts, counter());
    if (!full.ok) throw new Error("expected a page");
    expect(pageIssues({ title: full.page.title, rows: full.page.rows.slice(1) }).filter((i) => i.rule !== "placeholder")).toEqual([]);
  });

  it("leaves no hole unfilled and no tool or model named", () => {
    for (const language of STARTER_LANGUAGES) {
      const out = text(language, settings({ microenterprise: true, status: "partial", assessedBy: "A", assessedOn: "2026-09-01", knownIssues: "x" }));
      expect(out).not.toMatch(/\{[A-Za-z0-9_]+\}/);
    }
  });
});

describe("the texts", () => {
  it("have the same keys in all four languages and the same {holes} in every sentence", () => {
    const reference = Object.keys(A11Y_TEXTS.en.m).sort();
    const holes = (t: string) => [...t.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    for (const language of STARTER_LANGUAGES) {
      expect({ language, keys: Object.keys(A11Y_TEXTS[language].m).sort() }).toEqual({ language, keys: reference });
      for (const key of reference) expect([language, key, holes(A11Y_TEXTS[language].m[key])]).toEqual([language, key, holes(A11Y_TEXTS.en.m[key])]);
    }
    expect(reference.filter((k) => A11Y_KEYS_META.test(k)).length).toBeGreaterThan(5);
  });

  it("are written in their own language, and open with the draft notice", () => {
    for (const language of ["nb", "sv", "da"] as const) {
      const same = Object.entries(A11Y_TEXTS[language].m).filter(([k, t]) => t.length > 30 && t === A11Y_TEXTS.en.m[k]);
      expect(same.map(([k]) => k)).toEqual([]);
    }
    expect(A11Y_TEXTS.en.m.notice).toMatch(/^DRAFT/);
    expect(A11Y_TEXTS.nb.m.notice).toMatch(/^UTKAST/);
    expect(A11Y_TEXTS.sv.m.notice).toMatch(/^UTKAST/);
    expect(A11Y_TEXTS.da.m.notice).toMatch(/^UDKAST/);
  });

  it("are not machine-translated and are on the list of what needs a person to read it", () => {
    for (const file of A11Y_REVIEW_MANIFEST.files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) expect([file, /ui-catalog|icu-lite|\/i18n|ai-provider|\/server\/|translate|ui-text|email-text/.test(spec)]).toEqual([file, false]);
    }
    expect(A11Y_REVIEW_MANIFEST.items).toEqual(expect.arrayContaining(["microenterprise sentence"]));
  });
});
