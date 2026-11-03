/**
 * Words before and after a product's price (D429): an owner's own short words, such as "Kun" or "From only" before the amount and "/stk",
 * ",-" or "per pakke" after it. The store has its words by language (`stores.price_words`), a language without its own taking the main
 * language's; a product may follow them, show none or have its own (`products.price_words`). They are shown around a product's price wherever
 * shoppers see it (the product page, cards and grids, search, the chat's cards), never beside a cart line, a total, an invoice or a feed, and
 * the automatic labels (VAT, "From", the 30-day reference price) stay as they are. What an owner may type is checked by
 * `priceWordProblem()` (`price-words-check.ts`).
 *
 * Pure and without zod: the visitor's browser reads it (D211).
 */

/** At most this many characters before or after a price. */
export const PRICE_WORD_MAX = 24;

/** The words around a price in one language; either may be empty. */
export type PriceWords = { prefix: string; suffix: string };

export const NO_WORDS: PriceWords = { prefix: "", suffix: "" };

/** Words by language (a locale such as `nb-NO`): a store's, or a product's own. */
export type WordsByLocale = Record<string, PriceWords>;

/** A store's words and its main language, which a language without words of its own takes (D429, D109). */
export type StoreWords = { byLocale: WordsByLocale; main: string };

/** A product's choice: the store's words, none at all, or its own by language. */
export type ProductPriceWords = { mode: "inherit" } | { mode: "none" } | { mode: "own"; words: WordsByLocale };

export const INHERIT_WORDS: ProductPriceWords = { mode: "inherit" };

const word = (value: unknown): string => (typeof value === "string" ? value : "");

/** Words by language as a row keeps them; anything not an object of words is left out (the database refuses it anyway). */
export function parseWordsByLocale(value: unknown): WordsByLocale {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: WordsByLocale = {};
  for (const [locale, words] of Object.entries(value as Record<string, unknown>)) {
    if (!words || typeof words !== "object" || Array.isArray(words)) continue;
    const pair = words as Record<string, unknown>;
    out[locale] = { prefix: word(pair.prefix), suffix: word(pair.suffix) };
  }
  return out;
}

/** A product's choice as `products.price_words` keeps it: null follows the store. */
export function parseProductPriceWords(value: unknown): ProductPriceWords {
  if (!value || typeof value !== "object" || Array.isArray(value)) return INHERIT_WORDS;
  const row = value as Record<string, unknown>;
  if (row.mode === "none") return { mode: "none" };
  if (row.mode === "own") return { mode: "own", words: parseWordsByLocale(row.words) };
  return INHERIT_WORDS;
}

/** What `products.price_words` keeps for a choice: null to follow the store. */
export function productWordsColumn(choice: ProductPriceWords): null | { mode: "none" } | { mode: "own"; words: WordsByLocale } {
  if (choice.mode === "none") return { mode: "none" };
  if (choice.mode === "own") return { mode: "own", words: choice.words };
  return null;
}

/** The words of a language: its own (even empty, which says none), else the main language's, else none. */
export function wordsIn(byLocale: WordsByLocale, locale: string, main: string): PriceWords {
  return byLocale[locale] ?? byLocale[main] ?? NO_WORDS;
}

/**
 * The words around a product's price for a shopper reading `locale`: the product's own (by the same fallback to the main language), none, or
 * the store's. Null when there are none to show.
 */
export function shownPriceWords(store: StoreWords | undefined, product: ProductPriceWords, locale: string): PriceWords | null {
  if (product.mode === "none") return null;
  const words =
    product.mode === "own" ? wordsIn(product.words, locale, store?.main ?? locale) : store ? wordsIn(store.byLocale, locale, store.main) : NO_WORDS;
  const prefix = words.prefix.trim();
  const suffix = words.suffix.trim();
  return prefix || suffix ? { prefix, suffix } : null;
}

/** Whether the words differ from none. */
export const hasWords = (words: PriceWords | null | undefined): words is PriceWords => Boolean(words && (words.prefix || words.suffix));

/**
 * A prefix as it sits before the amount: a space after a word that ends in a letter, a digit or a full stop or colon ("Kun 499 kr",
 * "ca. 499 kr"), none after a sign ("~499 kr"). Empty for none.
 */
export function beforeAmount(prefix: string): string {
  const text = prefix.trim();
  if (!text) return "";
  return /[\p{L}\p{N}.:!?)]$/u.test(text) ? `${text} ` : text;
}

/**
 * A suffix as it sits after the amount: a space before a word that starts with a letter, a digit or a bracket ("499 kr per pakke"), none
 * before a sign ("499,-", "499 kr/stk"). Empty for none.
 */
export function afterAmount(suffix: string): string {
  const text = suffix.trim();
  if (!text) return "";
  return /^[\p{L}\p{N}(]/u.test(text) ? ` ${text}` : text;
}

/** A written amount with the words around it, as plain text ("Kun 499 kr/stk"); the amount alone for none. */
export function withWords(amount: string, words: PriceWords | null | undefined): string {
  return words ? `${beforeAmount(words.prefix)}${amount}${afterAmount(words.suffix)}` : amount;
}
