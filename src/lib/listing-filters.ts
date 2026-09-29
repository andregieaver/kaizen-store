import { PRODUCT_KINDS, type ProductKind } from "./query-understanding";

/**
 * Sorting and filtering a store's product listings (D78): the products
 * page, a category's or tag's, and search results. The choices live in the
 * page's address, so a filtered list can be shared, bookmarked and opened
 * again, and the server applies them. Shared by the server and the dialog
 * in the browser.
 *
 * - `kind=stay&kind=rental`: kinds of product (any of them).
 * - `category=lamper`, `tag=nyhet`: the store's categories (with those
 *   below them) and tags, by address (any of each; categories and tags
 *   together).
 * - `o.Farge=Blå&o.Størrelse=M`: variant options by name (any value of an
 *   option; every option named, on the same variant).
 * - `f.material=wool&f.material=cotton&f.organic=1`: the store's custom fields
 *   offered as filters (D118), by the field's name (any value of a field:
 *   a choice's key, or `1` for a yes or no; every field named). Names that
 *   are not public filter fields of the store are dropped by the server.
 * - `f.weight.min=100&f.weight.max=500`: a number or measurement field as a
 *   range (D120), in the field's own numbers (a measurement's first unit);
 *   either end may be left out.
 * - `min=100&max=500`: the price range in whole units of the currency, as
 *   the shopper sees prices (without VAT for businesses).
 * - `stock=1`: only what can be bought now.
 * - `sort=priceLow`: the order; the page's own order when left out.
 */

export const LISTING_SORTS = ["featured", "newest", "priceLow", "priceHigh", "title"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export type OptionFilter = { name: string; values: string[] };

/** A number or measurement custom field (D120) narrowed to a range; an end left out is null, and at least one is set. */
export type RangeFilter = { name: string; min: number | null; max: number | null };

export type ListingFilters = {
  kinds: ProductKind[];
  categories: string[];
  tags: string[];
  options: OptionFilter[];
  /** Custom fields (D118) by name: any of the values of each, every field named. */
  fields: OptionFilter[];
  /** Number and measurement custom fields (D120) by name, every field named. */
  ranges: RangeFilter[];
  /** Whole units of the currency, as shown to the shopper. */
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  sort: ListingSort;
};

export const NO_FILTERS: ListingFilters = {
  kinds: [],
  categories: [],
  tags: [],
  options: [],
  fields: [],
  ranges: [],
  minPrice: null,
  maxPrice: null,
  inStock: false,
  sort: "featured",
};

/** Limits on what an address may ask for, so a long one cannot make a heavy query. */
const MAX_VALUES = 30;
const MAX_OPTIONS = 6;
const MAX_TEXT = 80;
const OPTION_PREFIX = "o.";
const FIELD_PREFIX = "f.";
/** A custom field's name (`src/lib/custom-fields.ts`): lowercase letters, digits and underscores. */
const FIELD_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_PRICE = 10_000_000;
/** The most a field's range may ask for, either way (a temperature can be below zero). */
const MAX_RANGE = 1_000_000_000_000;
const RANGE_KEY = /^f\.([a-z][a-z0-9_]{0,39})\.(min|max)$/;
const RANGE_NUMBER = /^-?\d{1,15}(?:[.,]\d{1,9})?$/;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function all(params: Params, key: string): string[] {
  const raw = params instanceof URLSearchParams ? params.getAll(key) : params[key];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return [...new Set(list.map((value) => value.trim()).filter((value) => value && value.length <= MAX_TEXT))].slice(0, MAX_VALUES);
}

function keys(params: Params): string[] {
  return params instanceof URLSearchParams ? [...new Set(params.keys())] : Object.keys(params);
}

const slug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

function price(params: Params, key: string): number | null {
  const [value] = all(params, key);
  if (!value) return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= 0 && number <= MAX_PRICE ? Math.round(number * 100) / 100 : null;
}

/** A number as written in an address or a field: whole or decimal, a comma or a point, within bounds; otherwise null. */
export function parseRangeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!RANGE_NUMBER.test(trimmed)) return null;
  const number = Number(trimmed.replace(",", "."));
  return Number.isFinite(number) && Math.abs(number) <= MAX_RANGE ? Math.round(number * 1e6) / 1e6 : null;
}

/** A range from its two ends, put right when reversed; null when neither is a number. */
export function rangeOf(name: string, min: number | null, max: number | null): RangeFilter | null {
  if (min === null && max === null) return null;
  return min !== null && max !== null && min > max ? { name, min: max, max: min } : { name, min, max };
}

function ranges(params: Params): RangeFilter[] {
  const ends = new Map<string, { min: number | null; max: number | null }>();
  for (const key of keys(params)) {
    const match = RANGE_KEY.exec(key);
    if (!match) continue;
    const [value] = all(params, key);
    const number = value === undefined ? null : parseRangeNumber(value);
    if (number === null) continue;
    const end = ends.get(match[1]) ?? { min: null, max: null };
    end[match[2] as "min" | "max"] = number;
    ends.set(match[1], end);
  }
  return [...ends.entries()]
    .slice(0, MAX_OPTIONS)
    .map(([name, end]) => rangeOf(name, end.min, end.max))
    .filter((range): range is RangeFilter => range !== null);
}

/** The filters in a listing's address; anything unknown or malformed is left out. */
export function parseListingParams(params: Params): ListingFilters {
  const kinds = all(params, "kind").filter((kind): kind is ProductKind => (PRODUCT_KINDS as readonly string[]).includes(kind));
  const options = keys(params)
    .filter((key) => key.startsWith(OPTION_PREFIX) && key.length > OPTION_PREFIX.length && key.length <= MAX_TEXT)
    .slice(0, MAX_OPTIONS)
    .map((key) => ({ name: key.slice(OPTION_PREFIX.length), values: all(params, key) }))
    .filter((option) => option.values.length > 0);
  const fields = keys(params)
    .filter((key) => key.startsWith(FIELD_PREFIX) && FIELD_NAME.test(key.slice(FIELD_PREFIX.length)))
    .slice(0, MAX_OPTIONS)
    .map((key) => ({ name: key.slice(FIELD_PREFIX.length), values: all(params, key) }))
    .filter((field) => field.values.length > 0);
  let minPrice = price(params, "min");
  let maxPrice = price(params, "max");
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  const [sort] = all(params, "sort");
  return {
    kinds,
    categories: all(params, "category").filter(slug),
    tags: all(params, "tag").filter(slug),
    options,
    fields,
    ranges: ranges(params),
    minPrice: minPrice === 0 ? null : minPrice,
    maxPrice,
    inStock: all(params, "stock").includes("1"),
    sort: (LISTING_SORTS as readonly string[]).includes(sort ?? "") ? (sort as ListingSort) : "featured",
  };
}

/**
 * The address's query for filters (`?kind=stay&min=100`), or "" for none;
 * `keep` holds other parameters the page needs, such as a search's `q`.
 */
export function listingQuery(filters: ListingFilters, keep: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(keep)) if (value) params.append(key, value);
  for (const kind of filters.kinds) params.append("kind", kind);
  for (const category of filters.categories) params.append("category", category);
  for (const tag of filters.tags) params.append("tag", tag);
  for (const option of filters.options) for (const value of option.values) params.append(`${OPTION_PREFIX}${option.name}`, value);
  for (const field of filters.fields) for (const value of field.values) params.append(`${FIELD_PREFIX}${field.name}`, value);
  for (const range of filters.ranges) {
    if (range.min !== null) params.set(`${FIELD_PREFIX}${range.name}.min`, String(range.min));
    if (range.max !== null) params.set(`${FIELD_PREFIX}${range.name}.max`, String(range.max));
  }
  if (filters.minPrice !== null) params.set("min", String(filters.minPrice));
  if (filters.maxPrice !== null) params.set("max", String(filters.maxPrice));
  if (filters.inStock) params.set("stock", "1");
  if (filters.sort !== "featured") params.set("sort", filters.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** How many filters are chosen (the order is not one). */
export function filterCount(filters: ListingFilters): number {
  return (
    filters.kinds.length +
    filters.categories.length +
    filters.tags.length +
    filters.options.reduce((sum, option) => sum + option.values.length, 0) +
    filters.fields.reduce((sum, field) => sum + field.values.length, 0) +
    filters.ranges.length +
    (filters.minPrice !== null || filters.maxPrice !== null ? 1 : 0) +
    (filters.inStock ? 1 : 0)
  );
}

/** Whether anything changes the page's own list: a filter or another order. */
export const isFiltered = (filters: ListingFilters) => filterCount(filters) > 0 || filters.sort !== "featured";

/** One chosen filter, to show and take away on its own. */
export type ChosenFilter =
  | { type: "kind"; value: ProductKind }
  | { type: "category" | "tag"; value: string }
  | { type: "option"; name: string; value: string }
  | { type: "field"; name: string; value: string }
  | { type: "range"; name: string }
  | { type: "price" }
  | { type: "stock" };

export function chosenFilters(filters: ListingFilters): ChosenFilter[] {
  return [
    ...filters.kinds.map((value) => ({ type: "kind" as const, value })),
    ...filters.categories.map((value) => ({ type: "category" as const, value })),
    ...filters.tags.map((value) => ({ type: "tag" as const, value })),
    ...filters.options.flatMap((option) => option.values.map((value) => ({ type: "option" as const, name: option.name, value }))),
    ...filters.fields.flatMap((field) => field.values.map((value) => ({ type: "field" as const, name: field.name, value }))),
    ...filters.ranges.map((range) => ({ type: "range" as const, name: range.name })),
    ...(filters.minPrice !== null || filters.maxPrice !== null ? [{ type: "price" as const }] : []),
    ...(filters.inStock ? [{ type: "stock" as const }] : []),
  ];
}

/** The filters without one of them. */
export function withoutFilter(filters: ListingFilters, chosen: ChosenFilter): ListingFilters {
  switch (chosen.type) {
    case "kind":
      return { ...filters, kinds: filters.kinds.filter((kind) => kind !== chosen.value) };
    case "category":
      return { ...filters, categories: filters.categories.filter((value) => value !== chosen.value) };
    case "tag":
      return { ...filters, tags: filters.tags.filter((value) => value !== chosen.value) };
    case "option":
      return {
        ...filters,
        options: filters.options
          .map((option) => (option.name === chosen.name ? { ...option, values: option.values.filter((value) => value !== chosen.value) } : option))
          .filter((option) => option.values.length > 0),
      };
    case "field":
      return {
        ...filters,
        fields: filters.fields
          .map((field) => (field.name === chosen.name ? { ...field, values: field.values.filter((value) => value !== chosen.value) } : field))
          .filter((field) => field.values.length > 0),
      };
    case "range":
      return { ...filters, ranges: filters.ranges.filter((range) => range.name !== chosen.name) };
    case "price":
      return { ...filters, minPrice: null, maxPrice: null };
    case "stock":
      return { ...filters, inStock: false };
  }
}

/** Whole units of a price range as minor units of the currency (`digits` after the point). */
export function toMinorUnits(amount: number | null, digits: number): number | null {
  return amount === null ? null : Math.round(amount * 10 ** digits);
}
