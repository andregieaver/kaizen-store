/**
 * Words an owner writes once with their translations (D357, D705): the main text, and the same words per language (`byLocale`, by a locale
 * such as `nb-NO` or a language such as `nb`). Shared by the checkout's rules and questions and by forms; free of zod, so a pay route and the
 * storefront can import it.
 */
export type Words = { text: string; byLocale: Record<string, string> };

/** The words in a language: its own, else its language's first match (`nb` for `nb-NO`), else the main ones. */
export function wordsIn(words: Words, locale: string): string {
  const own = words.byLocale[locale];
  if (own) return own;
  const lang = locale.split("-")[0];
  const near = Object.entries(words.byLocale).find(([l]) => l.split("-")[0] === lang)?.[1];
  return near || words.text;
}

/** Words with only a main text. */
export const plainWords = (text: string): Words => ({ text, byLocale: {} });
