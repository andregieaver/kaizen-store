import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import type { Buyer } from "@/lib/b2b";
import { localized, type FieldDef } from "@/lib/custom-fields";
import { YES, choiceFields, fieldFilterValues, filterableFields, rangeFields, type RangeField } from "@/lib/field-filters";
import { t } from "@/lib/i18n";
import { toMinorUnits, type ListingFilters } from "@/lib/listing-filters";
import { shown, type Market } from "@/lib/markets";
import { minorUnitDigits } from "@/lib/money";
import { PRODUCT_KINDS, type ProductKind } from "@/lib/query-understanding";
import { categoryTree, withDescendants, type Term } from "@/lib/taxonomy";
import { attributeFilters, attributeName, valueName, type AttributeFilter } from "@/lib/product-taxonomy";

import { CATALOG_TAG, catalogTag, listGridProducts, type GridProduct } from "./catalog";
import { activeFieldGroups, fieldsTag } from "./custom-fields";
import { convertedSql, inCategories, inStockNow, inTerms, manualPlace, OFFERED, shownPrice, textList, withTags } from "./product-conditions";
import { siteTerms, termsTag } from "./taxonomy";
import { taxonomy, taxonomyWords } from "./product-taxonomy";

/**
 * Sorting and filtering product listings (D78): which of a page's products
 * meet the shopper's filters, in the order asked, and what the page's
 * products offer to filter by (kinds, categories, tags, variant options
 * and the price range, with counts). A page's products are its `scope`:
 * a category's or tag's (by term ids), search results (by product ids,
 * in their order), or the whole store.
 */

type Row = Record<string, unknown>;

/** A listing's products: in these categories and tags, or these ids; `orderTerm` is the category or tag whose owner's order "featured" follows (D319). */
export type ListingScope = { categoryIds?: string[]; tagIds?: string[]; ids?: string[]; orderTerm?: string };

/** Who is looking: prices are compared as shown to them, and a store selling to both shows each kind only its products. */
export type Viewer = { buyer: Buyer; audienceBoth: boolean };

/** How many products a page lists at most. */
export const LISTING_LIMIT = 48;
/** How many of a page's products its choices are counted over. */
const FACET_LIMIT = 2000;

const uuids = (list: string[]) => `{${list.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(",")}}`;

/** The page's products: active, with a price in the market, in its scope, shown to this viewer. */
function scopeClause(storeId: string, marketCode: string, scope: ListingScope, viewer: Viewer): SQL {
    return sql`p.store_id = ${storeId}::uuid and p.status = 'active' and ${OFFERED}
    and exists (
      select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${marketCode}
    )
    and ${inTerms(scope.categoryIds ?? [])} and ${inTerms(scope.tagIds ?? [])}
    and ${scope.ids ? sql`p.id = any(${uuids(scope.ids)}::uuid[])` : sql`true`}
    and ${viewer.audienceBoth ? sql`p.audience in ('all', ${viewer.buyer === "business" ? "businesses" : "consumers"})` : sql`true`}`;
}

/**
 * What an address asked of custom fields (D118), as SQL over a product `p`:
 * the fields it names, resolved to the store's public filter fields (a name
 * that is not one is dropped, and so is a value the field cannot hold), each
 * a test on what was entered in the language-neutral row; a choice is any of
 * the values (a checkbox field holds a list), a yes or no is yes. The field's
 * id and every value are parameters.
 */
function fieldsClause(filters: ListingFilters, defs: FieldDef[]): SQL[] {
  const parts: SQL[] = [];
  const choices = choiceFields(defs);
  for (const asked of filters.fields) {
    const def = choices.find((d) => d.name === asked.name);
    if (!def) continue;
    const values = fieldFilterValues(def, asked.values);
    if (values.length === 0) continue;
    const held = sql`fv.values -> ${def.id}::text`;
    const test =
      def.type === "boolean"
        ? sql`${held} = 'true'::jsonb`
        : def.type === "checkbox"
          ? sql`jsonb_exists_any(${held}, ${textList(values)})`
          : sql`(fv.values ->> ${def.id}::text) = any(${textList(values)})`;
    parts.push(sql`exists (
      select 1 from commerce.field_values fv
      where fv.store_id = p.store_id and fv.entity = 'product' and fv.entity_id = p.id and fv.locale = '' and ${test}
    )`);
  }
  return parts;
}

/**
 * A number or measurement field's range (D120): the fields it names, resolved
 * to the store's public filter fields of those types (a name that is not one
 * is dropped), each a test on what was entered in the language-neutral row.
 * A number is a JSON number; a measurement `{ value, unit }` is compared only
 * when entered in the field's first unit. Every cast is guarded by the JSON
 * type, so a row that holds anything else is left out and never raises. The
 * field's id, the unit and the bounds are parameters.
 */
function rangesClause(filters: ListingFilters, defs: FieldDef[]): SQL[] {
  const parts: SQL[] = [];
  const known = rangeFields(defs);
  for (const asked of filters.ranges) {
    const range = known.find((r) => r.def.name === asked.name);
    if (!range || (asked.min === null && asked.max === null)) continue;
    const held = sql`fv.values -> ${range.def.id}::text`;
    const amount = rangeAmount(range, held);
    const bounds: SQL[] = [];
    if (asked.min !== null) bounds.push(sql`${amount} >= ${String(asked.min)}::numeric`);
    if (asked.max !== null) bounds.push(sql`${amount} <= ${String(asked.max)}::numeric`);
    parts.push(sql`exists (
      select 1 from commerce.field_values fv
      where fv.store_id = p.store_id and fv.entity = 'product' and fv.entity_id = p.id and fv.locale = ''
        and ${sql.join(bounds, sql` and `)}
    )`);
  }
  return parts;
}

/** The number a range field's stored value `held` stands for, or null when it holds none in the field's own unit. */
function rangeAmount(range: RangeField, held: SQL): SQL {
  return range.kind === "number"
    ? sql`(case when jsonb_typeof(${held}) = 'number' then (${held})::numeric end)`
    : sql`(case when jsonb_typeof(${held}) = 'object' and jsonb_typeof(${held} -> 'value') = 'number'
        and coalesce(${held} ->> 'unit', '') = ${range.unit} then (${held} -> 'value')::numeric end)`;
}

/**
 * The standard taxonomy's attributes (D327) an address asked for, resolved to ids: each attribute named holds any of its values asked.
 * Every test is a containment on the product's own attributes (the GIN index answers it), the ids parameters.
 */
function attributesClause(asked: readonly AttributeFilter[]): SQL[] {
  return asked.map(({ attributeId, valueIds }) =>
    sql`(${sql.join(
      valueIds.map((valueId) => sql`p.standard_attributes @> ${JSON.stringify({ [String(attributeId)]: [valueId] })}::jsonb`),
      sql` or `,
    )})`,
  );
}

/** What the shopper's filters ask of a product `p`, as SQL; every value a parameter. */
function filtersClause(filters: ListingFilters, market: Market, viewer: Viewer, fieldDefs: FieldDef[] = [], attributes: readonly AttributeFilter[] = []): SQL {
  const parts: SQL[] = [];
  if (filters.kinds.length > 0) parts.push(sql`p.kind = any(${textList(filters.kinds)})`);
  if (filters.categories.length > 0) parts.push(inCategories(filters.categories));
  if (filters.tags.length > 0) parts.push(withTags(filters.tags));
  if (filters.options.length > 0) {
    // Every option chosen, on one variant: blue and M is a blue M, not a blue S and a red M.
    const each = filters.options.map((option) => sql`(v.options ->> ${option.name}) = any(${textList(option.values)})`);
    parts.push(sql`exists (
      select 1 from commerce.product_variants v
      where v.product_id = p.id and v.active and ${sql.join(each, sql` and `)}
    )`);
  }
  parts.push(...fieldsClause(filters, fieldDefs));
  parts.push(...rangesClause(filters, fieldDefs));
  parts.push(...attributesClause(attributes));
  if (filters.minPrice !== null || filters.maxPrice !== null) {
    const digits = minorUnitDigits(market.currency);
    parts.push(sql`exists (
      select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.product_id = p.id and v.active and cp.market_code = ${market.code}
        and ${convertedSql(shownPrice(market.code, viewer.buyer === "business"), market)} between ${toMinorUnits(filters.minPrice, digits) ?? 0}
          and ${toMinorUnits(filters.maxPrice, digits) ?? Number.MAX_SAFE_INTEGER}
    )`);
  }
  if (filters.inStock) parts.push(inStockNow());
  return parts.length === 0 ? sql`true` : sql.join(parts, sql` and `);
}

/**
 * The products of a page that meet the filters, sorted, as product cards
 * show them. "featured" keeps the page's own order: search results'
 * relevance, a category's or tag's owner's order (D319), else the order
 * products were added.
 */
export async function listingProducts(
  storeId: string,
  market: Market,
  scope: ListingScope,
  filters: ListingFilters,
  viewer: Viewer,
): Promise<GridProduct[]> {
  const lowest = sql`(select min(${shownPrice(market.code, viewer.buyer === "business")})
    from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
    where v.product_id = p.id and v.active and cp.market_code = ${market.code})`;
  const title = sql`(select lower(title) from commerce.product_translations tr
    where tr.product_id = p.id order by tr.locale = ${market.locale} desc, tr.locale limit 1)`;
  const order =
    filters.sort === "newest"
      ? sql`p.created_at desc, p.handle`
      : filters.sort === "priceLow"
        ? sql`${lowest}, p.handle`
        : filters.sort === "priceHigh"
          ? sql`${lowest} desc, p.handle`
          : filters.sort === "title"
            ? sql`${title}, p.handle`
            : scope.ids
              ? sql`array_position(${uuids(scope.ids)}::uuid[], p.id)`
              : scope.orderTerm && /^[0-9a-f-]{36}$/i.test(scope.orderTerm)
                ? sql`${manualPlace(scope.orderTerm)}, p.created_at, p.handle`
                : sql`p.created_at, p.handle`;
  const fieldDefs = filters.fields.length > 0 || filters.ranges.length > 0 ? filterableFields(await activeFieldGroups(storeId, "product")) : [];
  const attributes = (filters.attributes ?? []).length > 0 ? attributeFilters(await taxonomy(), filters.attributes) : [];
  const rows = await readDb().execute<Row>(sql`
    select p.id from commerce.products p
    where ${scopeClause(storeId, market.code, scope, viewer)} and ${filtersClause(filters, market, viewer, fieldDefs, attributes)}
    order by ${order}
    limit ${LISTING_LIMIT}
  `);
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return [];
  return listGridProducts(storeId, market, { categoryIds: [], tagIds: [], ids, sort: "given", limit: LISTING_LIMIT });
}

export type FacetValue = { value: string; label: string; count: number };

/** What a page's products offer to filter by, each with how many products have it. */
export type ListingFacets = {
  /** The page's products, before filters. */
  total: number;
  kinds: { kind: ProductKind; count: number }[];
  /** Categories in tree order, with their depth. */
  categories: (FacetValue & { depth: number })[];
  tags: FacetValue[];
  /** Variant options by name (size, colour, rental period …), with their values. */
  options: { name: string; label: string; values: FacetValue[] }[];
  /** The store's custom fields offered as filters (D118) by the field's name, in the shopper's language; only values that narrow the page. */
  fields: { name: string; label: string; values: FacetValue[] }[];
  /** Every value of those fields with its label, narrowing or not, to word a chosen filter. */
  fieldLabels: { name: string; label: string; values: Record<string, string> }[];
  /** Number and measurement fields offered as ranges (D120): the least and most the page's products hold, in `unit` (a measurement's first unit); only those that differ. */
  ranges: { name: string; label: string; unit: string; min: number; max: number }[];
  /** Every range field with its label and unit, narrowing or not, to word a chosen filter. */
  rangeLabels: { name: string; label: string; unit: string }[];
  /** The standard taxonomy's attributes (D327) the page's products carry, by handle, named in the shopper's language; the most carried first. */
  attributes: { name: string; label: string; values: FacetValue[] }[];
  /** Every such attribute with its values' names, narrowing or not, to word a chosen filter. */
  attributeLabels: { name: string; label: string; values: Record<string, string> }[];
  /** Whole units of the currency, as prices are shown to the viewer; null without prices. */
  price: { min: number; max: number } | null;
};

/** How many of the standard taxonomy's attributes a listing offers, at most. */
const ATTRIBUTE_FACETS = 8;

/** Sizes in the order people expect, before other values. */
const SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl"];

function byValue(a: string, b: string): number {
  const sa = SIZES.indexOf(a.toLowerCase());
  const sb = SIZES.indexOf(b.toLowerCase());
  if (sa >= 0 || sb >= 0) return (sa < 0 ? SIZES.length : sa) - (sb < 0 ? SIZES.length : sb);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * The choices a page's products offer (D78). Only what would narrow the
 * page is offered: a kind, category, tag or option value some but not all
 * of its products have (a chosen one is always shown above the list, to
 * take away). `labels` names Kaizen's own option names and values (the
 * demo's).
 */
export async function listingFacets(
  storeId: string,
  market: Market,
  scope: ListingScope,
  viewer: Viewer,
  labels: Record<string, string> = {},
): Promise<ListingFacets> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId), termsTag({ storeId, contentType: "product" }), fieldsTag(storeId));

  const business = viewer.buyer === "business";
  const products = await readDb().execute<Row>(sql`
    select p.id, p.kind,
      (select min(${shownPrice(market.code, business)}) from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}) as low,
      (select max(${shownPrice(market.code, business)}) from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active and cp.market_code = ${market.code}) as high
    from commerce.products p
    where ${scopeClause(storeId, market.code, scope, viewer)}
    limit ${FACET_LIMIT}
  `);
  const total = products.length;
  const empty: ListingFacets = { total, kinds: [], categories: [], tags: [], options: [], fields: [], fieldLabels: [], ranges: [], rangeLabels: [], attributes: [], attributeLabels: [], price: null };
  if (total === 0) return empty;
  const ids = uuids(products.map((row) => String(row.id)));

  const allDefs = filterableFields(await activeFieldGroups(storeId, "product"));
  const fieldDefs = choiceFields(allDefs);
  const rangeDefs = rangeFields(allDefs);
  const [links, optionRows, terms, fieldRows, rangeRows, attributeRows] = await Promise.all([
    readDb().execute<Row>(sql`
      select pt.product_id, pt.term_id from commerce.product_terms pt
      where pt.store_id = ${storeId}::uuid and pt.product_id = any(${ids}::uuid[])
      union
      -- The collections filled by rules each product meets (D319), so they are choices like those filled by hand.
      select p.id, rt.id from commerce.products p
      join commerce.terms rt on rt.store_id = p.store_id and rt.content_type = 'product' and rt.rules is not null
      where p.store_id = ${storeId}::uuid and p.id = any(${ids}::uuid[]) and commerce.product_matches_rules(p.store_id, p.id, rt.rules)
    `),
    readDb().execute<Row>(sql`
      select o.key as name, o.value, count(distinct v.product_id)::int as count
      from commerce.product_variants v, jsonb_each_text(v.options) o
      where v.product_id = any(${ids}::uuid[]) and v.active
      group by o.key, o.value
    `),
    siteTerms(storeId, "product"),
    fieldDefs.length === 0
      ? Promise.resolve([])
      : readDb().execute<Row>(sql`
          select f.id as field_id, fv.values -> f.id as value
          from commerce.field_values fv
          cross join unnest(${textList(fieldDefs.map((d) => d.id))}) as f(id)
          where fv.store_id = ${storeId}::uuid and fv.entity = 'product' and fv.locale = ''
            and fv.entity_id = any(${ids}::uuid[]) and jsonb_exists(fv.values, f.id)
        `),
    rangeDefs.length === 0
      ? Promise.resolve([])
      : readDb().execute<Row>(sql`
          select f.id as field_id, min(x.n)::float8 as low, max(x.n)::float8 as high
          from commerce.field_values fv
          cross join unnest(${textList(rangeDefs.map((r) => r.def.id))}, ${textList(rangeDefs.map((r) => r.kind))}, ${textList(rangeDefs.map((r) => r.unit))})
            as f(id, kind, unit)
          cross join lateral (select case
            when f.kind = 'number' and jsonb_typeof(fv.values -> f.id) = 'number' then (fv.values -> f.id)::numeric
            when f.kind = 'measurement' and jsonb_typeof(fv.values -> f.id) = 'object'
              and jsonb_typeof(fv.values -> f.id -> 'value') = 'number'
              and coalesce(fv.values -> f.id ->> 'unit', '') = f.unit then (fv.values -> f.id -> 'value')::numeric
            end as n) x
          where fv.store_id = ${storeId}::uuid and fv.entity = 'product' and fv.locale = ''
            and fv.entity_id = any(${ids}::uuid[]) and x.n between -1000000000000 and 1000000000000
          group by f.id
        `),
    // The standard taxonomy's attributes (D327): each value with how many of the page's products carry it.
    readDb().execute<Row>(sql`
      select a.key as attribute, v.value as value, count(distinct p.id)::int as count
      from commerce.products p
      cross join lateral jsonb_each(p.standard_attributes) a
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.value) = 'array' then a.value else '[]'::jsonb end) v
      where p.store_id = ${storeId}::uuid and p.id = any(${ids}::uuid[]) and p.standard_attributes <> '{}'::jsonb
      group by a.key, v.value
    `),
  ]);

  const narrows = (count: number) => count > 0 && count < total;
  const label = (text: string) => labels[text] ?? text;

  const kindCounts = new Map<string, number>();
  for (const row of products) kindCounts.set(String(row.kind), (kindCounts.get(String(row.kind)) ?? 0) + 1);
  const kinds = PRODUCT_KINDS.map((kind) => ({ kind, count: kindCounts.get(kind) ?? 0 }));

  const termsOf = new Map<string, Set<string>>();
  for (const row of links) {
    const product = String(row.product_id);
    if (!termsOf.has(product)) termsOf.set(product, new Set());
    termsOf.get(product)!.add(String(row.term_id));
  }
  const countWith = (termIds: string[]) => {
    let count = 0;
    for (const set of termsOf.values()) if (termIds.some((id) => set.has(id))) count += 1;
    return count;
  };
  const categories = categoryTree(terms).map((term) => ({
    value: term.slug,
    label: term.name,
    depth: term.depth,
    count: countWith(withDescendants(terms, [term.id])),
  }));
  const tags = terms
    .filter((term: Term) => term.kind === "tag")
    .map((term) => ({ value: term.slug, label: term.name, count: countWith([term.id]) }));

  const byName = new Map<string, FacetValue[]>();
  for (const row of optionRows) {
    const name = String(row.name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push({ value: String(row.value), label: label(String(row.value)), count: Number(row.count) });
  }
  const options = [...byName.entries()]
    .map(([name, values]) => ({ name, label: label(name), values: values.sort((a, b) => byValue(a.value, b.value)) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Custom fields (D118): the products having each choice, or a yes, counted from what was entered.
  const yes = t(market.lang).customFields.yes;
  const held = new Map<string, Map<string, number>>();
  for (const row of fieldRows) {
    const def = fieldDefs.find((d) => d.id === String(row.field_id));
    if (!def) continue;
    const value = row.value as unknown;
    const keys = def.type === "boolean" ? (value === true ? [YES] : []) : (Array.isArray(value) ? value : [value]).filter((k): k is string => typeof k === "string");
    const counts = held.get(def.id) ?? new Map<string, number>();
    for (const key of new Set(keys)) counts.set(key, (counts.get(key) ?? 0) + 1);
    held.set(def.id, counts);
  }
  const fieldFacets = fieldDefs.map((def) => {
    const counts = held.get(def.id) ?? new Map<string, number>();
    const all: FacetValue[] =
      def.type === "boolean"
        ? [{ value: YES, label: yes, count: counts.get(YES) ?? 0 }]
        : (def.choices ?? []).map((choice) => ({ value: choice.key, label: localized(choice.label, choice.labels, market.locale), count: counts.get(choice.key) ?? 0 }));
    return { name: def.name, label: localized(def.label, def.labels, market.locale), all };
  });

  // Number and measurement fields (D120): the range the page's products hold, in the field's own unit.
  const spans = new Map(rangeRows.map((row) => [String(row.field_id), { min: Number(row.low), max: Number(row.high) }]));
  const rangeFacets = rangeDefs.map((r) => ({
    name: r.def.name,
    label: localized(r.def.label, r.def.labels, market.locale),
    unit: r.unit,
    span: spans.get(r.def.id),
  }));

  // The standard taxonomy's attributes, named from the release in the shopper's language; the ones the most products carry first.
  const attributeFacets = attributeRows.length === 0 ? [] : await attributeFacetsOf(attributeRows, market.locale);

  // Prices are kept in the country's own currency and shown in the one chosen (D109).
  const lows = products.map((row) => shown(market, Number(row.low))).filter(Number.isFinite);
  const highs = products.map((row) => shown(market, Number(row.high))).filter(Number.isFinite);
  const unit = 10 ** minorUnitDigits(market.currency);
  const price =
    lows.length > 0 && highs.length > 0
      ? { min: Math.floor(Math.min(...lows) / unit), max: Math.ceil(Math.max(...highs) / unit) }
      : null;

  return {
    total,
    kinds: kinds.filter((kind) => narrows(kind.count)),
    categories: categories.filter((category) => narrows(category.count)),
    tags: tags.filter((tag) => narrows(tag.count)),
    options: options
      .map((option) => ({ name: option.name, label: option.label, values: option.values.filter((value) => narrows(value.count)) }))
      .filter((option) => option.values.length > 0),
    fields: fieldFacets
      .map((field) => ({ name: field.name, label: field.label, values: field.all.filter((value) => narrows(value.count)) }))
      .filter((field) => field.values.length > 0),
    fieldLabels: fieldFacets.map((field) => ({
      name: field.name,
      label: field.label,
      values: Object.fromEntries(field.all.map((value) => [value.value, value.label])),
    })),
    ranges: rangeFacets.flatMap(({ span, ...facet }) =>
      span && Number.isFinite(span.min) && Number.isFinite(span.max) && span.max > span.min ? [{ ...facet, min: span.min, max: span.max }] : [],
    ),
    rangeLabels: rangeFacets.map(({ name, label, unit }) => ({ name, label, unit })),
    attributes: attributeFacets
      .map((attribute) => ({ name: attribute.name, label: attribute.label, values: attribute.all.filter((value) => narrows(value.count)) }))
      .filter((attribute) => attribute.values.length > 0)
      .slice(0, ATTRIBUTE_FACETS),
    attributeLabels: attributeFacets.map((attribute) => ({
      name: attribute.name,
      label: attribute.label,
      values: Object.fromEntries(attribute.all.map((value) => [value.value, value.label])),
    })),
    price: price && price.max > price.min ? price : null,
  };
}

/**
 * Products related to one (D79): those sharing the most of its categories
 * and tags first, then the newest, never the product itself; active, with a
 * price in the market, as product cards show them.
 */
export async function relatedProducts(storeId: string, market: Market, productId: string, limit: number): Promise<GridProduct[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));

  const rows = await readDb().execute<Row>(sql`
    select p.id
    from commerce.products p
    left join lateral (
      select count(*) as shared from commerce.product_terms pt
      where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id in (
        select term_id from commerce.product_terms where store_id = ${storeId}::uuid and product_id = ${productId}::uuid
      )
    ) s on true
    where ${scopeClause(storeId, market.code, {}, { buyer: "private", audienceBoth: false })} and p.id <> ${productId}::uuid
    order by s.shared desc, p.created_at desc, p.handle
    limit ${Math.max(1, Math.min(LISTING_LIMIT, limit))}
  `);
  const ids = rows.map((row) => String(row.id));
  if (ids.length === 0) return [];
  return listGridProducts(storeId, market, { categoryIds: [], tagIds: [], ids, sort: "given", limit: LISTING_LIMIT });
}

/** The attributes' counts as facets: handles and names from the release, values by name, attributes by how many products carry one. */
async function attributeFacetsOf(rows: Row[], locale: string): Promise<{ name: string; label: string; carried: number; all: FacetValue[] }[]> {
  const [t, words] = await Promise.all([taxonomy(), taxonomyWords(locale)]);
  const byAttribute = new Map<number, FacetValue[]>();
  for (const row of rows) {
    const attributeId = Number(row.attribute);
    const valueId = Number(row.value);
    if (!Number.isInteger(attributeId) || !Number.isInteger(valueId)) continue;
    const value = valueName(t, words, valueId);
    if (!value) continue;
    const list = byAttribute.get(attributeId) ?? [];
    list.push({ value: value.handle, label: value.name, count: Number(row.count) });
    byAttribute.set(attributeId, list);
  }
  return [...byAttribute.entries()]
    .flatMap(([attributeId, values]) => {
      const attribute = attributeName(t, words, attributeId);
      return attribute
        ? [{ name: attribute.handle, label: attribute.name, carried: Math.max(...values.map((v) => v.count)), all: values.sort((a, b) => a.label.localeCompare(b.label, locale)) }]
        : [];
    })
    .sort((a, b) => b.carried - a.carried || a.label.localeCompare(b.label, locale));
}
