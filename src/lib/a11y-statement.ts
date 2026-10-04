/**
 * The accessibility statement generator (wave 1, 1e, `docs/wave-1-trust.md` 2.3, 4.3): a draft page in Norwegian, Swedish,
 * Danish or English made from what the owner says (`accessibility_settings`) and what the site itself knows (theme
 * contrast warnings, pictures without alt text, pages the checker flags), flagged for review like every legal text. Pure.
 *
 * Its two rules that matter: the status defaults to "has not been assessed" and the text then says exactly that, and a
 * statement never says the site "conforms" without an audit's assessor and date (`a11yProblems()` refuses it, and so does
 * the database). It also never claims anything about Kaizen's own tests of the store's pages. The enforcement body per
 * country is data with its source, the date it was read and whether anyone has verified it; an unverified entry is printed
 * with "check with the authority".
 */
import { A11Y_TEXTS } from "./a11y-statement-text";
import { draftRows, fill, type RenderedBlock, type RenderedSection, type StarterLanguage, type StarterPage } from "./legal-starters";
import type { NewId } from "./page-rows";

export const A11Y_STATUSES = ["not_assessed", "partial", "full"] as const;
export type A11yStatus = (typeof A11Y_STATUSES)[number];
export const isA11yStatus = (value: unknown): value is A11yStatus => (A11Y_STATUSES as readonly unknown[]).includes(value);

export const A11Y_STATUS_WORDS: Record<A11yStatus, { name: string; hint: string }> = {
  not_assessed: { name: "Not assessed", hint: "Nobody has checked the site against the requirements. The statement says so." },
  partial: { name: "Partly meets the requirements", hint: "An assessment found that some parts do not meet them. Give who assessed it, or your notes." },
  full: { name: "Meets the requirements", hint: "An independent assessment found that it does. Needs who assessed it and when." },
};

/** What the owner says (`commerce.accessibility_settings`). Dates are `YYYY-MM-DD`. */
export type A11ySettings = {
  status: A11yStatus;
  assessedBy: string | null;
  assessedOn: string | null;
  reportUrl: string | null;
  assessmentNote: string | null;
  microenterprise: boolean;
  knownIssues: string;
  contactEmail: string | null;
  preparedOn: string | null;
  reviewedOn: string | null;
};

export const DEFAULT_A11Y_SETTINGS: A11ySettings = {
  status: "not_assessed",
  assessedBy: null,
  assessedOn: null,
  reportUrl: null,
  assessmentNote: null,
  microenterprise: false,
  knownIssues: "",
  contactEmail: null,
  preparedOn: null,
  reviewedOn: null,
};

/** What the site itself knows, read by the server and never given by the owner. */
export type A11yFacts = {
  storeName: string;
  /** The addresses of the site, with the language of each market's address if the store has several. */
  siteAddresses: string[];
  /** The names of the languages the site is in. */
  languages: string[];
  /** The countries the store sells to (ISO alpha-2), the store's own first. */
  countries: string[];
  /** Colour pairs in the theme below 4.5 to 1 (`themeWarnings()`). */
  themeWarnings: number;
  /** Pictures in the media library with no alt text, and how many there are; null when not known. */
  mediaWithoutAlt: { missing: number; total: number } | null;
  /** Published pages with a blocking issue from the page checker; null when not known. */
  pagesWithBlockingIssues: number | null;
};

// ---------------------------------------------------------------------------
// Who supervises, by country
// ---------------------------------------------------------------------------

export type EnforcementBody = {
  country: string;
  /** The body's own name, which is never translated. */
  body: string;
  /** Where the entry was read, and the day. */
  source: string;
  checkedOn: string;
  /** Whether a person has read the authority's own page and found this right. Every entry starts false. */
  verified: boolean;
};

/**
 * The authority that supervises accessibility, per country, as far as was found (docs/wave-1-trust.md 4.3). Every entry is
 * `verified: false`: a reviewer sets it when they have read the authority's own page. Printed with "check with the authority"
 * until then. A country not listed is told to find its national market surveillance authority.
 */
export const ENFORCEMENT_BODIES: Record<string, EnforcementBody> = {
  NO: {
    country: "NO",
    body: "Digitaliseringsdirektoratet (Digdir), UU-tilsynet",
    source: "A search result summarising uutilsynet.no; the authority's own page (uutilsynet.no/regelverk/ikt-lovene) returned 404",
    checkedOn: "2026-10-03",
    verified: false,
  },
  SE: {
    country: "SE",
    body: "Post- och telestyrelsen (PTS)",
    source: "https://www.lflegal.com/lf-country/european-accessibility-act-eaa-enforcement-and-implementation/ (a secondary source); PTS's own page could not be read",
    checkedOn: "2026-10-03",
    verified: false,
  },
  DK: {
    country: "DK",
    body: "Erhvervsstyrelsen",
    source: "https://erhvervsstyrelsen.dk/om-markedsovervaagning (says it enforces the accessibility act, not that it covers webshops); a search result also names Sikkerhedsstyrelsen",
    checkedOn: "2026-10-03",
    verified: false,
  },
};

/** The body for a country, or null where none is listed. */
export const enforcementBodyOf = (country: string): EnforcementBody | null => ENFORCEMENT_BODIES[country.toUpperCase()] ?? null;

// ---------------------------------------------------------------------------
// What the owner may say
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/** Why the settings cannot be saved or a statement made, as sentences for the form; an empty list when they can. */
export function a11yProblems(settings: A11ySettings): string[] {
  const problems: string[] = [];
  const by = (settings.assessedBy ?? "").trim();
  const on = (settings.assessedOn ?? "").trim();
  if (!isA11yStatus(settings.status)) problems.push("Choose how accessible the site is.");
  if (settings.status === "full" && (by === "" || on === "")) problems.push("To say the site meets the requirements, give who assessed it and on what date. Without an assessment the statement can only say that it has not been assessed.");
  if (settings.status === "partial" && by === "" && on === "" && (settings.assessmentNote ?? "").trim() === "") problems.push("Give who assessed the site and when, or your notes from the assessment.");
  if (on !== "" && !validDate(on)) problems.push("The date of the assessment is not a date (use year-month-day).");
  if (by.length > 200) problems.push("Keep the assessor's name under 200 characters.");
  if (settings.reportUrl && !/^https?:\/\/\S+$/i.test(settings.reportUrl.trim())) problems.push("The report's address must start with http:// or https://.");
  if ((settings.assessmentNote ?? "").length > 2000) problems.push("Keep the assessment notes under 2000 characters.");
  if (settings.knownIssues.length > 4000) problems.push("Keep the known issues under 4000 characters.");
  if (settings.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.contactEmail.trim())) problems.push("The contact email is not an email address.");
  for (const [name, value] of [["prepared", settings.preparedOn], ["reviewed", settings.reviewedOn]] as const) {
    if (value && !validDate(value)) problems.push(`The date the statement was ${name} is not a date (use year-month-day).`);
  }
  if (settings.preparedOn && settings.reviewedOn && validDate(settings.preparedOn) && validDate(settings.reviewedOn) && settings.reviewedOn < settings.preparedOn) problems.push("The statement cannot have been reviewed before it was prepared.");
  return problems;
}

/** The status the statement will say: a claim that needs an assessment falls back to "not assessed" without one, never to a claim. */
export function effectiveStatus(settings: A11ySettings): A11yStatus {
  const by = (settings.assessedBy ?? "").trim();
  const on = (settings.assessedOn ?? "").trim();
  if (settings.status === "full") return by !== "" && on !== "" ? "full" : "not_assessed";
  if (settings.status === "partial") return by !== "" || on !== "" || (settings.assessmentNote ?? "").trim() !== "" ? "partial" : "not_assessed";
  return "not_assessed";
}

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------

export const A11Y_REQUIRED_TOPICS = ["status", "standard", "assessment", "scope", "known_issues", "third_party", "feedback", "enforcement", "prepared"] as const;

type Args = Record<string, string>;
type Block = { p: string; args?: Args } | { ul: { key: string; args?: Args }[] };

const defang = (text: string) => text.replace(/\[/g, "(").replace(/\]/g, ")");

/** The sections of the statement in a language, with their words. */
export function statementSections(language: StarterLanguage, settings: A11ySettings, facts: A11yFacts): RenderedSection[] {
  const text = A11Y_TEXTS[language];
  const m = text.m;
  const placeholder = (kind: "ph.add" | "ph.check", label: string) => `[[${m[kind]}: ${m[`label.${label}`] ?? label}]]`;
  let regions: Intl.DisplayNames | null = null;
  try {
    regions = new Intl.DisplayNames([text.locale], { type: "region" });
  } catch {
    regions = null;
  }
  const country = (code: string) => regions?.of(code) ?? code;
  const list = (items: readonly string[]) => {
    try {
      return new Intl.ListFormat(text.locale, { style: "long", type: "conjunction" }).format(items);
    } catch {
      return items.join(", ");
    }
  };
  const status = effectiveStatus(settings);
  const by = (settings.assessedBy ?? "").trim();
  const on = (settings.assessedOn ?? "").trim();
  const email = settings.contactEmail?.trim() ? defang(settings.contactEmail.trim()) : placeholder("ph.add", "email");
  const own = settings.knownIssues.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const issues: { key: string; args?: Args }[] = [
    ...(facts.themeWarnings > 0 ? [{ key: "a11y.issue.theme", args: { n: String(facts.themeWarnings) } }] : []),
    ...(facts.mediaWithoutAlt && facts.mediaWithoutAlt.missing > 0 ? [{ key: "a11y.issue.alt", args: { missing: String(facts.mediaWithoutAlt.missing), total: String(facts.mediaWithoutAlt.total) } }] : []),
    ...(facts.pagesWithBlockingIssues && facts.pagesWithBlockingIssues > 0 ? [{ key: "a11y.issue.pages", args: { n: String(facts.pagesWithBlockingIssues) } }] : []),
    ...own.map((line) => ({ key: "a11y.issue.own", args: { text: defang(line) } })),
  ];
  const countries = [...new Set(facts.countries.map((c) => c.toUpperCase()))];
  const enforcementItems = countries.map((code): { key: string; args?: Args } => {
    const body = enforcementBodyOf(code);
    if (!body) return { key: "a11y.enforcement.other", args: { country: country(code) } };
    return { key: body.verified ? "a11y.enforcement.verified" : "a11y.enforcement.unverified", args: { country: country(code), body: body.body } };
  });
  const notes = countries.filter((code) => `a11y.note.${code}` in m);

  const shape: { topic: string; blocks: Block[] }[] = [
    { topic: "status", blocks: [{ p: `a11y.status.${status}`, args: { store: facts.storeName ? defang(facts.storeName) : placeholder("ph.add", "storeName") } }, { p: "a11y.status.note" }] },
    { topic: "standard", blocks: [{ p: "a11y.standard.1" }] },
    {
      topic: "assessment",
      blocks:
        status === "not_assessed"
          ? [{ p: "a11y.assessment.none" }]
          : [
              ...(by !== "" || on !== "" ? [{ p: "a11y.assessment.by", args: { by: by !== "" ? defang(by) : placeholder("ph.add", "assessor"), on: on !== "" ? on : placeholder("ph.add", "date") } }] : []),
              ...(settings.reportUrl?.trim() ? [{ p: "a11y.assessment.report", args: { url: defang(settings.reportUrl.trim()) } }] : []),
              ...((settings.assessmentNote ?? "").trim() ? [{ p: "a11y.assessment.note", args: { note: defang((settings.assessmentNote ?? "").trim()) } }] : []),
            ],
    },
    {
      topic: "scope",
      blocks: [
        { p: "a11y.scope.1", args: { addresses: facts.siteAddresses.length > 0 ? list(facts.siteAddresses.map(defang)) : placeholder("ph.add", "siteAddress") } },
        ...(facts.languages.length > 0 ? [{ p: "a11y.scope.2", args: { languages: list(facts.languages.map(defang)) } }] : []),
      ],
    },
    { topic: "known_issues", blocks: issues.length > 0 ? [{ ul: issues }] : [{ p: "a11y.issues.none" }] },
    { topic: "third_party", blocks: [{ p: "a11y.third.1" }] },
    ...(settings.microenterprise ? [{ topic: "microenterprise", blocks: [{ p: "a11y.micro.1", args: { check: placeholder("ph.check", "microenterprise") } }] as Block[] }] : []),
    { topic: "feedback", blocks: [{ p: "a11y.feedback.1", args: { email } }, { p: "a11y.annex", args: { check: placeholder("ph.check", "annex") } }] },
    { topic: "enforcement", blocks: [{ p: "a11y.enforcement.1" }, ...(enforcementItems.length > 0 ? [{ ul: enforcementItems }] : []), ...notes.map((code) => ({ p: `a11y.note.${code}` }))] },
    {
      topic: "prepared",
      blocks: [
        { p: "a11y.prepared.1", args: { prepared: settings.preparedOn?.trim() || placeholder("ph.add", "date") } },
        ...(settings.reviewedOn?.trim() ? [{ p: "a11y.prepared.2", args: { reviewed: settings.reviewedOn.trim() } }] : []),
      ],
    },
  ];

  const say = (key: string, args?: Args) => {
    const template = m[key];
    if (template === undefined) throw new Error(`accessibility statement text "${key}" is missing in ${language}`);
    return fill(template, args);
  };
  return shape.map((section) => ({
    topic: section.topic,
    heading: say(`h.${section.topic}`),
    blocks: section.blocks.map((block): RenderedBlock => ("p" in block ? { p: say(block.p, block.args) } : { ul: block.ul.map((i) => say(i.key, i.args)) })),
  }));
}

/** Every key a statement can use, for the test that holds the four languages to one set. */
export const A11Y_KEYS_META = /^(notice|notice\.language|ph\.|label\.|title|slug)/;

/** The notice the statement opens with. */
export const a11yNotice = (language: StarterLanguage, translated = false): string => {
  const m = A11Y_TEXTS[language].m;
  return translated ? `${m.notice} ${m["notice.language"]}` : m.notice;
};

/** A draft page of the statement: the notice first, then each section. Returns the problems instead when the settings cannot make one. */
export function accessibilityStatement(
  language: StarterLanguage,
  settings: A11ySettings,
  facts: A11yFacts,
  id: NewId,
  options: { translatedNotice?: boolean } = {},
): { ok: true; page: StarterPage } | { ok: false; problems: string[] } {
  const problems = a11yProblems(settings);
  if (problems.length > 0) return { ok: false, problems };
  const m = A11Y_TEXTS[language].m;
  const sections = statementSections(language, settings, facts);
  return { ok: true, page: { title: m.title, slug: m.slug, language, rows: draftRows(m.title, a11yNotice(language, options.translatedNotice), sections, id) } };
}

/** What needs a person to read it (`docs/wave-1-trust.md` section 8). */
export const A11Y_REVIEW_MANIFEST = {
  files: ["src/lib/a11y-statement-text.ts", "src/lib/a11y-statement.ts"],
  items: ["statement text", "enforcement-body lines (ENFORCEMENT_BODIES, all verified: false)", "microenterprise sentence"],
} as const;
