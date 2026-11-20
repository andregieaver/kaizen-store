import { z } from "zod";

import { DESCRIPTION_MAX, TITLE_MAX } from "./seo";
import { LOCALE_MAX, type TermSeo, compactSeo, isEmpty } from "./term-seo";

/**
 * A category's or tag's search texts as they are checked and read (bloat review step 2.46): the schemas and parseTermSeo(), apart
 * from the helpers in term-seo.ts that pick and word a language's texts, so a screen that only shows them loads no zod. Import this
 * file only where a schema runs.
 */

const text = (max: number, label: string) => z.string().trim().max(max, `Keep the ${label} under ${max} characters.`).default("");

/** One language's texts as the form sends them. */
export const termSeoText = z.object({ title: text(TITLE_MAX, "title"), description: text(DESCRIPTION_MAX, "description") });

/** The shape only: locale keys and the texts. `termSeoInput()` adds the store's languages. */
export const termSeoShape = z.record(z.string().min(1).max(LOCALE_MAX), termSeoText);

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
