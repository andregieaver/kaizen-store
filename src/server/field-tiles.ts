import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import {
  groupApplies,
  shownGroup,
  withParents,
  type Facts,
  type FieldData,
  type FieldGroup,
  type ShownGroup,
  type Values,
} from "@/lib/custom-fields";
import { t } from "@/lib/i18n";
import { TILE_FIELDS_MAX } from "@/lib/page-content";
import { isTileFieldType, tileLines, type TileField } from "@/lib/tile-fields";

import { activeFieldGroups, fieldsTag } from "./custom-fields";
import { getStore } from "./stores";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof readDb>, "execute">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** Whether any rule of these groups asks about categories or tags, so the terms are worth reading. */
const asksAboutTerms = (groups: readonly FieldGroup[]): boolean =>
  groups.some((group) =>
    group.location.some((all) => all.some((rule) => rule.param === "category" || rule.param === "tag")),
  );

/** Each id's category ids (with their parents') and tag ids, from the store's terms, for the ids' directly chosen terms. */
async function termsOf(
  run: Runner,
  storeId: string,
  chosen: Map<string, string[]>,
): Promise<Map<string, { categories: string[]; tags: string[] }>> {
  const out = new Map<string, { categories: string[]; tags: string[] }>();
  if ([...chosen.values()].every((ids) => ids.length === 0)) return out;
  const rows = await run.execute<Row>(
    sql`select id, parent_id, kind from commerce.terms where store_id = ${storeId}::uuid`,
  );
  const terms = rows.map((r) => ({ id: String(r.id), parentId: r.parent_id ? String(r.parent_id) : null }));
  const kind = new Map(rows.map((r) => [String(r.id), String(r.kind)]));
  for (const [id, ids] of chosen) {
    const all = withParents(ids, terms);
    out.set(id, {
      categories: all.filter((term) => kind.get(term) === "category"),
      tags: all.filter((term) => kind.get(term) === "tag"),
    });
  }
  return out;
}

/** What group rules ask about each product, from three reads for all of them (the products, their terms, the store's terms). */
async function productFactsFor(
  run: Runner,
  storeId: string,
  ids: string[],
  withTerms: boolean,
): Promise<Map<string, Facts>> {
  const products = await run.execute<Row>(sql`
    select id, kind, audience from commerce.products where store_id = ${storeId}::uuid and id in (${uuids(ids)})
  `);
  const chosen = new Map<string, string[]>(products.map((p) => [String(p.id), []]));
  if (withTerms) {
    const links = await run.execute<Row>(sql`
      select product_id, term_id from commerce.product_terms where store_id = ${storeId}::uuid and product_id in (${uuids(ids)})
    `);
    for (const link of links) chosen.get(String(link.product_id))?.push(String(link.term_id));
  }
  const terms = await termsOf(run, storeId, chosen);
  return new Map(
    products.map((p): [string, Facts] => [
      String(p.id),
      {
        entity: "product",
        kind: String(p.kind),
        audience: String(p.audience),
        categories: terms.get(String(p.id))?.categories ?? [],
        tags: terms.get(String(p.id))?.tags ?? [],
        roles: [],
      },
    ]),
  );
}

/** What group rules ask about each page or article: its published categories and tags, and the special pages it is chosen for. */
async function pageFactsFor(
  run: Runner,
  storeId: string,
  ids: string[],
  withTerms: boolean,
): Promise<Map<string, Facts>> {
  const pages = await run.execute<Row>(sql`
    select id, type, published -> 'categories' as categories, published -> 'tags' as tags
    from commerce.pages
    where store_id = ${storeId}::uuid and type in ('page', 'article') and id in (${uuids(ids)})
  `);
  const roles = await run.execute<Row>(sql`
    select page_id, role from commerce.page_roles where store_id = ${storeId}::uuid and page_id in (${uuids(ids)})
  `);
  const chosen = new Map<string, string[]>(
    pages.map((p) => [
      String(p.id),
      withTerms
        ? [...((p.categories as unknown[] | null) ?? []), ...((p.tags as unknown[] | null) ?? [])].filter(
            (id): id is string => typeof id === "string" && UUID.test(id),
          )
        : [],
    ]),
  );
  const terms = await termsOf(run, storeId, chosen);
  return new Map(
    pages.map((p): [string, Facts] => [
      String(p.id),
      {
        entity: p.type === "article" ? "article" : "page",
        categories: terms.get(String(p.id))?.categories ?? [],
        tags: terms.get(String(p.id))?.tags ?? [],
        roles: roles.filter((r) => String(r.page_id) === String(p.id)).map((r) => String(r.role)),
      },
    ]),
  );
}

/**
 * The fields a content grid's tiles show (D120): for each item (a product,
 * page or article), the public fields the grid names (`fieldIds`, at most
 * three, of a plain type) that the item has a value for, as label and words
 * in the shopper's language. Everything is read in a fixed number of queries
 * for all the items together, never one per item: the items' facts (for the
 * groups' location rules), the values of all of them, and, only when a rule
 * asks about categories or tags, the store's terms. Only the fields of active
 * groups that apply to the item (its kind, audience, categories, tags, special
 * page) and that the owner made public are read; a value is shown in its
 * language, else the main language's. An item with none is left out. Cached
 * under the store's fields tag, so a change to fields or values refreshes it.
 * `marketSlug` would only matter for relations, which tiles do not show.
 */
export async function shownFieldsForItems(
  storeId: string,
  entity: "product" | "page" | "article",
  ids: string[],
  fieldIds: string[],
  locale: string,
  lang: string,
  marketSlug: string,
): Promise<Record<string, TileField[]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(fieldsTag(storeId));
  void marketSlug;
  const wanted = [...new Set(fieldIds)].slice(0, TILE_FIELDS_MAX);
  const items = [...new Set(ids)].filter((id) => UUID.test(id));
  if (wanted.length === 0 || items.length === 0) return {};

  // The groups that could put a wanted, public field of a plain type on the item.
  const groups = (await activeFieldGroups(storeId, entity)).filter((group) =>
    group.fields.some((def) => wanted.includes(def.id) && def.access === "public" && isTileFieldType(def.type)),
  );
  if (groups.length === 0) return {};

  const run = readDb();
  const withTerms = asksAboutTerms(groups);
  const [store, facts, rows] = await Promise.all([
    run
      .execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`)
      .then(([row]) => (row ? getStore(String(row.slug)) : null)),
    entity === "product"
      ? productFactsFor(run, storeId, items, withTerms)
      : pageFactsFor(run, storeId, items, withTerms),
    run.execute<Row>(sql`
      select entity_id, locale, values from commerce.field_values
      where store_id = ${storeId}::uuid and entity = ${entity} and entity_id in (${uuids(items)})
    `),
  ]);
  const main = store?.localization.locales[0] ?? locale;

  const data = new Map<string, FieldData>();
  for (const row of rows) {
    const id = String(row.entity_id);
    const own = data.get(id) ?? { values: {}, translations: {} };
    if (row.locale === "") own.values = (row.values ?? {}) as Values;
    else own.translations[String(row.locale)] = (row.values ?? {}) as Values;
    data.set(id, own);
  }

  const m = t(lang);
  const words = { yes: m.customFields.yes, no: m.customFields.no };
  const out: Record<string, TileField[]> = {};
  for (const [id, own] of data) {
    const itemFacts = facts.get(id);
    if (!itemFacts) continue;
    const shown: ShownGroup[] = groups
      .filter((group) => groupApplies(group, itemFacts))
      .map((group) => shownGroup(group, own, locale, main, words, { publicOnly: true }));
    const lines = tileLines(shown, wanted);
    if (lines.length > 0) out[id] = lines;
  }
  return out;
}
