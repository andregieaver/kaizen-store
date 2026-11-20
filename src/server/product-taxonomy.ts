import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  categoryPath,
  englishAttributes,
  googleCategory,
  isCategory,
  pathIndex,
  searchIndex,
  shownKey,
  TAXONOMY_LANGS,
  TAXONOMY_RELEASE,
  taxonomyLang,
  type SearchEntry,
  type StandardShown,
  type TaxonomyLang,
  type TaxonomyNames,
  type TaxonomyStructure,
  type TaxonomyWords,
} from "@/lib/product-taxonomy";

import { jobReport } from "./cache-events";
import { col, typedRows } from "./typed-rows";

/**
 * The standard product taxonomy's data (wave 6 unit I, D327): read from `src/data/product-taxonomy/` once per server instance and kept.
 * The files are read from disk rather than imported, as the type checker would otherwise type every one of their 100,000 entries. The
 * rules over them are in `src/lib/product-taxonomy.ts`.
 *
 * Each file is read by a literal path, `readFile(path.join(process.cwd(), "src/data/product-taxonomy", "<file>"))`: Turbopack's trace
 * follows that form and puts exactly these files beside every function that reaches this module, and no other (bloat review step 2.23),
 * so `next.config.ts` carries no include for them. `product-taxonomy.scan.test.ts` holds the form, and `scripts/trace-sizes.mjs`
 * checks after a build that the routes which read the taxonomy carry every file.
 */

const parse = async <T,>(text: Promise<string>): Promise<T> => JSON.parse(await text) as T;

function structureText(): Promise<string> {
  return readFile(path.join(process.cwd(), "src/data/product-taxonomy", "structure.json"), "utf8");
}

function namesText(lang: TaxonomyLang): Promise<string> {
  switch (lang) {
    case "nb":
      return readFile(path.join(process.cwd(), "src/data/product-taxonomy", "names-nb.json"), "utf8");
    case "sv":
      return readFile(path.join(process.cwd(), "src/data/product-taxonomy", "names-sv.json"), "utf8");
    case "da":
      return readFile(path.join(process.cwd(), "src/data/product-taxonomy", "names-da.json"), "utf8");
    case "en":
      return readFile(path.join(process.cwd(), "src/data/product-taxonomy", "names-en.json"), "utf8");
  }
}

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
  structure ??= remember(parse<TaxonomyStructure>(structureText()), () => (structure = null));
  return structure;
}

function namesIn(lang: TaxonomyLang): Promise<TaxonomyNames> {
  let kept = names.get(lang);
  if (!kept) {
    kept = remember(parse<TaxonomyNames>(namesText(lang)), () => names.delete(lang));
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

/**
 * What a product's page shows of its standard category (bloat review step 2.23): derived from the release here, kept on the product's row
 * (`products.standard_shown`) by `saveProduct()` and `refreshStandardShown()`, and read by `getProduct()` without opening the files. Null
 * for no category; a category the release does not know keeps only its key.
 */
export async function standardShownOf(category: string | null, attributes: unknown): Promise<StandardShown | null> {
  if (category === null) return null;
  const t = await taxonomy();
  if (!isCategory(t, category)) return null;
  const words = await Promise.all(TAXONOMY_LANGS.map((lang) => taxonomyWords(lang)));
  const paths = Object.fromEntries(TAXONOMY_LANGS.map((lang, at) => [lang, categoryPath(words[at], category)])) as Record<TaxonomyLang, string>;
  return { for: shownKey(category, attributes), paths, google: googleCategory(t, category), english: englishAttributes(t, words[0], attributes) };
}

const SHOWN_ROW = z.object({ id: col.uuid, store_id: col.uuid, standard_category: col.text, standard_attributes: z.unknown(), shown_for: col.textOrNull });

/**
 * The dispatcher's job (bloat review step 2.23): up to `limit` products whose stored words are missing or were derived from another
 * category, attributes or release, derived again. Every statement that writes a product's category writes its words too, or leaves them
 * null in a new row (`standard-shown.scan.test.ts`), so a stale product always has none or a key of an older release: the first read asks
 * only for those, and an idle run is that one statement returning no row. Returns the stores whose catalogue changed.
 */
export async function refreshStandardShown(limit = 200): Promise<{ written: number; storeIds: string[] }> {
  const rows = await typedRows(
    SHOWN_ROW,
    sql`
      select id, store_id, standard_category, standard_attributes, standard_shown ->> 'for' as shown_for
        from commerce.products
       where standard_category is not null
         and (standard_shown is null or standard_shown ->> 'for' not like ${"%|" + TAXONOMY_RELEASE})
       order by updated_at desc
       limit ${limit * 5}`,
  );
  const stale = rows.filter((row) => row.shown_for !== shownKey(row.standard_category, row.standard_attributes)).slice(0, limit);
  const report = jobReport();
  const storeIds = new Set<string>();
  let written = 0;
  for (const row of stale) {
    const shown: StandardShown = (await standardShownOf(row.standard_category, row.standard_attributes)) ?? {
      for: shownKey(row.standard_category, row.standard_attributes),
    };
    try {
      await db().execute(sql`
        update commerce.products set standard_shown = ${JSON.stringify(shown)}::jsonb
         where id = ${row.id}::uuid and store_id = ${row.store_id}::uuid`);
      written++;
      storeIds.add(row.store_id);
    } catch (error) {
      // A row the products' own triggers refuse today (an active product that lost what it needs to be sold) waits; the others go on,
      // and the run is counted as failed so the refusal is seen (bloat review step 1.26).
      report(error, "standard-shown.refused");
    }
  }
  return { written, storeIds: [...storeIds] };
}

export { TAXONOMY_LANGS };
