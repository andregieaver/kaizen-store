/**
 * The Norwegian glossary (D312, `docs/platform-admin-i18n.md` 5): every legal, tax, accounting, payment, consumer and privacy term the site
 * and the admin use in Norwegian, taken from the source that defines it, never translated from the English word. Each entry names its
 * source, quotes it and says when it was read; `docs/i18n/glossary-nb.md` is written from this list (`glossaryMarkdown()`), and
 * `i18n-glossary.test.ts` holds every Norwegian catalogue to it (`forbiddenUses()`): a word an entry forbids may not appear there.
 *
 * Status: `researched` (read in the source), `checked` (a person who reads Norwegian has checked it), `legal_review` (waits for the lawyer
 * before it may be used in a legal page). A term may be used in the interface once researched; in a legal page only once checked.
 */

export type GlossaryArea = "tax" | "accounting" | "consumer" | "privacy" | "marketing" | "accessibility" | "payments" | "commerce";
export type GlossaryStatus = "researched" | "checked" | "legal_review";

export type GlossarySource = {
  /** Where it was read: lovdata.no, skatteetaten.no, the authority's page. */
  url: string;
  /** The source's own words, short (25 words at most). */
  quote: string;
  /** The day it was read, YYYY-MM-DD. */
  read: string;
};

export type GlossaryEntry = {
  key: string;
  area: GlossaryArea;
  en: string;
  /** The Norwegian term as the source writes it. */
  nb: string;
  /** Other forms the catalogues may use (inflections, the abbreviation). */
  forms?: string[];
  definition: string;
  sources: GlossarySource[];
  /** Words that must not be used for this (whole words, any case). */
  avoid?: string[];
  status: GlossaryStatus;
  note?: string;
};

export const GLOSSARY_NB: readonly GlossaryEntry[] = [];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every forbidden word found in a text, with the entry that forbids it. Words are matched whole, in any case. */
export function forbiddenUses(text: string, entries: readonly GlossaryEntry[] = GLOSSARY_NB): { word: string; key: string; nb: string }[] {
  const found: { word: string; key: string; nb: string }[] = [];
  for (const entry of entries) {
    for (const word of entry.avoid ?? []) {
      if (new RegExp(`(^|[^\\p{L}])${escape(word)}(?=$|[^\\p{L}])`, "iu").test(text)) found.push({ word, key: entry.key, nb: entry.nb });
    }
  }
  return found;
}

/** What is wrong with the list itself: a missing source, a long quote, a bad date, a key twice, a forbidden word that is also a form. */
export function glossaryProblems(entries: readonly GlossaryEntry[] = GLOSSARY_NB): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const e of entries) {
    if (keys.has(e.key)) problems.push(`${e.key}: twice`);
    keys.add(e.key);
    if (e.sources.length === 0) problems.push(`${e.key}: no source`);
    for (const s of e.sources) {
      if (!/^https:\/\//.test(s.url)) problems.push(`${e.key}: ${s.url} is not an https address`);
      if (s.quote.trim().split(/\s+/).length > 25) problems.push(`${e.key}: a quote longer than 25 words`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.read)) problems.push(`${e.key}: the date read is not YYYY-MM-DD`);
    }
    const forms = [e.nb, ...(e.forms ?? [])].map((f) => f.toLowerCase());
    for (const word of e.avoid ?? []) if (forms.includes(word.toLowerCase())) problems.push(`${e.key}: "${word}" is both a form and avoided`);
  }
  return problems;
}

const AREA_TITLES: Record<GlossaryArea, string> = {
  tax: "VAT and tax",
  accounting: "Accounting and invoices",
  consumer: "Consumer law",
  privacy: "Personal data",
  marketing: "Marketing",
  accessibility: "Accessibility",
  payments: "Payments",
  commerce: "Shop words",
};

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** `docs/i18n/glossary-nb.md`, written from the list: one table per area. */
export function glossaryMarkdown(entries: readonly GlossaryEntry[] = GLOSSARY_NB): string {
  const lines = [
    "# Norwegian glossary (D312)",
    "",
    "Written from `src/lib/i18n-glossary.ts` by its test (`WRITE_GLOSSARY=1 pnpm exec vitest run src/lib/i18n-glossary.test.ts`); never edit it by hand.",
    "Every term is taken from the source that defines it (`docs/platform-admin-i18n.md` 5). Status: researched, checked by a person, or",
    "waiting for the lawyer (legal review). A term is used in a legal page only once checked.",
    "",
  ];
  for (const area of Object.keys(AREA_TITLES) as GlossaryArea[]) {
    const rows = entries.filter((e) => e.area === area);
    if (rows.length === 0) continue;
    lines.push(`## ${AREA_TITLES[area]}`, "", "| English | Norwegian | Meaning | Not | Source | Status |", "|---|---|---|---|---|---|");
    for (const e of rows) {
      const nb = [e.nb, ...(e.forms ?? [])].join(", ");
      const sources = e.sources.map((s) => `[${new URL(s.url).hostname}](${s.url}) (${s.read}): «${s.quote}»`).join("<br>");
      const meaning = e.note ? `${e.definition} ${e.note}` : e.definition;
      lines.push(`| ${cell(e.en)} | ${cell(nb)} | ${cell(meaning)} | ${cell((e.avoid ?? []).join(", "))} | ${cell(sources)} | ${e.status} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
