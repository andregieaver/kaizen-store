import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  pathIndex,
  searchIndex,
  TAXONOMY_LANGS,
  taxonomyLang,
  type SearchEntry,
  type TaxonomyLang,
  type TaxonomyNames,
  type TaxonomyStructure,
  type TaxonomyWords,
} from "@/lib/product-taxonomy";

/**
 * The standard product taxonomy's data (wave 6 unit I, D327): read from `src/data/product-taxonomy/` once per server instance and kept.
 * The files are read from disk rather than imported, as the type checker would otherwise type every one of their 100,000 entries; the
 * build traces them into the server's functions (`outputFileTracingIncludes` in `next.config.ts`). The rules over them are in
 * `src/lib/product-taxonomy.ts`.
 */

const DIR = path.join(process.cwd(), "src/data/product-taxonomy");

const read = async <T,>(file: string): Promise<T> => JSON.parse(await readFile(path.join(DIR, file), "utf8")) as T;

let structure: Promise<TaxonomyStructure> | null = null;
const names = new Map<TaxonomyLang, Promise<TaxonomyNames>>();
const indexes = new Map<TaxonomyLang, Promise<SearchEntry[]>>();
let paths: Promise<Map<string, string>> | null = null;

/** Kept even when a read fails once, it would fail every time after: a failed read is forgotten so the next one tries again. */
function remember<T>(promise: Promise<T>, forget: () => void): Promise<T> {
  promise.catch(forget);
  return promise;
}

export function taxonomy(): Promise<TaxonomyStructure> {
  structure ??= remember(read<TaxonomyStructure>("structure.json"), () => (structure = null));
  return structure;
}

function namesIn(lang: TaxonomyLang): Promise<TaxonomyNames> {
  let kept = names.get(lang);
  if (!kept) {
    kept = remember(read<TaxonomyNames>(`names-${lang}.json`), () => names.delete(lang));
    names.set(lang, kept);
  }
  return kept;
}

/** The taxonomy's names for a locale (an admin's `nb-NO`, a market's `sv-SE`), English where the release has none. */
export async function taxonomyWords(locale: string): Promise<TaxonomyWords> {
  const lang = taxonomyLang(locale);
  const [own, english] = await Promise.all([namesIn(lang), namesIn("en")]);
  return { lang, own, english };
}

/** The search index for a locale's language, built once. */
export function taxonomySearch(locale: string): Promise<SearchEntry[]> {
  const lang = taxonomyLang(locale);
  let kept = indexes.get(lang);
  if (!kept) {
    kept = remember(
      Promise.all([taxonomy(), taxonomyWords(lang)]).then(([t, words]) => searchIndex(t, words)),
      () => indexes.delete(lang),
    );
    indexes.set(lang, kept);
  }
  return kept;
}

/** Every category's English path, for reading a Shopify CSV's `Product Category` cells. */
export function taxonomyPaths(): Promise<Map<string, string>> {
  paths ??= remember(
    Promise.all([taxonomy(), namesIn("en")]).then(([t, english]) => pathIndex(t, english)),
    () => (paths = null),
  );
  return paths;
}

export { TAXONOMY_LANGS };
