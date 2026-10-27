/**
 * The standard product taxonomy's rules (wave 6 unit I, D327, `docs/wave-6-catalogue.md` Unit I): Shopify's open Standard Product Taxonomy,
 * kept as generated files in `src/data/product-taxonomy/` (`scripts/product-taxonomy.mjs`) and read on the server by
 * `src/server/product-taxonomy.ts`. Everything here is pure and takes the data it works on, so the browser can run what the editor needs on
 * the small answers the server sends, and tests can give it a small taxonomy of their own.
 *
 * Ids are Shopify's and stable across releases: a category's `aa-1-1` (its parent is the id without its last part), an attribute's and a
 * value's number. A product keeps its category's id and, per attribute id, the ids of its chosen values. Kept apart from the store's own
 * categories (D50, `src/lib/taxonomy.ts`) and from the tax code.
 */

/** A category id by its shape: two letters (the vertical), then a number per level. */
export const CATEGORY_ID = /^[a-z]{2}(-[0-9]+)*$/;
/** The most values a product keeps for one attribute. */
export const MAX_ATTRIBUTE_VALUES = 25;
/** The languages whose names the release ships (Shopify's own translations); others are shown the English names. */
export const TAXONOMY_LANGS = ["en", "nb", "sv", "da"] as const;
export type TaxonomyLang = (typeof TAXONOMY_LANGS)[number];

/** `structure.json`: a category's Google id (0 for none), its attribute ids and, where it names one its own way, that name's handle. */
export type TaxonomyStructure = {
  release: string;
  commit: string;
  label: string;
  google: string;
  categories: Record<string, [number, number[]] | [number, number[], Record<string, string>]>;
  /** An attribute's handle and its values' ids. */
  attributes: Record<string, [string, number[]]>;
  /** A value's handle, without its attribute's (`color__blue` is `blue`). */
  values: Record<string, string>;
};

/** `names-{lang}.json`: categories', attributes', extended attributes' (by handle) and values' names in one language. */
export type TaxonomyNames = { c: Record<string, string>; a: Record<string, string>; x: Record<string, string>; v: Record<string, string> };

/** Names in a language, English where it has none. */
export type TaxonomyWords = { lang: TaxonomyLang; own: TaxonomyNames; english: TaxonomyNames };

/** What a product keeps: an attribute id to its chosen values' ids. */
export type StandardAttributes = Record<string, number[]>;

export type CategoryHit = { id: string; name: string; path: string };
/** A category as the editor shows it: its path, its attributes in the admin's language, and the release it is from. */
export type CategoryDetails = CategoryHit & { attributes: CategoryAttribute[]; release: string };
/** The editor's two read-only questions to the server (the product actions, bound to the store). */
export type SearchCategories = (query: string) => Promise<CategoryHit[]>;
export type LoadCategory = (id: string) => Promise<CategoryDetails | null>;
export type AttributeValue = { id: number; handle: string; name: string };
export type CategoryAttribute = { id: number; handle: string; name: string; values: AttributeValue[] };

/** The taxonomy's language for a locale (`nb-NO`, `no`, `nn` are Norwegian; `sv-SE` Swedish; `da-DK` Danish); English otherwise. */
export function taxonomyLang(locale: string): TaxonomyLang {
  const base = locale.toLowerCase().split(/[-_]/)[0];
  if (base === "nb" || base === "no" || base === "nn") return "nb";
  if (base === "sv" || base === "da") return base;
  return "en";
}

export function parentId(id: string): string | null {
  const cut = id.lastIndexOf("-");
  return cut < 0 ? null : id.slice(0, cut);
}

/** The category and its ancestors, the vertical first. */
export function ancestry(id: string): string[] {
  const out: string[] = [];
  for (let at: string | null = id; at; at = parentId(at)) out.unshift(at);
  return out;
}

export const isCategory = (t: TaxonomyStructure, id: unknown): id is string =>
  typeof id === "string" && CATEGORY_ID.test(id) && Object.hasOwn(t.categories, id);

const nameIn = (words: TaxonomyWords, kind: "c" | "a" | "x" | "v", key: string | number): string =>
  words.own[kind][String(key)] ?? words.english[kind][String(key)] ?? String(key);

export const categoryName = (words: TaxonomyWords, id: string): string => nameIn(words, "c", id);

/** A category's full path in the words' language (`Apparel & Accessories > Clothing > Shirts & Tops`). */
export function categoryPath(words: TaxonomyWords, id: string, separator = " > "): string {
  return ancestry(id)
    .map((step) => nameIn(words, "c", step))
    .join(separator);
}

/** Google's product taxonomy id the release maps a category to, or null. */
export function googleCategory(t: TaxonomyStructure, id: string): number | null {
  const google = t.categories[id]?.[0];
  return google ? google : null;
}

/** Lower case, without diacritics, punctuation as spaces: how searches compare words. */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One category as searches read it: its own name and path in the words' language, and both folded with the English ones. */
export type SearchEntry = { id: string; name: string; path: string; leaf: string; folded: string; depth: number };

/** Every category ready for `searchCategories()`: built once per language, as folding 14,606 paths for each key pressed is slow. */
export function searchIndex(t: TaxonomyStructure, words: TaxonomyWords): SearchEntry[] {
  return Object.keys(t.categories).map((id) => {
    const steps = ancestry(id);
    const own = steps.map((step) => nameIn(words, "c", step));
    const english = words.lang === "en" ? own : steps.map((step) => words.english.c[step] ?? step);
    return {
      id,
      name: own[own.length - 1],
      path: own.join(" > "),
      leaf: fold(words.lang === "en" ? own[own.length - 1] : `${own[own.length - 1]} ${english[english.length - 1]}`),
      folded: fold(words.lang === "en" ? own.join(" ") : `${own.join(" ")} ${english.join(" ")}`),
      depth: steps.length,
    };
  });
}

/**
 * Categories whose path holds every word of the query, in the index's language or in English: the ones whose own name holds them first,
 * then the shallower, then by path. At most `limit`.
 */
export function searchCategories(index: readonly SearchEntry[], query: string, limit = 20): CategoryHit[] {
  const terms = fold(query).split(" ").filter((term) => term.length > 0);
  if (terms.length === 0) return [];
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of index) {
    if (!terms.every((term) => entry.folded.includes(term))) continue;
    const leafWords = entry.leaf.split(" ");
    const inLeaf = terms.filter((term) => entry.leaf.includes(term)).length;
    const whole = terms.filter((term) => leafWords.includes(term)).length;
    scored.push({ entry, score: inLeaf * 10 + whole * 5 - entry.depth });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
  return scored.slice(0, limit).map(({ entry }) => ({ id: entry.id, name: entry.name, path: entry.path }));
}

/** A category's attributes with their values, in the words' language; an extended attribute under the category's own name for it. */
export function categoryAttributes(t: TaxonomyStructure, words: TaxonomyWords, id: string): CategoryAttribute[] {
  const category = t.categories[id];
  if (!category) return [];
  const named = category[2] ?? {};
  return category[1].flatMap((attributeId) => {
    const attribute = t.attributes[String(attributeId)];
    if (!attribute) return [];
    const extended = named[String(attributeId)];
    return [
      {
        id: attributeId,
        handle: attribute[0],
        name: extended ? (words.own.x[extended] ?? words.english.x[extended] ?? nameIn(words, "a", attributeId)) : nameIn(words, "a", attributeId),
        values: attribute[1].map((valueId) => ({ id: valueId, handle: t.values[String(valueId)] ?? String(valueId), name: nameIn(words, "v", valueId) })),
      },
    ];
  });
}

/** Why a category and its attributes cannot be kept, as plain sentences; none when they can. */
export function standardProblems(t: TaxonomyStructure, category: string | null, attributes: StandardAttributes): string[] {
  const problems: string[] = [];
  if (category === null) {
    if (Object.keys(attributes).length > 0) problems.push("Choose a standard category before its attributes.");
    return problems;
  }
  if (!isCategory(t, category)) return [`The standard category ${category} is not in the taxonomy (release ${t.release}).`];
  const allowed = new Set(t.categories[category][1].map(String));
  for (const [attributeId, values] of Object.entries(attributes)) {
    if (!allowed.has(attributeId)) {
      problems.push(`Attribute ${attributeId} is not one of this category's.`);
      continue;
    }
    if (!Array.isArray(values) || values.length === 0) {
      problems.push(`Attribute ${attributeId} has no value.`);
      continue;
    }
    if (values.length > MAX_ATTRIBUTE_VALUES) problems.push(`Choose at most ${MAX_ATTRIBUTE_VALUES} values of one attribute.`);
    const own = new Set(t.attributes[attributeId]?.[1] ?? []);
    const stray = values.filter((value) => !Number.isInteger(value) || !own.has(value));
    if (stray.length > 0) problems.push(`Value ${stray[0]} is not one of attribute ${attributeId}'s.`);
    if (new Set(values).size !== values.length) problems.push(`Attribute ${attributeId} has a value twice.`);
  }
  return problems;
}

/** The attributes a category has, of those given: what stays when a product's category changes. */
export function keepForCategory(attributeIds: readonly number[], attributes: StandardAttributes): StandardAttributes {
  const allowed = new Set(attributeIds.map(String));
  return Object.fromEntries(Object.entries(attributes).filter(([id, values]) => allowed.has(id) && values.length > 0));
}

/** The same attributes in a stable order (attributes and values by id), so a save that changes nothing compares equal. */
export function sortedAttributes(attributes: StandardAttributes): StandardAttributes {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, values]) => values.length > 0)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([id, values]) => [id, [...new Set(values)].sort((a, b) => a - b)]),
  );
}

/** A category from a Shopify CSV's `Product Category` cell: a `gid://shopify/TaxonomyCategory/…` or a full English path; null when unknown. */
export function categoryFromCell(t: TaxonomyStructure, byPath: ReadonlyMap<string, string>, cell: string): string | null {
  const text = cell.trim();
  if (!text) return null;
  const gid = /^gid:\/\/shopify\/TaxonomyCategory\/([a-z]{2}(?:-\d+)*)$/.exec(text);
  if (gid) return isCategory(t, gid[1]) ? gid[1] : null;
  if (isCategory(t, text)) return text;
  return byPath.get(pathKey(text)) ?? null;
}

/** How a full path is compared: folded steps joined by `>`. */
export function pathKey(path: string): string {
  return path
    .split(">")
    .map((step) => fold(step))
    .join(">");
}

/** Every category's English path as a key, for reading a CSV's cells. */
export function pathIndex(t: TaxonomyStructure, english: TaxonomyNames): Map<string, string> {
  const words: TaxonomyWords = { lang: "en", own: english, english };
  const out = new Map<string, string>();
  for (const id of Object.keys(t.categories)) out.set(pathKey(categoryPath(words, id)), id);
  return out;
}

/** An attribute filter in a listing's address resolved to ids: the attribute and the values asked for (any of them). */
export type AttributeFilter = { attributeId: number; valueIds: number[] };

const handleIndexes = new WeakMap<TaxonomyStructure, { attributes: Map<string, number>; values: Map<number, Map<string, number>> }>();

/** Handles to ids, built once per release object: an attribute's handle, and within it a value's. */
function handlesOf(t: TaxonomyStructure) {
  let index = handleIndexes.get(t);
  if (!index) {
    index = { attributes: new Map(), values: new Map() };
    for (const [id, [handle, valueIds]] of Object.entries(t.attributes)) {
      index.attributes.set(handle, Number(id));
      index.values.set(Number(id), new Map(valueIds.map((v) => [t.values[String(v)] ?? String(v), v])));
    }
    handleIndexes.set(t, index);
  }
  return index;
}

/** The address's attribute filters (`t.color=blue`) as ids; an attribute or value the release does not know is dropped. */
export function attributeFilters(t: TaxonomyStructure, asked: readonly { name: string; values: readonly string[] }[]): AttributeFilter[] {
  const index = handlesOf(t);
  return asked.flatMap((attribute) => {
    const attributeId = index.attributes.get(attribute.name);
    if (attributeId === undefined) return [];
    const values = index.values.get(attributeId)!;
    const valueIds = attribute.values.map((v) => values.get(v)).filter((v): v is number => v !== undefined);
    return valueIds.length > 0 ? [{ attributeId, valueIds }] : [];
  });
}

/** An attribute's handle and name in the words' language (its base name: a listing spans categories). */
export function attributeName(t: TaxonomyStructure, words: TaxonomyWords, attributeId: number): { handle: string; name: string } | null {
  const attribute = t.attributes[String(attributeId)];
  return attribute ? { handle: attribute[0], name: nameIn(words, "a", attributeId) } : null;
}

/** A value's handle and name in the words' language. */
export function valueName(t: TaxonomyStructure, words: TaxonomyWords, valueId: number): { handle: string; name: string } | null {
  const handle = t.values[String(valueId)];
  return handle === undefined ? null : { handle, name: nameIn(words, "v", valueId) };
}
