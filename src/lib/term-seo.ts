/**
 * A category's or tag's own title and description for search results and shares, per language (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.4, 3.3),
 * pure and shared with the browser. Stored in `terms.seo` as `{ "nb-NO": { "title": "…", "description": "…" } }`, keyed by the store's locale strings as
 * `product_translations.locale` is. Empty means the page uses the term's name, as it did before. The words are the owner's own: a model suggests none here (the
 * store's translation run can suggest OTHER languages from the main one, and staff read each before it is saved).
 *
 * The one rule that matters to a shopper: a page in a language gets that language's text and NEVER another's (`termSeoFor()`): a Swedish page does not get a
 * Norwegian title.
 */
import { z } from "zod";

import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";

export type TermSeoText = { title: string; description: string };
/** The texts by locale. A locale with no title and no description is not kept. */
export type TermSeo = Record<string, TermSeoText>;

/** The longest locale string (`zh-Hant-TW` and the like). */
const LOCALE_MAX = 35;

const text = (max: number, label: string) => z.string().trim().max(max, `Keep the ${label} under ${max} characters.`).default("");

/** One language's texts as the form sends them. */
export const termSeoText = z.object({ title: text(TITLE_MAX, "title"), description: text(DESCRIPTION_MAX, "description") });

/** The shape only: locale keys and the texts. `termSeoInput()` adds the store's languages. */
export const termSeoShape = z.record(z.string().min(1).max(LOCALE_MAX), termSeoText);

const isEmpty = (t: TermSeoText) => t.title === "" && t.description === "";

/** Drops the languages with nothing written: empty removes a language. */
export function compactSeo(seo: TermSeo): TermSeo {
  return Object.fromEntries(Object.entries(seo).filter(([, t]) => !isEmpty(t)));
}

/**
 * The schema for what an editor sends, for a store that offers `locales`: a language the store does not offer is refused, the lengths are held, and a
 * language with both texts empty is removed. Use it on the server with the store's own list (`store.localization.locales`), never the browser's say-so.
 */
export function termSeoInput(locales: readonly string[]) {
  const offered = new Set(locales);
  return termSeoShape.superRefine((seo, ctx) => {
    for (const locale of Object.keys(seo)) {
      if (!offered.has(locale)) ctx.addIssue({ code: "custom", path: [locale], message: `The store does not offer the language ${locale}.` });
    }
  }).transform((seo) => compactSeo(seo));
}

/** What is stored, read leniently: anything that is not a locale with a text is dropped, never thrown. */
export function parseTermSeo(value: unknown): TermSeo {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: TermSeo = {};
  for (const [locale, raw] of Object.entries(value as Record<string, unknown>)) {
    const parsed = termSeoText.safeParse(raw);
    if (parsed.success && !isEmpty(parsed.data) && locale.length <= LOCALE_MAX) out[locale] = parsed.data;
  }
  return out;
}

/** What a page in a language is given, or null when that language has nothing: never another language's text. */
export function termSeoFor(seo: TermSeo | undefined, locale: string): TermSeoText | null {
  const own = seo && Object.hasOwn(seo, locale) ? seo[locale] : undefined;
  return own && !isEmpty(own) ? own : null;
}

/**
 * The page's title: the SEO title as written (absolute: no store name added, as a product's is) when the language has one, else `Name · Store` as the page
 * had before. Next's `title` takes either.
 */
export function termMetaTitle(term: { name: string; seo?: TermSeo }, locale: string, storeName: string): string | { absolute: string } {
  const own = termSeoFor(term.seo, locale)?.title;
  return own ? { absolute: own } : `${term.name} · ${storeName}`;
}

/** The page's description in a language, or `fallback` (the store's own) when the language has none. */
export function termMetaDescription(term: { seo?: TermSeo }, locale: string, fallback: string): string {
  return termSeoFor(term.seo, locale)?.description || fallback;
}

/** Whether a term has a search text in any language (the editor's mark). */
export const hasTermSeo = (seo: TermSeo | undefined): boolean => seo !== undefined && Object.values(seo).some((t) => !isEmpty(t));

/** The texts for the title and description of Open Graph and X tags: the same as the page's, both only when the language has them. */
export function termShare(term: { name: string; seo?: TermSeo }, locale: string, fallbackDescription: string): { title: string; description: string } {
  const own = termSeoFor(term.seo, locale);
  return { title: own?.title || term.name, description: own?.description || fallbackDescription };
}
