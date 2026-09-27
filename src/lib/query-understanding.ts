import { z } from "zod";

import { normalizeQuery } from "./search";

/**
 * Query understanding (Phase 2, S3, D75): the store's text model reads a
 * search such as "lampe under 500 kr" and answers with filters: the words
 * left to search for, the store's categories and tags, a price range, a
 * kind of product, in stock only, and an order. The model only chooses:
 * everything it answers is checked here against what the store has, prices
 * are turned into minor units in code, and words to search for must be
 * words the shopper typed. The filters then drive ordinary SQL, so the
 * model never names a product, a price or a stock level itself. Pure, and
 * shared with the eval.
 */

export const PRODUCT_KINDS = ["goods", "appointment", "stay", "rental"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const SEARCH_SORTS = ["relevance", "priceLow", "priceHigh", "newest"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** What a search was understood as, checked: safe to use in SQL and to show. */
export type SearchFilters = {
  /** Words to search for: the shopper's own words, less those the filters cover. */
  text: string;
  categories: string[];
  tags: string[];
  /** Price range, in the market currency's minor units, including VAT. */
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  kind: ProductKind | null;
  inStock: boolean;
  sort: SearchSort;
};

export type Term = { slug: string; name: string };

/** What the model is told about the store, and what its answer is checked against. */
export type UnderstandingContext = {
  /** The market's language, e.g. `nb-NO`. */
  locale: string;
  currency: string;
  /** Digits after the decimal point in the currency (2 for NOK and EUR). */
  currencyDigits: number;
  categories: Term[];
  tags: Term[];
};

/** Filters that change nothing: search for the words as typed. */
export function plainFilters(query: string): SearchFilters {
  return { text: normalizeQuery(query), categories: [], tags: [], minPriceMinor: null, maxPriceMinor: null, kind: null, inStock: false, sort: "relevance" };
}

/** Whether understanding changed anything: otherwise the search runs as typed. */
export function hasFilters(filters: SearchFilters): boolean {
  return (
    filters.categories.length > 0 ||
    filters.tags.length > 0 ||
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null ||
    filters.kind !== null ||
    filters.inStock ||
    filters.sort !== "relevance"
  );
}

/**
 * Words and signs that a search holds more than words to match (a price,
 * an order, stock), in the markets' languages. Only such searches, and
 * longer ones, are sent to the model: a word or two goes straight to
 * search, with no model call to wait for.
 */
const CUES = [
  // Prices and amounts
  "kr", "nok", "sek", "dkk", "eur", "€", "euro", "kroner", "kronor", "pris", "price", "priced",
  "under", "over", "mellom", "mellan", "between", "below", "above", "maks", "max", "min", "opptil", "upp", "op",
  "billig", "billige", "billigste", "billigast", "cheap", "cheapest", "rimelig", "rimlig", "dyr", "dyreste", "expensive",
  // Stock and newness
  "lager", "lagret", "stock", "tilgjengelig", "available", "ny", "nye", "nyeste", "new", "newest", "nyhet", "nyheder",
] as const;

export function worthUnderstanding(query: string): boolean {
  const text = normalizeQuery(query);
  if (!text) return false;
  const words = text.match(/[\p{L}\p{N}€]+/gu) ?? [];
  if (words.length >= 3) return true;
  if (/\d/.test(text) || text.includes("€")) return true;
  return words.some((word) => (CUES as readonly string[]).includes(word));
}

/** The model's answer as asked for; loose, as models vary, then checked by `cleanFilters`. */
const modelAnswer = z
  .object({
    text: z.string().max(200).optional(),
    categories: z.array(z.string().max(100)).max(20).optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
    minPrice: z.number().nullable().optional(),
    maxPrice: z.number().nullable().optional(),
    kind: z.string().nullable().optional(),
    inStock: z.boolean().optional(),
    sort: z.string().optional(),
  })
  .loose();

/** The first JSON object in a reply, which may come wrapped in prose or a code fence. */
export function parseModelJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}

const MAX_MAJOR = 10_000_000;

function toMinor(value: number | null | undefined, digits: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0 || value > MAX_MAJOR) return null;
  return Math.round(value * 10 ** digits);
}

/**
 * The model's answer, checked against the store and the search: unknown
 * categories, tags, kinds and orders are dropped, prices outside reason are
 * dropped and a reversed range is put right, and words to search for are
 * kept only if the shopper typed them. Null when the answer is not JSON of
 * the right shape: the search then runs as typed.
 */
export function cleanFilters(answer: unknown, query: string, context: UnderstandingContext): SearchFilters | null {
  const parsed = modelAnswer.safeParse(answer);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const typed = normalizeQuery(query);
  const typedWords = new Set(typed.match(/[\p{L}\p{N}]+/gu) ?? []);
  // The shopper's words only, in the order the model gave them.
  const text = normalizeQuery(raw.text ?? typed)
    .split(" ")
    .filter((word) => word && [...(word.match(/[\p{L}\p{N}]+/gu) ?? [])].every((part) => typedWords.has(part)))
    .join(" ");
  const pick = (wanted: string[] | undefined, terms: Term[]) => {
    const known = new Set(terms.map((term) => term.slug));
    return [...new Set((wanted ?? []).map((slug) => slug.trim().toLowerCase()))].filter((slug) => known.has(slug));
  };
  let min = toMinor(raw.minPrice, context.currencyDigits);
  let max = toMinor(raw.maxPrice, context.currencyDigits);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (min === 0) min = null;
  const kind = (PRODUCT_KINDS as readonly string[]).includes(raw.kind ?? "") ? (raw.kind as ProductKind) : null;
  const sort = (SEARCH_SORTS as readonly string[]).includes(raw.sort ?? "") ? (raw.sort as SearchSort) : "relevance";
  return {
    text,
    categories: pick(raw.categories, context.categories),
    tags: pick(raw.tags, context.tags),
    minPriceMinor: min,
    maxPriceMinor: max,
    kind,
    inStock: raw.inStock === true,
    sort,
  };
}

/** The request to the text model: the store's categories and tags to choose from, and the search. */
export function understandingMessages(query: string, context: UnderstandingContext): { role: "system" | "user"; content: string }[] {
  const list = (terms: Term[]) => (terms.length === 0 ? "(none)" : terms.map((term) => `${term.slug} (${term.name})`).join(", "));
  const system = [
    "You turn a shopper's search in an online store into filters. Answer with one JSON object and nothing else:",
    '{"text": string, "categories": string[], "tags": string[], "minPrice": number|null, "maxPrice": number|null, "kind": string|null, "inStock": boolean, "sort": string}',
    "Rules:",
    "- text: the shopper's words that describe what they want (the thing, its colour, material, size, use), as typed. Keep them even when a category or other filter also applies. Leave out only words a filter says (amounts and currency, cheapest, in stock, new). Never add, translate or correct words.",
    '- categories and tags: only slugs from the lists below, and only when the search names the category or tag itself (its name or a form of it). A thing that belongs in a category is not that category being named: for "vase" leave categories [] even if there is a home category. Otherwise [].',
    `- minPrice and maxPrice: amounts in ${context.currency} as plain numbers (\"under 500 kr\" is maxPrice 500), or null.`,
    '- kind: null, unless the search asks to book a time ("appointment": a treatment or service), stay nights ("stay"), rent something ("rental") or says it wants physical goods rather than services ("goods").',
    "- inStock: true only if the shopper asks for things in stock or available now.",
    '- sort: "priceLow" for cheapest, "priceHigh" for most expensive, "newest" for new, otherwise "relevance".',
    "- When unsure, leave the filter out and keep the words in text.",
    "Examples (another store; use this store's lists below):",
    '"blå genser under 800 kr" -> {"text": "blå genser", "categories": [], "tags": [], "minPrice": null, "maxPrice": 800, "kind": null, "inStock": false, "sort": "relevance"}',
    '"billigste sofa" -> {"text": "sofa", "categories": [], "tags": [], "minPrice": null, "maxPrice": null, "kind": null, "inStock": false, "sort": "priceLow"}',
    '"frisørtime på fredag" -> {"text": "frisørtime fredag", "categories": [], "tags": [], "minPrice": null, "maxPrice": null, "kind": "appointment", "inStock": false, "sort": "relevance"}',
    `The store's language: ${context.locale}.`,
    `Categories: ${list(context.categories)}`,
    `Tags: ${list(context.tags)}`,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: normalizeQuery(query) },
  ];
}
