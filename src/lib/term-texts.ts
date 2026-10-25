/**
 * A store's product category's or tag's own page (wave 6 unit A, D319, `docs/wave-6-catalogue.md` 3.1), pure and shared with the browser: its
 * description and its name and description in the store's other languages. Stored in `terms.description` (the main language, Tiptap JSON) and
 * `terms.texts` (`{ "sv-SE": { "name": "…", "description": {…} } }`, keyed by the store's locale strings as `terms.seo` is).
 *
 * The one rule that matters to a shopper: a page in a language gets that language's own name and description, else the main language's
 * (`termTextFor()`), and never a third language's.
 */
import { z } from "zod";

import { cleanRichText, richTextPlain, type RichTextDoc } from "./page-content";
import { TERM_NAME_MAX } from "./taxonomy";

/** The longest description, in characters of its words. */
export const TERM_DESCRIPTION_MAX = 5000;
/** The longest locale string (`zh-Hant-TW` and the like). */
const LOCALE_MAX = 35;

export type TermText = { name?: string; description?: RichTextDoc };
/** The texts by locale. A locale with no name and no description is not kept. */
export type TermTexts = Record<string, TermText>;

/** A description as the form sends it: a document Kaizena Flow can draw, at most `TERM_DESCRIPTION_MAX` characters of words; empty is none. */
export function cleanTermDescription(value: unknown): { ok: true; doc: RichTextDoc | null } | { ok: false; problem: string } {
  if (value === null || value === undefined) return { ok: true, doc: null };
  const cleaned = cleanRichText(value);
  if (!cleaned.ok) return cleaned;
  const words = richTextPlain(cleaned.doc).trim();
  if (words.length === 0) return { ok: true, doc: null };
  if (words.length > TERM_DESCRIPTION_MAX) return { ok: false, problem: `Keep the description under ${TERM_DESCRIPTION_MAX} characters.` };
  return { ok: true, doc: cleaned.doc };
}

/** The shape only: locale keys, a name and a description (unknown). `termTextsInput()` adds the store's languages and cleans the descriptions. */
export const termTextsShape = z.record(
  z.string().min(1).max(LOCALE_MAX),
  z.object({
    name: z.string().trim().max(TERM_NAME_MAX, `Keep the name under ${TERM_NAME_MAX} characters.`).optional(),
    description: z.unknown().optional(),
  }),
);

/**
 * The texts an editor sends, for a store that keeps `locales` besides its main language `main`: a language the store does not keep is refused,
 * the main language is refused (its name and description are the term's own columns), descriptions are cleaned, and a language with nothing
 * written is removed. Use it on the server with the store's own list, never the browser's say-so.
 */
export function termTextsInput(locales: readonly string[], main: string) {
  const kept = new Set(locales);
  return termTextsShape.transform((texts, ctx) => {
    const out: TermTexts = {};
    for (const [locale, raw] of Object.entries(texts)) {
      if (locale === main) {
        ctx.addIssue({ code: "custom", path: [locale], message: "The main language's name and description are the category's own." });
        continue;
      }
      if (!kept.has(locale)) {
        ctx.addIssue({ code: "custom", path: [locale], message: `The store does not offer the language ${locale}.` });
        continue;
      }
      const description = cleanTermDescription(raw.description);
      if (!description.ok) {
        ctx.addIssue({ code: "custom", path: [locale, "description"], message: description.problem });
        continue;
      }
      const text: TermText = {};
      if (raw.name) text.name = raw.name;
      if (description.doc) text.description = description.doc;
      if (text.name || text.description) out[locale] = text;
    }
    return out;
  });
}

/** What is stored, read leniently: anything that is not a locale with a name or a description is dropped, never thrown. */
export function parseTermTexts(value: unknown): TermTexts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: TermTexts = {};
  for (const [locale, raw] of Object.entries(value as Record<string, unknown>)) {
    if (locale.length > LOCALE_MAX || raw === null || typeof raw !== "object") continue;
    const { name, description } = raw as { name?: unknown; description?: unknown };
    const text: TermText = {};
    if (typeof name === "string" && name.trim()) text.name = name.trim().slice(0, TERM_NAME_MAX);
    const doc = cleanTermDescription(description);
    if (doc.ok && doc.doc) text.description = doc.doc;
    if (text.name || text.description) out[locale] = text;
  }
  return out;
}

/** A stored description, read leniently: null when there is none or it cannot be drawn. */
export function parseTermDescription(value: unknown): RichTextDoc | null {
  const doc = cleanTermDescription(value);
  return doc.ok ? doc.doc : null;
}

/** What a term reads as in `locale`: the language's own name and description, else the main language's (the term's own). */
export function termTextFor(
  term: { name: string; description?: RichTextDoc | null; texts?: TermTexts },
  locale: string,
): { name: string; description: RichTextDoc | null } {
  const own = term.texts && Object.hasOwn(term.texts, locale) ? term.texts[locale] : undefined;
  return { name: own?.name || term.name, description: own?.description ?? term.description ?? null };
}

/** The terms as a page in `locale` names them: each name in that language where it has one (menus, chips, filters, the chat). */
export function termsIn<T extends { name: string; texts?: TermTexts }>(terms: readonly T[], locale: string): T[] {
  return terms.map((term) => {
    const own = term.texts && Object.hasOwn(term.texts, locale) ? term.texts[locale]?.name : undefined;
    return own ? { ...term, name: own } : term;
  });
}

/** The first sentences of a description, for a page's meta description where it has none of its own: at most `max` characters, cut at a word. */
export function descriptionSummary(doc: RichTextDoc | null, max = 160): string {
  if (!doc) return "";
  const words = richTextPlain(doc).replace(/\s+/g, " ").trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}
