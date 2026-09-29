import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  fieldGroupInput,
  groupApplies,
  groupToInput,
  hasTranslations,
  type FieldData,
  type FieldGroup,
  type Values,
} from "@/lib/custom-fields";
import {
  definitionItems,
  definitionUnit,
  valueChanges,
  valueSlots,
  valueUnit,
  variantTitle,
  withDefinitionTexts,
  type ValueEntity,
  type ValueSlot,
} from "@/lib/field-translate";
import type { TranslateMode } from "@/lib/page-translate-ai";
import type { Unit } from "@/lib/store-translate";

import type { Membership } from "./auth";
import {
  getFieldGroup,
  listFieldGroups,
  pageFacts,
  productFacts,
  saveFieldData,
  storeRuleFacts,
  termRuleFacts,
  variantFacts,
} from "./custom-fields";

type Row = Record<string, unknown>;
type Entity = ValueEntity;

const ENTITIES: readonly Entity[] = ["product", "variant", "page", "article", "term", "store"];

/** What group rules ask about a thing: a page as its draft is (that is what is translated), the rest as they are. */
const factsOf = (run: Parameters<typeof productFacts>[0], storeId: string, entity: Entity, id: string) =>
  entity === "product"
    ? productFacts(run, storeId, id)
    : entity === "variant"
      ? variantFacts(run, storeId, id)
      : entity === "term"
        ? termRuleFacts(run, storeId, id)
        : entity === "store"
          ? storeRuleFacts(run, storeId, id)
          : pageFacts(run, storeId, id, "draft");

/**
 * Custom fields in the store's translation worklist (D110, D118): the words of
 * the groups' definitions and the texts entered in fields of products, pages
 * and articles (and of products' variants, of categories and tags and of the
 * store itself, D120), as
 * `src/lib/field-translate.ts` lists them. Nothing here calls
 * the model or writes before a person has ticked a suggestion:
 * `writeFieldUnit()` is what `applyTranslations()` calls for each one.
 * Definitions are written back into the group's `fields`, changing only
 * labels in the language; values are written through `saveFieldData()`, the
 * same path the editors use, so each is checked against its definition.
 */

/** Most things with values one run reads, so a large store's worklist stays quick. */
const MAX_THINGS = 2000;

const dataOf = (rows: Row[]): FieldData => {
  const data: FieldData = { values: {}, translations: {} };
  for (const row of rows) {
    const values = (row.values ?? {}) as Values;
    if (row.locale === "") data.values = values;
    else data.translations[String(row.locale)] = values;
  }
  return data;
};

type Thing = {
  entity: Entity;
  id: string;
  title: string;
  slug: string;
  /** A category's or tag's own kind, which its unit is named by. */
  termKind?: "category" | "tag";
  data: FieldData;
  slots: ValueSlot[];
};

/**
 * The things of the store that have texts in fields in the main language, with
 * the slots to translate into `to`: only from the groups that apply to each
 * thing and only public fields.
 */
async function things(
  storeId: string,
  groups: FieldGroup[],
  main: string,
  to: string,
  only?: { entity: Entity; id: string },
): Promise<Thing[]> {
  const holding = groups.filter((g) => g.fields.some((f) => f.access === "public" && hasTranslations(f)));
  if (holding.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select entity, entity_id, locale, values from commerce.field_values
    where store_id = ${storeId}::uuid and entity in ('product', 'variant', 'page', 'article', 'term', 'store') and locale in ('', ${main}, ${to})
      ${only ? sql`and entity = ${only.entity} and entity_id = ${only.id}::uuid` : sql``}
    order by entity, entity_id limit ${MAX_THINGS * 3}
  `);
  const byThing = new Map<string, { entity: Entity; id: string; rows: Row[] }>();
  for (const row of rows) {
    const key = `${row.entity}:${row.entity_id}`;
    const thing = byThing.get(key) ?? { entity: row.entity as Entity, id: String(row.entity_id), rows: [] };
    thing.rows.push(row);
    byThing.set(key, thing);
  }
  // Nothing to translate where there is no text in the main language.
  const candidates = [...byThing.values()].filter((t) => t.rows.some((r) => r.locale === main));
  const list = (ids: string[]) =>
    sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
  const products = candidates.filter((t) => t.entity === "product").map((t) => t.id);
  const variants = candidates.filter((t) => t.entity === "variant").map((t) => t.id);
  const terms = candidates.filter((t) => t.entity === "term").map((t) => t.id);
  const pages = candidates.filter((t) => t.entity === "page" || t.entity === "article").map((t) => t.id);
  const ofStore = candidates.some((t) => t.entity === "store");
  const names = new Map<string, { title: string; slug: string; termKind?: "category" | "tag" }>();
  if (products.length > 0) {
    const found = await db().execute<Row>(sql`
      select p.id, p.handle, coalesce(nullif(t.title, ''), p.handle) as title
      from commerce.products p
      left join commerce.product_translations t on t.product_id = p.id and t.locale = ${main}
      where p.store_id = ${storeId}::uuid and p.status <> 'archived' and p.id in (${list(products)})
    `);
    for (const r of found) names.set(`product:${r.id}`, { title: String(r.title), slug: String(r.handle) });
  }
  if (variants.length > 0) {
    // A variant is told apart by its product's title, its SKU and its options; only those the shop still sells.
    const found = await db().execute<Row>(sql`
      select v.id, v.sku, v.options, coalesce(nullif(t.title, ''), p.handle) as title
      from commerce.product_variants v
      join commerce.products p on p.id = v.product_id and p.store_id = v.store_id
      left join commerce.product_translations t on t.product_id = p.id and t.locale = ${main}
      where v.store_id = ${storeId}::uuid and v.active and p.status <> 'archived' and v.id in (${list(variants)})
    `);
    for (const r of found)
      names.set(`variant:${r.id}`, {
        title: variantTitle(String(r.title), String(r.sku), r.options),
        slug: String(r.sku),
      });
  }
  if (terms.length > 0) {
    const found = await db().execute<Row>(sql`
      select id, kind, name, slug from commerce.terms where store_id = ${storeId}::uuid and id in (${list(terms)})
    `);
    for (const r of found)
      names.set(`term:${r.id}`, {
        title: String(r.name),
        slug: String(r.slug),
        termKind: r.kind === "tag" ? "tag" : "category",
      });
  }
  if (ofStore) {
    // The store's own fields (D120): one unit, named by the store.
    const [row] = await db().execute<Row>(sql`select name, slug from commerce.stores where id = ${storeId}::uuid`);
    if (row) names.set(`store:${storeId}`, { title: String(row.name), slug: String(row.slug) });
  }
  if (pages.length > 0) {
    const found = await db().execute<Row>(sql`
      select id, type, slug, coalesce(nullif(draft ->> 'title', ''), slug) as title from commerce.pages
      where store_id = ${storeId}::uuid and type in ('page', 'article') and id in (${list(pages)})
    `);
    for (const r of found) names.set(`${r.type}:${r.id}`, { title: String(r.title), slug: String(r.slug) });
  }

  const out: Thing[] = [];
  for (const candidate of candidates.slice(0, MAX_THINGS)) {
    const name = names.get(`${candidate.entity}:${candidate.id}`);
    if (!name) continue;
    const facts = await factsOf(db(), storeId, candidate.entity, candidate.id);
    if (!facts) continue;
    const data = dataOf(candidate.rows);
    const slots = holding.filter((g) => groupApplies(g, facts)).flatMap((g) => valueSlots(g.fields, data, main, to));
    out.push({ entity: candidate.entity, id: candidate.id, ...name, data, slots });
  }
  return out;
}

/** What custom fields have to translate into `to`: the labels of each group, then the texts of each thing. */
export async function fieldWork(storeId: string, main: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const groups = (await listFieldGroups(storeId)).filter((g) => g.active);
  const definitions = groups.flatMap((g) => definitionUnit(g, to, mode) ?? []);
  const values = (await things(storeId, groups, main, to)).flatMap(
    (t) => valueUnit(t.entity, t.id, t.title, t.slug, t.slots, mode, t.termKind) ?? [],
  );
  return [...definitions, ...values];
}

/**
 * Writes what staff accepted for one unit of custom fields, in language `to`.
 * Returns true, or why it could not be saved.
 */
export async function writeFieldUnit(
  { store }: Pick<Membership, "store">,
  unitId: string,
  to: string,
  done: Record<string, string | string[]>,
): Promise<true | string> {
  const [kind, first, second] = unitId.split(":");
  const main = store.localization.locales[0];
  if (kind === "fielddef") return writeDefinitions(store.id, first, to, done);
  if (kind !== "fieldval" || !ENTITIES.includes(first as Entity) || !second)
    return "That is not something to translate.";
  const entity = first as Entity;

  const groups = (await listFieldGroups(store.id)).filter((g) => g.active);
  const [thing] = await things(store.id, groups, main, to, { entity, id: second });
  if (!thing) return "It is gone, or has no texts in the main language.";
  const { changes, count } = valueChanges(thing.slots, thing.data, main, to, done);
  if (count === 0) return "Nothing usable to save.";
  const problems = await db().transaction(async (tx) => {
    // Read in the transaction that writes, so the groups that apply are those of the thing as it is when saved.
    const facts = await factsOf(tx, store.id, entity, second);
    if (!facts) return ["It is gone."];
    return saveFieldData(tx, store.id, entity, second, changes, {
      facts,
      locales: store.localization.locales,
      main,
      requireAll: false,
    });
  });
  return problems.length > 0 ? problems[0] : true;
}

/** Puts translated labels into a group's `fields`, changing nothing else, and only when the whole group still passes its own checks. */
async function writeDefinitions(
  storeId: string,
  groupId: string,
  to: string,
  done: Record<string, string | string[]>,
): Promise<true | string> {
  const group = await getFieldGroup(storeId, groupId);
  if (!group) return "The group is gone.";
  // Only labels the group has, in the length a label can be.
  const asked = new Set(definitionItems(group, to, "all").map((item) => item.key));
  const accepted = Object.fromEntries(Object.entries(done).filter(([key]) => asked.has(key)));
  if (Object.keys(accepted).length === 0) return "Nothing usable to save.";
  const fields = withDefinitionTexts(group.fields, to, accepted);
  const checked = fieldGroupInput.safeParse({ ...groupToInput(group), fields });
  if (!checked.success) return checked.error.issues[0]?.message ?? "The group could not be checked.";
  await db().execute(sql`
    update commerce.field_groups set fields = ${JSON.stringify(fields)}::jsonb, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${groupId}::uuid
  `);
  return true;
}
