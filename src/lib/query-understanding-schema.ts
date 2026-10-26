import { z } from "zod";

import { normalizeQuery } from "./search";
import { CURRENCY_WORDS, MAX_MAJOR, PRODUCT_KINDS, type ProductKind, SEARCH_SORTS, type SearchFilters, type SearchSort, type Term, type UnderstandingContext, namesTerm } from "./query-understanding";

/**
 * The schemas of `query-understanding.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

/** The model's answer as asked for; loose, as models vary, then checked by `cleanFilters`. */
const modelAnswer = z
  .object({
    text: z.string().max(200).optional(),
    thing: z.string().max(200).optional(),
    categories: z.array(z.string().max(100)).max(20).optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
    minPrice: z.number().nullable().optional(),
    maxPrice: z.number().nullable().optional(),
    kind: z.string().nullable().optional(),
    inStock: z.boolean().optional(),
    sort: z.string().optional(),
  })
  .loose();

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
  const typedList = typed.split(" ").filter(Boolean);
  const typedWords = new Set(typed.match(/[\p{L}\p{N}]+/gu) ?? []);
  // The store's synonyms (D324): an alternative's words name a category or tag as well as the typed words do.
  const aliasLists = (context.aliases ?? []).map((alias) => normalizeQuery(alias).split(" ").filter(Boolean));
  const typedOnly = (words: string | undefined) =>
    normalizeQuery(words ?? "")
      .split(" ")
      .filter((word) => word && [...(word.match(/[\p{L}\p{N}]+/gu) ?? [])].every((part) => typedWords.has(part)));
  // A category or tag only when the shopper named it: never one guessed from a thing that belongs in it.
  const pick = (wanted: string[] | undefined, terms: Term[]) => {
    const named = new Map(terms.filter((term) => namesTerm(typedList, term) || aliasLists.some((words) => namesTerm(words, term))).map((term) => [term.slug, term]));
    return [...new Set((wanted ?? []).map((slug) => slug.trim().toLowerCase()))].filter((slug) => named.has(slug));
  };
  const categories = pick(raw.categories, context.categories);
  const tags = pick(raw.tags, context.tags);
  let min = toMinor(raw.minPrice, context.currencyDigits);
  let max = toMinor(raw.maxPrice, context.currencyDigits);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (min === 0) min = null;
  // Words a kept filter says: amounts and currencies with a price, the names of categories and tags.
  const namedTerms = [...context.categories.filter((t) => categories.includes(t.slug)), ...context.tags.filter((t) => tags.includes(t.slug))];
  const saidByFilter = (word: string) =>
    ((min !== null || max !== null) && (/\d/.test(word) || CURRENCY_WORDS.has(word))) ||
    namedTerms.some((term) => namesTerm([word], term));
  // Goods only would just hide bookings, and models set it unasked: only the booked kinds filter.
  const kind = (PRODUCT_KINDS as readonly string[]).includes(raw.kind ?? "") && raw.kind !== "goods" ? (raw.kind as ProductKind) : null;
  const sort = (SEARCH_SORTS as readonly string[]).includes(raw.sort ?? "") ? (raw.sort as SearchSort) : "relevance";
  const inStock = raw.inStock === true;
  const filtered = categories.length > 0 || tags.length > 0 || min !== null || max !== null || kind !== null || inStock || sort !== "relevance";
  // The shopper's words only, with the thing they want always among them, in the order typed, less
  // what a filter says. With a filter, only the thing is searched for, as every word must match:
  // "mellom" or "og" would find nothing.
  const thing = typedOnly(raw.thing);
  const kept = new Set(filtered && thing.length > 0 ? thing : [...typedOnly(raw.text ?? typed), ...thing]);
  const text = [...kept]
    .filter((word) => !saidByFilter(word))
    .sort((a, b) => typedList.indexOf(a) - typedList.indexOf(b))
    .join(" ");
  return {
    text,
    categories,
    tags,
    minPriceMinor: min,
    maxPriceMinor: max,
    kind,
    inStock,
    sort,
  };
}
