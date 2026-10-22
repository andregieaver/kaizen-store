/**
 * Kaizena Flow's own legal pages (D312 P5): its terms of service, its privacy notice and its data processing agreement, written by
 * hand in English (`platform-legal/en.ts`) and Norwegian (`platform-legal/nb.ts`) and made into Kaizena Flow's pages by
 * `writePlatformLegalPages()` (`src/server/platform-legal.ts`): English as the page, Norwegian as its `nb-NO` texts (D55), so
 * `/terms` and `/no/terms` read in each. The company's facts come from Kaizena Flow's business details (Header and footer); one
 * not filled in is a visible bracketed placeholder, never an invented fact. Published as written, without a lawyer's review (the
 * owner's decision); both languages have the same sections in the same order, which `platform-legal.test.ts` holds.
 */
import type { BusinessDetails } from "./navigation";
import { isLinkAddress, newPageContent, type BlockNode, type PageBlock, type PageContent, type PageRow, type RichTextDoc } from "./page-content";
import type { NewId } from "./page-rows";
import { translationOf, withTranslation } from "./page-translation";
import { textToRichText } from "./simple-rich-text";
import { EN } from "./platform-legal/en";
import { NB } from "./platform-legal/nb";
import { PLATFORM_LEGAL_KINDS, PLATFORM_LEGAL_SLUGS, type PlatformLegalKind } from "./platform-legal-slugs";

export { PLATFORM_LEGAL_KINDS, PLATFORM_LEGAL_SLUGS, type PlatformLegalKind };

/** The locale Norwegian texts are kept under in a page's translations. */
export const PLATFORM_LEGAL_NB_LOCALE = "nb-NO";

export type LegalSection = { topic: string; heading: string; body: string };
export type LegalDoc = { title: string; description: string; sections: LegalSection[] };

/** The facts the texts are filled from, each already a string to print (a placeholder where the fact is missing). */
export type FilledFacts = BusinessDetails & {
  saleFee: string;
  links: Record<"terms" | "privacy" | "dpa" | "cookies", string>;
};

export type PlatformLegalWords = {
  lang: "en" | "nb";
  updated: (date: string) => string;
  missing: BusinessDetails;
  links: FilledFacts["links"];
  docs: (f: FilledFacts) => Record<PlatformLegalKind, LegalDoc>;
};

export const PLATFORM_LEGAL_WORDS = { en: EN, nb: NB } as const;

export type PlatformLegalFacts = { business: BusinessDetails; saleFeeBps: number; today: Date };

/** A sale fee in basis points as each language writes a percentage: 1.99 % / 1,99 %. */
export function feeWords(bps: number, lang: "en" | "nb"): string {
  const number = (bps / 100).toLocaleString(lang === "nb" ? "nb-NO" : "en-GB", { maximumFractionDigits: 2 });
  return `${number} %`;
}

function dateWords(date: Date, lang: "en" | "nb"): string {
  return date.toLocaleDateString(lang === "nb" ? "nb-NO" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Oslo" });
}

/** The business details with a placeholder in each that is not filled in. */
export function filledFacts(words: PlatformLegalWords, facts: PlatformLegalFacts): FilledFacts {
  const pick = (key: keyof BusinessDetails) => facts.business[key].trim() || words.missing[key];
  return {
    legalName: pick("legalName"),
    organisationNumber: pick("organisationNumber"),
    postalAddress: pick("postalAddress").replace(/\s*\n\s*/g, ", "),
    contactEmail: pick("contactEmail"),
    saleFee: feeWords(facts.saleFeeBps, words.lang),
    links: words.links,
  };
}

/** Which of the business details the pages need and are missing, for the admin to say before writing. */
export function missingFacts(business: BusinessDetails): (keyof BusinessDetails)[] {
  return (Object.keys(business) as (keyof BusinessDetails)[]).filter((key) => !business[key].trim());
}

export function legalDoc(kind: PlatformLegalKind, lang: "en" | "nb", facts: PlatformLegalFacts): LegalDoc {
  const words = PLATFORM_LEGAL_WORDS[lang];
  return words.docs(filledFacts(words, facts))[kind];
}

const internal = (href: string) => href.startsWith("/") && isLinkAddress(href);

/** A section's body as rich text: its own line breaks kept within a paragraph where it has no blank line (the contact block). */
function bodyDoc(body: string): RichTextDoc {
  const doc = textToRichText(body, internal);
  // `textToRichText()` joins a paragraph's lines with spaces; an address block is lines of their own.
  if (!body.includes("\n\n") && !/^[-*•]\s/m.test(body) && body.includes("\n")) {
    const content: BlockNode[] = body.split("\n").map((line) => ({ type: "paragraph", content: [{ type: "text", text: line.trim() }] }));
    return { type: "doc", content };
  }
  return doc;
}

/** One language of a page as its rows: the title, the date it was written, and each section as a heading with an address of its own and its text. */
export function legalRows(doc: LegalDoc, updated: string, id: NewId): PageRow[] {
  const blocks: PageBlock[] = [
    { id: id(), type: "heading", level: 1, text: doc.title },
    { id: id(), type: "richText", doc: textToRichText(updated) },
  ];
  for (const section of doc.sections) {
    blocks.push({ id: id(), type: "heading", level: 2, text: section.heading, htmlId: `t-${section.topic}` });
    blocks.push({ id: id(), type: "richText", doc: bodyDoc(section.body) });
  }
  return [{ id: id(), type: "row", layout: "1", columns: [{ id: id(), blocks }] }];
}

/** One language of a page as page content (the slug the same in every language). */
export function legalContent(kind: PlatformLegalKind, lang: "en" | "nb", facts: PlatformLegalFacts, id: NewId): PageContent {
  const doc = legalDoc(kind, lang, facts);
  const words = PLATFORM_LEGAL_WORDS[lang];
  return {
    ...newPageContent(),
    title: doc.title,
    slug: PLATFORM_LEGAL_SLUGS[kind],
    seo: { title: "", description: doc.description },
    rows: legalRows(doc, words.updated(dateWords(facts.today, lang)), id),
  };
}

/** The topics of a page in a language, for the test that holds the languages to the same shape. */
export const legalTopics = (kind: PlatformLegalKind, lang: "en" | "nb", facts: PlatformLegalFacts): string[] =>
  legalDoc(kind, lang, facts).sections.map((s) => s.topic);

/** A page's content in English with its Norwegian texts over it (`nb-NO`), both written against the same blocks. */
export function legalPageContent(kind: PlatformLegalKind, facts: PlatformLegalFacts, newId: NewId = () => crypto.randomUUID()): PageContent {
  const ids: string[] = [];
  const first = () => {
    const id = newId();
    ids.push(id);
    return id;
  };
  let i = 0;
  const replay = () => ids[i++];
  const english = legalContent(kind, "en", facts, first);
  const norwegian = legalContent(kind, "nb", facts, replay);
  return withTranslation(english, PLATFORM_LEGAL_NB_LOCALE, translationOf(english, norwegian));
}
