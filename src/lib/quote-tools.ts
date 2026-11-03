import { z } from "zod";

import { PRICE_DECIMALS } from "./money";
import { QUANTITY_PICKERS } from "./quantity-stepper";
import { QUOTE_MODES, QUOTE_REPLY_MAX } from "./quotes";
import { cleanPriceWord, priceWordProblem, type PriceWordProblem } from "./price-words-check";
import { PRICE_WORD_MAX, parseProductPriceWords, type ProductPriceWords, type WordsByLocale } from "./price-words";

/**
 * The AI manager's quote and price display tools (D437): what they take, the store's languages matched to what the model names, the words of a
 * price word's problem, and what the owner is asked to approve. Pure; the runners are `src/server/quote-tools.ts`.
 */

const draftRef = z.string().trim().min(1).max(64).describe("The draft order's number, such as D-12, or its id.");
const language = z.string().trim().min(2).max(10).describe("One of the store's languages, by code (nb, sv, en) or locale (nb-NO).");
const word = z.string().max(PRICE_WORD_MAX * 4);

/** Words before and after a product's price in one language; "" for none on that side. */
export const priceWordsLine = z.object({
  language,
  before: word.default("").describe(`Shown before the price, such as From or Only (at most ${PRICE_WORD_MAX} characters); "" for none.`),
  after: word.default("").describe(`Shown after the price, such as /pc, per person or ,- (at most ${PRICE_WORD_MAX} characters); "" for none.`),
});
export type PriceWordsLine = z.output<typeof priceWordsLine>;

/** A product's own words around its price (D429), for `update_product`. */
export const productPriceWordsArgs = z.object({
  follow: z
    .enum(["store", "none", "own"])
    .describe("store: the store's words (Settings, Prices and quantity); none: no words around this product's price; own: the words given here."),
  words: z.array(priceWordsLine).max(20).optional().describe("With own: the product's words by language; a language left out shows none."),
});
export type ProductPriceWordsArgs = z.output<typeof productPriceWordsArgs>;

export const priceDisplayInput = z.object({});

export const setPriceDisplayInput = z.object({
  decimals: z
    .enum(PRICE_DECIMALS as [string, ...string[]])
    .optional()
    .describe("always: every price with its decimals (499,00 kr); hide_whole: whole amounts without them (499 kr), others keep them (499,50 kr). Never a rounding."),
  countries: z
    .array(
      z.object({
        country: z.string().trim().length(2).describe("One of the store's countries, by code (SE)."),
        decimals: z.enum(["store", ...PRICE_DECIMALS] as [string, ...string[]]).describe("store: as the store; always or hide_whole: this country's own."),
      }),
    )
    .max(40)
    .optional()
    .describe("Countries that show decimals differently from the store; only the countries given change."),
  words: z.array(priceWordsLine).max(20).optional().describe("The store's words before and after a product's price, by language; only the languages given change."),
  quantity_chooser: z
    .enum(QUANTITY_PICKERS as [string, ...string[]])
    .optional()
    .describe("How product pages offer a quantity: buttons (− and + around a number), box (the number alone) or hidden (no chooser; Add to cart adds the least allowed)."),
});
export type SetPriceDisplayInput = z.output<typeof setPriceDisplayInput>;

export const setQuoteRequestsInput = z.object({
  who: z
    .enum(QUOTE_MODES)
    .describe("off: no Request a quote on products that show their price; everyone: beside Add to cart and in the cart for every shopper; business: only for business buyers. A product priced on request offers it whatever this says."),
});
export type SetQuoteRequestsInput = z.output<typeof setQuoteRequestsInput>;

export const setDraftPricesInput = z.object({
  draft: draftRef,
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(100).describe("The line's SKU, as list_draft_orders' draft shows it (every line with it is priced)."),
        price: z
          .string()
          .trim()
          .max(30)
          .describe("The price for one, VAT included, in the draft's currency, as the owner gave it (450 or 449,50); \"\" takes the typed price away (the list price again, or waiting for a price if the product is priced on request)."),
      }),
    )
    .min(1)
    .max(50),
});
export type SetDraftPricesInput = z.output<typeof setDraftPricesInput>;

export const declineQuoteInput = z.object({
  draft: draftRef,
  reply: z
    .string()
    .trim()
    .min(1)
    .max(QUOTE_REPLY_MAX)
    .describe("The short reply the customer is emailed, in the owner's words and the customer's language (why no quote, what they could do instead)."),
});
export type DeclineQuoteInput = z.output<typeof declineQuoteInput>;

/** The store's locale a model's language means: the locale itself, else the first of the store's with that language. */
export function localeFor(given: string, locales: readonly string[]): string | null {
  const wanted = given.trim().toLowerCase();
  const exact = locales.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const lang = wanted.split("-")[0];
  return locales.find((l) => l.toLowerCase().split("-")[0] === lang) ?? null;
}

/** A price word's problem for the model to repeat to the owner. */
export function priceWordProblemText(problem: PriceWordProblem): string {
  switch (problem.kind) {
    case "long":
      return `at most ${problem.max} characters`;
    case "plain":
      return "plain words only, without tags or line breaks";
    case "percent":
      return "no percentage (a reduction is shown with its 30-day price, which the store adds itself)";
    case "claim":
      return `it cannot say "${problem.phrase}"`;
  }
}

/**
 * Words by language laid over `had`, matched to the store's locales and checked as the editor checks them; tidied as they are kept. A
 * language the store does not have, or a word with a problem, is a problem in words.
 */
export function wordsOverlay(lines: readonly PriceWordsLine[], had: WordsByLocale, locales: readonly string[]): { ok: true; words: WordsByLocale } | { ok: false; problems: string[] } {
  const words: WordsByLocale = { ...had };
  const problems: string[] = [];
  for (const line of lines) {
    const locale = localeFor(line.language, locales);
    if (!locale) {
      problems.push(`The store has no language ${line.language}. Its languages: ${locales.join(", ")}.`);
      continue;
    }
    for (const [place, typed] of [["before", line.before], ["after", line.after]] as const) {
      const problem = priceWordProblem(typed);
      if (problem) problems.push(`The words ${place} the price in ${locale}: ${priceWordProblemText(problem)}.`);
    }
    words[locale] = { prefix: cleanPriceWord(line.before), suffix: cleanPriceWord(line.after) };
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, words };
}

/** A product's stored words (`products.price_words`) as `update_product` takes them back. */
export function productWordsForTool(stored: unknown): ProductPriceWordsArgs {
  const choice = parseProductPriceWords(stored);
  if (choice.mode === "inherit") return { follow: "store" };
  if (choice.mode === "none") return { follow: "none" };
  return { follow: "own", words: Object.entries(choice.words).map(([language, w]) => ({ language, before: w.prefix, after: w.suffix })) };
}

/** `update_product`'s `price_words` as the editor keeps a product's choice, checked; a problem in words otherwise. */
export function productWordsFromArgs(args: ProductPriceWordsArgs, locales: readonly string[]): { ok: true; words: ProductPriceWords } | { ok: false; problems: string[] } {
  if (args.follow === "store") return { ok: true, words: { mode: "inherit" } };
  if (args.follow === "none") return { ok: true, words: { mode: "none" } };
  if (!args.words || args.words.length === 0) return { ok: false, problems: ["With follow own, give the words for at least one language."] };
  const laid = wordsOverlay(args.words, {}, locales);
  return laid.ok ? { ok: true, words: { mode: "own", words: laid.words } } : laid;
}

const DECIMAL_WORDS: Record<string, string> = {
  always: "every price with its decimals",
  hide_whole: "whole amounts without decimals",
  store: "as the store",
};

const QUANTITY_WORDS: Record<string, string> = {
  buttons: "− and + around a number",
  box: "the number alone",
  hidden: "no quantity chooser",
};

const QUOTE_WORDS: Record<string, string> = {
  off: "no one (only products priced on request offer it)",
  everyone: "every shopper, beside Add to cart and in the cart",
  business: "business buyers only",
};

/** What the owner is asked to approve, from the call's own arguments. */
export function quoteToolSummary(name: string, input: Record<string, unknown>): string | null {
  switch (name) {
    case "set_price_display": {
      const parts: string[] = [];
      if (typeof input.decimals === "string") parts.push(`show ${DECIMAL_WORDS[input.decimals] ?? input.decimals}`);
      for (const c of (input.countries as { country: string; decimals: string }[] | undefined) ?? []) {
        parts.push(`${String(c.country).toUpperCase()}: ${DECIMAL_WORDS[c.decimals] ?? c.decimals}`);
      }
      for (const w of (input.words as { language: string; before?: string; after?: string }[] | undefined) ?? []) {
        const before = cleanPriceWord(String(w.before ?? ""));
        const after = cleanPriceWord(String(w.after ?? ""));
        parts.push(before || after ? `in ${w.language}, "${before}" before and "${after}" after a product's price` : `no words around prices in ${w.language}`);
      }
      if (typeof input.quantity_chooser === "string") parts.push(`product pages offer ${QUANTITY_WORDS[input.quantity_chooser] ?? input.quantity_chooser}`);
      return `Change how the shop shows prices: ${parts.join("; ") || "nothing"}.`;
    }
    case "set_quote_requests":
      return `Offer Request a quote to ${QUOTE_WORDS[String(input.who)] ?? String(input.who)}.`;
    case "decline_quote":
      return `Decline the request for a quote ${String(input.draft ?? "")} and email the customer this reply: "${String(input.reply ?? "").slice(0, 300)}". It is then never sent as a quote.`;
    default:
      return null;
  }
}
