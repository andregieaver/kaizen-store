import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  EMPTY_DATA,
  EMPTY_LOOKUPS,
  MAX_LOOKUPS,
  needsLookups,
  subFieldsOf,
  holdsMoney,
  moneyProblems,
  tidyFlexible,
  type FieldChanges,
  type FieldFile,
  type FieldLink,
  type FieldLookups,
  type ShownField,
  MAX_FIELD_GROUPS,
  applyChanges,
  exportGroups,
  fieldGroupInput,
  groupApplies,
  importGroups,
  isFieldEntity,
  isStaffEntity,
  isTranslatable,
  parseFieldChanges,
  requiredProblems,
  shownGroup,
  staffGroupProblem,
  type Facts,
  type FieldData,
  type FieldDef,
  type FieldEntity,
  type FieldGroup,
  type FieldValue,
  type Values,
  type ShownGroup,
  type FieldWords,
} from "@/lib/custom-fields";
import { moneyCurrencies, shownMoney } from "@/lib/field-money";
import { usesSearch } from "@/lib/field-search";
import { t } from "@/lib/i18n";
import type { PageContent } from "@/lib/page-content";
import { marketPath } from "@/lib/paths";

import { audit, type Membership } from "./auth";
import { isOwnFieldFile } from "./media";
import { pgUuidArray } from "./pg-arrays";
import type { SaveResult } from "./settings";
import { refreshFieldSearch, refreshStoreFieldSearch } from "./field-search";
import { marketIn } from "./shop";
import { getStore, storeTag } from "./stores";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Custom fields (D118, `src/lib/custom-fields.ts`): a store's groups of
 * fields and what was entered in them for its products, pages and articles.
 * Definitions and values are read for the storefront through `'use cache'`
 * under one tag, refreshed whenever a group or a thing's values change.
 */

export const fieldsTag = (storeId: string) => `fields:${storeId}`;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function toGroup(row: Row): FieldGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    entities: (row.entities as FieldEntity[]).filter(isFieldEntity),
    location: row.location as FieldGroup["location"],
    fields: row.fields as FieldDef[],
    position: row.position === "side" ? "side" : "main",
    active: Boolean(row.active),
    sort: Number(row.sort),
  };
}

/** A store's groups in the owner's order, for the admin (never cached). */
export async function listFieldGroups(storeId: string): Promise<FieldGroup[]> {
  const rows = await db().execute<Row>(sql`
    select * from commerce.field_groups where store_id = ${storeId}::uuid order by sort, created_at
  `);
  return rows.map(toGroup);
}

export async function getFieldGroup(storeId: string, id: string): Promise<FieldGroup | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.field_groups where store_id = ${storeId}::uuid and id = ${id}::uuid
  `);
  return row ? toGroup(row) : null;
}

/** The active groups of a store that can be on a kind of thing, for editors and the site (cached). */
export async function activeFieldGroups(storeId: string, entity: FieldEntity): Promise<FieldGroup[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(fieldsTag(storeId));
  const rows = await readDb().execute<Row>(sql`
    select * from commerce.field_groups
    where store_id = ${storeId}::uuid and active and entities ? ${entity}
    order by sort, created_at
  `);
  return rows.map(toGroup);
}

/** The active groups of a store on any kind of thing, for the page builder's field components. */
export async function allActiveFieldGroups(storeId: string): Promise<FieldGroup[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(fieldsTag(storeId));
  const rows = await readDb().execute<Row>(sql`
    select * from commerce.field_groups
    where store_id = ${storeId}::uuid and active and not (entities ?| array['customer', 'order'])
    order by sort, created_at
  `);
  return rows.map(toGroup);
}

/**
 * Creates (id null) or changes a group. What is entered in the fields is
 * kept under their ids, so renaming a field or a group loses nothing;
 * fields taken out of a group have their values taken away.
 */
export async function saveFieldGroup(
  { account, store }: Membership,
  input: unknown,
): Promise<SaveResult & { id?: string }> {
  const parsed = fieldGroupInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const g = parsed.data;

  const [taken] = await db().execute<Row>(sql`
    select id from commerce.field_groups
    where store_id = ${store.id}::uuid and slug = ${g.slug} and (${g.id}::uuid is null or id <> ${g.id}::uuid)
  `);
  if (taken) return { ok: false, problems: [`Another group already has the web name ${g.slug}.`] };

  let id = g.id;
  let searchedBefore = false;
  if (id) {
    const before = await getFieldGroup(store.id, id);
    if (!before) return { ok: false, problems: ["The group no longer exists."] };
    searchedBefore = usesSearch(before);
    await db().execute(sql`
      update commerce.field_groups set
        name = ${g.name}, slug = ${g.slug}, entities = ${JSON.stringify(g.entities)}::jsonb,
        location = ${JSON.stringify(g.location)}::jsonb, fields = ${JSON.stringify(g.fields)}::jsonb,
        position = ${g.position}, active = ${g.active}, updated_at = now()
      where store_id = ${store.id}::uuid and id = ${id}::uuid
    `);
    const kept = new Set(g.fields.map((f) => f.id));
    const gone = before.fields.map((f) => f.id).filter((fieldId) => !kept.has(fieldId));
    if (gone.length > 0) await removeFieldValues(store.id, gone);
  } else {
    const [count] = await db().execute<Row>(
      sql`select count(*)::int as n, coalesce(max(sort), 0) + 1 as next from commerce.field_groups where store_id = ${store.id}::uuid`,
    );
    if (Number(count.n) >= MAX_FIELD_GROUPS)
      return { ok: false, problems: [`A store can have at most ${MAX_FIELD_GROUPS} groups of custom fields.`] };
    const [row] = await db().execute<Row>(sql`
      insert into commerce.field_groups (store_id, name, slug, entities, location, fields, position, active, sort)
      values (${store.id}::uuid, ${g.name}, ${g.slug}, ${JSON.stringify(g.entities)}::jsonb, ${JSON.stringify(g.location)}::jsonb,
        ${JSON.stringify(g.fields)}::jsonb, ${g.position}, ${g.active}, ${Number(count.next)})
      returning id
    `);
    id = String(row.id);
  }
  // Keyword search reads fields flagged for it: the store's search texts follow a change to such a group.
  if (searchedBefore || usesSearch(g)) await refreshStoreFieldSearch(store.id);
  await audit(account.id, store.id, g.id ? "field_group.updated" : "field_group.created", { name: g.name });
  return { ok: true, id };
}

/** Deletes a group and what was entered in its fields. */
export async function deleteFieldGroup({ account, store }: Membership, id: string): Promise<SaveResult> {
  const current = await getFieldGroup(store.id, id);
  if (!current) return { ok: true };
  await db().execute(sql`delete from commerce.field_groups where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await removeFieldValues(
    store.id,
    current.fields.map((f) => f.id),
  );
  if (usesSearch(current)) await refreshStoreFieldSearch(store.id);
  await audit(account.id, store.id, "field_group.deleted", { name: current.name });
  return { ok: true };
}

/** Switches a group on or off, keeping the rest. */
export async function setFieldGroupActive(
  { account, store }: Membership,
  id: string,
  active: boolean,
): Promise<SaveResult> {
  const rows = await db().execute<Row>(sql`
    update commerce.field_groups set active = ${active}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${id}::uuid returning name, fields
  `);
  if (rows.length === 0) return { ok: false, problems: ["The group no longer exists."] };
  if (usesSearch({ fields: rows[0].fields as FieldDef[] })) await refreshStoreFieldSearch(store.id);
  await audit(account.id, store.id, active ? "field_group.switched_on" : "field_group.switched_off", {
    name: String(rows[0].name),
  });
  return { ok: true };
}

/** Puts the groups in the order given (ids not named keep their place after them). */
export async function orderFieldGroups({ store }: Membership, ids: string[]): Promise<SaveResult> {
  const known = new Set((await listFieldGroups(store.id)).map((g) => g.id));
  const order = ids.filter((id) => known.has(id));
  for (const [index, id] of order.entries()) {
    await db().execute(
      sql`update commerce.field_groups set sort = ${index} where store_id = ${store.id}::uuid and id = ${id}::uuid`,
    );
  }
  return { ok: true };
}

/** The store's groups as a file to keep or move to another store. */
export async function exportFieldGroups(storeId: string, ids?: string[]) {
  const groups = await listFieldGroups(storeId);
  return exportGroups(ids ? groups.filter((g) => ids.includes(g.id)) : groups);
}

/** Adds the groups in a file, as new groups of this store. */
export async function importFieldGroups(member: Membership, raw: unknown): Promise<SaveResult & { ids?: string[] }> {
  const existing = await listFieldGroups(member.store.id);
  const parsed = importGroups(
    raw,
    existing.map((g) => g.slug),
  );
  if (!parsed.ok) return { ok: false, problems: [parsed.problem] };
  if (existing.length + parsed.groups.length > MAX_FIELD_GROUPS) {
    return { ok: false, problems: [`A store can have at most ${MAX_FIELD_GROUPS} groups of custom fields.`] };
  }
  const ids: string[] = [];
  for (const group of parsed.groups) {
    const saved = await saveFieldGroup(member, group);
    if (!saved.ok) return saved;
    if (saved.id) ids.push(saved.id);
  }
  return { ok: true, ids };
}

/** Takes what was entered in these fields away from every thing of the store. */
async function removeFieldValues(storeId: string, fieldIds: string[]): Promise<void> {
  if (fieldIds.length === 0) return;
  const ids = sql`array[${sql.join(
    fieldIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  await db().execute(
    sql`update commerce.field_values set values = values - ${ids}, updated_at = now() where store_id = ${storeId}::uuid`,
  );
  await db().execute(sql`delete from commerce.field_values where store_id = ${storeId}::uuid and values = '{}'::jsonb`);
}

// ---------------------------------------------------------------------------
// What a thing has: which groups apply
// ---------------------------------------------------------------------------

/** Term ids with their parents, split into categories and tags. */
async function termFacts(
  run: Runner,
  storeId: string,
  ids: string[],
): Promise<{ categories: string[]; tags: string[] }> {
  if (ids.length === 0) return { categories: [], tags: [] };
  const rows = await run.execute<Row>(sql`
    with recursive up as (
      select id, parent_id, kind from commerce.terms
      where store_id = ${storeId}::uuid and id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      union
      select t.id, t.parent_id, t.kind from commerce.terms t join up on up.parent_id = t.id where t.store_id = ${storeId}::uuid
    )
    select id, kind from up
  `);
  return {
    categories: rows.filter((r) => r.kind === "category").map((r) => String(r.id)),
    tags: rows.filter((r) => r.kind === "tag").map((r) => String(r.id)),
  };
}

/** What group rules ask about a product, as it is now in the database. */
export async function productFacts(run: Runner, storeId: string, productId: string): Promise<Facts | null> {
  const [product] = await run.execute<Row>(sql`
    select kind, audience from commerce.products where store_id = ${storeId}::uuid and id = ${productId}::uuid
  `);
  if (!product) return null;
  const terms = await run.execute<Row>(sql`
    select term_id from commerce.product_terms where store_id = ${storeId}::uuid and product_id = ${productId}::uuid
  `);
  const { categories, tags } = await termFacts(
    run,
    storeId,
    terms.map((r) => String(r.term_id)),
  );
  return {
    entity: "product",
    kind: String(product.kind),
    audience: String(product.audience),
    categories,
    tags,
    roles: [],
  };
}

/** What group rules ask about a variant: what its product is and where it is listed. */
export async function variantFacts(run: Runner, storeId: string, variantId: string): Promise<Facts | null> {
  const [row] = await run.execute<Row>(sql`
    select product_id from commerce.product_variants where store_id = ${storeId}::uuid and id = ${variantId}::uuid
  `);
  if (!row) return null;
  const facts = await productFacts(run, storeId, String(row.product_id));
  return facts && { ...facts, entity: "variant" };
}

/** What group rules ask about a category or tag: which it is, and what it sorts. */
export async function termRuleFacts(run: Runner, storeId: string, termId: string): Promise<Facts | null> {
  const [row] = await run.execute<Row>(sql`
    select kind, content_type from commerce.terms where store_id = ${storeId}::uuid and id = ${termId}::uuid
  `);
  if (!row) return null;
  return { entity: "term", termKind: String(row.kind), content: String(row.content_type), categories: [], tags: [], roles: [] };
}

/** The store's own fields (D120): one set for the whole store, keyed by the store's id, with nothing for rules to ask about. */
export async function storeRuleFacts(run: Runner, storeId: string, id: string): Promise<Facts | null> {
  if (id !== storeId) return null;
  const [row] = await run.execute<Row>(sql`select id from commerce.stores where id = ${storeId}::uuid`);
  return row ? { entity: "store", categories: [], tags: [], roles: [] } : null;
}

/** A customer's or an order's fields (D120, staff only): the thing must be the store's own; there are no rules to ask about. */
export async function staffRuleFacts(run: Runner, storeId: string, entity: "customer" | "order", id: string): Promise<Facts | null> {
  const [row] = await run.execute<Row>(
    entity === "customer"
      ? sql`select id from commerce.customers where store_id = ${storeId}::uuid and id = ${id}::uuid`
      : sql`select id from commerce.orders where store_id = ${storeId}::uuid and id = ${id}::uuid`,
  );
  return row ? { entity, categories: [], tags: [], roles: [] } : null;
}

/** What group rules ask about a thing of any kind, as it is now in the database. */
export function factsFor(run: Runner, storeId: string, entity: FieldEntity, id: string): Promise<Facts | null> {
  if (entity === "product") return productFacts(run, storeId, id);
  if (entity === "variant") return variantFacts(run, storeId, id);
  if (entity === "term") return termRuleFacts(run, storeId, id);
  if (entity === "store") return storeRuleFacts(run, storeId, id);
  if (entity === "customer" || entity === "order") return staffRuleFacts(run, storeId, entity, id);
  return pageFacts(run, storeId, id);
}

/** What group rules ask about a page or article: its categories and tags (from its draft or its published content) and the special pages it is chosen for. */
export async function pageFacts(
  run: Runner,
  storeId: string,
  pageId: string,
  source: "draft" | "published" = "published",
): Promise<Facts | null> {
  const [page] = await run.execute<Row>(sql`
    select type, ${sql.raw(source)} as content from commerce.pages where store_id = ${storeId}::uuid and id = ${pageId}::uuid
  `);
  if (!page || (page.type !== "page" && page.type !== "article")) return null;
  const content = (page.content ?? {}) as Partial<Pick<PageContent, "categories" | "tags">>;
  const ids = [...(content.categories ?? []), ...(content.tags ?? [])].filter(
    (id): id is string => typeof id === "string",
  );
  const { categories, tags } = await termFacts(run, storeId, ids);
  const roles = await run.execute<Row>(
    sql`select role from commerce.page_roles where store_id = ${storeId}::uuid and page_id = ${pageId}::uuid`,
  );
  return { entity: page.type, categories, tags, roles: roles.map((r) => String(r.role)) };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** What was entered for a thing, in every language. */
export async function getFieldData(
  storeId: string,
  entity: FieldEntity,
  entityId: string,
  run: Runner = db(),
): Promise<FieldData> {
  const rows = await run.execute<Row>(sql`
    select locale, values from commerce.field_values
    where store_id = ${storeId}::uuid and entity = ${entity} and entity_id = ${entityId}::uuid
  `);
  const data: FieldData = { values: {}, translations: {} };
  for (const row of rows) {
    const values = (row.values ?? {}) as Values;
    if (row.locale === "") data.values = values;
    else data.translations[String(row.locale)] = values;
  }
  return data;
}

/**
 * What was entered for many things of one kind at once, in every language, by the thing's id: ONE query, for the exports (D165) that would
 * otherwise ask once for each of thousands. Things with nothing entered are absent. Every query carries the store id.
 */
export async function getFieldDataMany(
  storeId: string,
  entity: FieldEntity,
  entityIds: readonly string[],
  run: Runner = db(),
): Promise<Map<string, FieldData>> {
  const out = new Map<string, FieldData>();
  if (entityIds.length === 0) return out;
  const rows = await run.execute<Row>(sql`
    select entity_id, locale, values from commerce.field_values
    where store_id = ${storeId}::uuid and entity = ${entity} and entity_id = any(${pgUuidArray(entityIds)}::uuid[])
  `);
  for (const row of rows) {
    const id = String(row.entity_id);
    const own = out.get(id) ?? { values: {}, translations: {} };
    const values = (row.values ?? {}) as Values;
    if (row.locale === "") own.values = values;
    else own.translations[String(row.locale)] = values;
    out.set(id, own);
  }
  return out;
}

/**
 * Writes what an editor sent for a thing, within the caller's transaction:
 * only the fields of the groups that apply to it (`facts`) are taken, each
 * checked against its definition; what was not sent is left as it was.
 * Required fields are asked for when `requireAll` (a product saved as active).
 * Returns the problems, or none once written.
 */
export async function saveFieldData(
  run: Runner,
  storeId: string,
  entity: FieldEntity,
  entityId: string,
  raw: unknown,
  options: { facts: Facts; locales: readonly string[]; main: string; requireAll: boolean },
): Promise<string[]> {
  const problems = await writeFieldData(run, storeId, entity, entityId, raw, options);
  // Keyword search reads a product's public fields (D118): its search texts are made again in the same transaction.
  if (problems.length === 0 && entity === "product") await refreshFieldSearch(run, storeId, entityId, options);
  return problems;
}

async function writeFieldData(
  run: Runner,
  storeId: string,
  entity: FieldEntity,
  entityId: string,
  raw: unknown,
  options: { facts: Facts; locales: readonly string[]; main: string; requireAll: boolean },
): Promise<string[]> {
  if (raw === undefined || raw === null) return [];
  // A customer's or an order's groups are for staff alone: one that somehow holds anything else or a public field is not used.
  const groups = (await activeFieldGroups(storeId, entity)).filter(
    (g) => groupApplies(g, options.facts) && (!isStaffEntity(entity) || staffGroupProblem(g) === null),
  );
  const defs = groups.flatMap((g) => g.fields);
  if (defs.length === 0) return [];

  const { changes, problems } = parseFieldChanges(defs, raw, options.locales, options.main);
  if (problems.length > 0) return problems;
  // Money is in a currency the store offers (D120).
  if (defs.some(holdsMoney)) {
    const offered = await offeredCurrencies(storeId);
    const wrong = moneyProblems(defs, changes, offered);
    if (wrong.length > 0) return wrong;
  }
  await keepOwnRelations(run, storeId, defs, changes);

  const existing = await getFieldData(storeId, entity, entityId, run);
  // Rows of a layout that flexible content no longer has go with it, and so do the words written for them.
  const next = tidyFlexible(defs, applyChanges(existing, changes));
  if (options.requireAll) {
    const missing = groups.flatMap((g) => requiredProblems(g.fields, next, options.main));
    if (missing.length > 0) return missing;
  }

  const write = async (locale: string, values: Values) => {
    if (Object.keys(values).length === 0) {
      await run.execute(sql`
        delete from commerce.field_values
        where store_id = ${storeId}::uuid and entity = ${entity} and entity_id = ${entityId}::uuid and locale = ${locale}
      `);
      return;
    }
    await run.execute(sql`
      insert into commerce.field_values (store_id, entity, entity_id, locale, values)
      values (${storeId}::uuid, ${entity}, ${entityId}::uuid, ${locale}, ${JSON.stringify(values)}::jsonb)
      on conflict (store_id, entity, entity_id, locale) do update set values = excluded.values, updated_at = now()
    `);
  };
  await write("", next.values);
  for (const locale of new Set([...Object.keys(existing.translations), ...Object.keys(next.translations)])) {
    await write(locale, next.translations[locale] ?? {});
  }
  return [];
}

/**
 * Saves what an editor entered in a category's or tag's fields (D118). The
 * term must be the store's own; only the fields of the groups that apply to
 * it are taken. Returns the problems, or none once written.
 */
export async function saveTermFields({ account, store }: Membership, termId: string, raw: unknown): Promise<SaveResult> {
  const problems = await db().transaction(async (tx) => {
    const facts = await termRuleFacts(tx, store.id, termId);
    if (!facts) return ["The category or tag no longer exists."];
    return saveFieldData(tx, store.id, "term", termId, raw, {
      facts,
      locales: store.localization.locales,
      main: store.localization.locales[0],
      requireAll: true,
    });
  });
  if (problems.length > 0) return { ok: false, problems };
  await audit(account.id, store.id, "term.fields_updated", { term: termId });
  return { ok: true };
}

/** The currencies a store offers for money fields, its main one first (`store.localization`, D109). */
async function offeredCurrencies(storeId: string, run: Runner = db()): Promise<string[]> {
  const [row] = await run.execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = row ? await getStore(String(row.slug)) : null;
  return store ? moneyCurrencies(store) : [];
}

/** Ids of the store's own things that a value points at, by kind of field, for the field types that point at some. */
function pointsAt(def: FieldDef, value: FieldValue | null | undefined, into: { product: Set<string>; page: Set<string>; term: Set<string> }): void {
  if (value === null || value === undefined) return;
  const add = (set: Set<string>, v: unknown) => {
    if (typeof v === "string") set.add(v);
    else if (Array.isArray(v)) for (const item of v) if (typeof item === "string") set.add(item);
  };
  if (def.type === "product") add(into.product, value);
  else if (def.type === "page") add(into.page, value);
  else if (def.type === "term") add(into.term, value);
  else if (def.type === "link") {
    const link = value as FieldLink;
    if (link.kind === "product") into.product.add(link.ref);
    else if (link.kind === "page") into.page.add(link.ref);
    else if (link.kind === "category" || link.kind === "tag") into.term.add(link.ref);
  } else if (def.type === "group") {
    for (const sub of subFieldsOf(def)) pointsAt(sub, (value as Values)[sub.id], into);
  } else if (def.type === "repeater" || def.type === "flexible") {
    // Rows as they are kept shared (a list), or a language's words by row id (an object). A flexible row's cells are
    // found by id among all its layouts' fields (ids are unique in a group), so each is checked as its own field.
    const rows = Array.isArray(value) ? (value as Values[]) : Object.values(value as unknown as Record<string, Values>);
    for (const row of rows) for (const sub of subFieldsOf(def)) pointsAt(sub, row[sub.id], into);
  }
}

/** Takes out of a change what points at something that is not the store's (a product of another store, a deleted page): it would show nothing, and must not leak a name. */
async function keepOwnRelations(run: Runner, storeId: string, defs: FieldDef[], changes: FieldChanges): Promise<void> {
  const wanted = { product: new Set<string>(), page: new Set<string>(), term: new Set<string>() };
  const slots: [FieldDef, Record<string, FieldValue | null>][] = [];
  for (const def of defs) {
    slots.push([def, changes.values]);
    for (const own of Object.values(changes.translations)) slots.push([def, own]);
  }
  for (const [def, values] of slots) pointsAt(def, values[def.id], wanted);
  const holdsFile = (def: FieldDef): boolean => def.type === "file" || subFieldsOf(def).some(holdsFile);
  if (wanted.product.size + wanted.page.size + wanted.term.size === 0 && !defs.some(holdsFile)) return;
  const known = async (table: "products" | "pages" | "terms", ids: Set<string>) => {
    if (ids.size === 0) return new Set<string>();
    const list = sql.join([...ids].map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await run.execute<Row>(sql`select id from ${sql.raw(`commerce.${table}`)} where store_id = ${storeId}::uuid and id in (${list})`);
    return new Set(rows.map((r) => String(r.id)));
  };
  const own = { product: await known("products", wanted.product), page: await known("pages", wanted.page), term: await known("terms", wanted.term) };
  const ok = (kind: "product" | "page" | "term", id: unknown) => typeof id === "string" && own[kind].has(id);

  const clean = (def: FieldDef, value: FieldValue | null | undefined): FieldValue | null | undefined => {
    if (value === null || value === undefined) return value;
    if (def.type === "product" || def.type === "page" || def.type === "term") {
      const kind = def.type;
      if (Array.isArray(value)) {
        const kept = (value as string[]).filter((id) => ok(kind, id));
        return kept.length > 0 ? kept : null;
      }
      return ok(kind, value) ? value : null;
    }
    // A file must be one kept for this store: an address into another store's folder, or anywhere else, is not.
    if (def.type === "file") return isOwnFieldFile(storeId, (value as FieldFile).url) ? value : null;
    if (def.type === "link") {
      const link = value as FieldLink;
      const kind = link.kind === "product" ? "product" : link.kind === "page" ? "page" : link.kind === "url" ? null : "term";
      return kind === null || ok(kind, link.ref) ? value : null;
    }
    if (def.type === "group") {
      const cells: Values = {};
      for (const sub of subFieldsOf(def)) {
        const kept = clean(sub, (value as Values)[sub.id]);
        if (kept !== null && kept !== undefined) cells[sub.id] = kept;
      }
      return Object.keys(cells).length > 0 ? cells : null;
    }
    if (def.type === "repeater" || def.type === "flexible") {
      // Rows keep their place, id (and layout); only what they point at can go.
      const cleanRow = (row: Values): Values => {
        const next: Values = {};
        if (row.id !== undefined) next.id = row.id;
        if (row.layout !== undefined) next.layout = row.layout;
        for (const id of Object.keys(row)) {
          if (id === "id" || id === "layout") continue;
          const sub = subFieldsOf(def).find((f) => f.id === id);
          const kept = sub ? clean(sub, row[id]) : row[id];
          if (kept !== null && kept !== undefined) next[id] = kept;
        }
        return next;
      };
      if (Array.isArray(value)) return (value as Values[]).map(cleanRow);
      const words: Record<string, Values> = {};
      for (const [rowId, row] of Object.entries(value as unknown as Record<string, Values>)) {
        const cleaned = cleanRow(row);
        if (Object.keys(cleaned).length > 0) words[rowId] = cleaned;
      }
      return Object.keys(words).length > 0 ? (words as unknown as Values) : null;
    }
    return value;
  };
  for (const def of defs) {
    for (const values of [changes.values, ...Object.values(changes.translations)]) {
      if (Object.hasOwn(values, def.id)) {
        const kept = clean(def, values[def.id]);
        values[def.id] = kept === undefined ? null : kept;
      }
    }
  }
}

/**
 * The editor's view of a thing's fields: every active group that could be on
 * the kind of thing (the editor works out which apply as the thing changes),
 * and what was entered.
 */
export async function fieldsForEditor(
  storeId: string,
  entity: FieldEntity,
  entityId: string | null,
): Promise<{ groups: FieldGroup[]; data: FieldData; lookups: FieldLookups; variants: VariantFields | null }> {
  const [groups, data, variants] = await Promise.all([
    activeFieldGroups(storeId, entity),
    entityId ? getFieldData(storeId, entity, entityId) : Promise.resolve(EMPTY_DATA),
    // A product's editor also holds its variants' fields, kept by variant.
    entity === "product" ? variantFieldsForEditor(storeId, entityId) : Promise.resolve(null),
  ]);
  const points = needsLookups(groups) || (variants !== null && needsLookups(variants.groups));
  return { groups, data, lookups: points ? await fieldLookups(storeId) : EMPTY_LOOKUPS, variants };
}

/** A product's variants' fields for its editor: the groups that can be on a variant, and what was entered for each variant. */
export type VariantFields = { groups: FieldGroup[]; data: Record<string, FieldData> };

async function variantFieldsForEditor(storeId: string, productId: string | null): Promise<VariantFields | null> {
  const groups = await activeFieldGroups(storeId, "variant");
  if (groups.length === 0) return null;
  return { groups, data: productId ? await getVariantFieldData(storeId, productId) : {} };
}

/** What was entered for each of a product's variants, in every language, by variant id. */
export async function getVariantFieldData(storeId: string, productId: string, run: Runner = db()): Promise<Record<string, FieldData>> {
  const rows = await run.execute<Row>(sql`
    select fv.entity_id, fv.locale, fv.values
    from commerce.field_values fv
    join commerce.product_variants v on v.id = fv.entity_id
    where fv.store_id = ${storeId}::uuid and fv.entity = 'variant' and v.product_id = ${productId}::uuid
  `);
  const out: Record<string, FieldData> = {};
  for (const row of rows) {
    const id = String(row.entity_id);
    const own = (out[id] ??= { values: {}, translations: {} });
    if (row.locale === "") own.values = (row.values ?? {}) as Values;
    else own.translations[String(row.locale)] = (row.values ?? {}) as Values;
  }
  return out;
}

/** A category's or tag's fields for its editor: the groups that apply to it, what was entered, and what fields can point at. */
export type TermFieldsEditor = { groups: FieldGroup[]; data: FieldData; lookups: FieldLookups };

/** The fields of one of the store's own categories or tags, or null when it is not the store's. */
export async function termFieldsForEditor(storeId: string, termId: string): Promise<TermFieldsEditor | null> {
  const facts = await termRuleFacts(db(), storeId, termId);
  if (!facts) return null;
  const { groups, data, lookups } = await fieldsForEditor(storeId, "term", termId);
  return { groups: groups.filter((g) => groupApplies(g, facts)), data, lookups };
}

/** The store's products, published pages and articles, and categories and tags an editor can choose from (the first of each, by name). */
export async function fieldLookups(storeId: string): Promise<FieldLookups> {
  const run = db();
  const [currencies, products, pages, terms] = await Promise.all([
    offeredCurrencies(storeId, run),
    run.execute<Row>(sql`
      select p.id, coalesce((select title from commerce.product_translations where product_id = p.id order by locale limit 1), p.handle) as title
      from commerce.products p where p.store_id = ${storeId}::uuid and p.status <> 'archived'
      order by title limit ${MAX_LOOKUPS}
    `),
    run.execute<Row>(sql`
      select id, type, coalesce(nullif(published ->> 'title', ''), slug) as title
      from commerce.pages where store_id = ${storeId}::uuid and published_at is not null and type in ('page', 'article')
      order by title limit ${MAX_LOOKUPS}
    `),
    run.execute<Row>(sql`
      select id, kind, name from commerce.terms where store_id = ${storeId}::uuid order by kind, name limit ${MAX_LOOKUPS}
    `),
  ]);
  return {
    products: products.map((r) => ({ id: String(r.id), title: String(r.title) })),
    pages: pages.map((r) => ({ id: String(r.id), title: String(r.title), type: r.type === "article" ? "article" : "page" })),
    terms: terms.map((r) => ({ id: String(r.id), name: String(r.name), kind: r.kind === "tag" ? "tag" : "category" })),
    currencies,
  };
}

// ---------------------------------------------------------------------------
// On the site
// ---------------------------------------------------------------------------

/**
 * What values are worded with for a shopper (D120): yes and no in their language, and money in
 * their market's currency at the store's rates (`shown()`'s conversion, between any two currencies
 * the store has a rate for; in its own currency when it has none), never with a VAT label.
 */
function fieldWords(store: Awaited<ReturnType<typeof getStore>>, marketSlug: string, locale: string, lang: string): FieldWords {
  const m = t(lang);
  const market = store ? marketIn(store, marketSlug) : undefined;
  return {
    yes: m.customFields.yes,
    no: m.customFields.no,
    money: (value) => shownMoney(value, locale, store && market ? { currency: market.currency, rates: store.localization.rates } : undefined),
  };
}

/**
 * The public fields of a product, page or article, in the shopper's language,
 * by group: those of groups that apply to it, with a value and not hidden by
 * their logic. Cached under the store's fields tag. `lang` says yes and no.
 */
export async function shownFieldsFor(
  storeId: string,
  entity: FieldEntity,
  entityId: string,
  locale: string,
  lang: string,
  marketSlug: string,
): Promise<ShownGroup[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(fieldsTag(storeId));
  // A customer's or an order's fields (D120) are for staff alone, whatever the data says.
  if (isStaffEntity(entity)) return [];
  // The store's own fields are the store's, under its own id.
  if (entity === "store" && entityId !== storeId) return [];
  const groups = (await activeFieldGroups(storeId, entity)).filter((g) => !g.entities.some(isStaffEntity));
  if (groups.length === 0) return [];
  const run = readDb();
  const [slug] = await run.execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = slug ? await getStore(String(slug.slug)) : null;
  // Money is shown at the store's rates: a change to its currencies refreshes it.
  if (store) cacheTag(storeTag(store.slug));
  const main = store?.localization.locales[0] ?? locale;
  const facts = await factsFor(run, storeId, entity, entityId);
  if (!facts) return [];
  const applying = groups.filter((g) => groupApplies(g, facts) && g.fields.some((f) => f.access === "public"));
  if (applying.length === 0) return [];
  const data = await getFieldData(storeId, entity, entityId, run);
  const words = fieldWords(store, marketSlug, locale, lang);
  const shown = applying.map((g) => shownGroup(g, data, locale, main, words, { publicOnly: true }));
  if (store) await resolveRelations(run, storeId, store.slug, marketSlug, locale, shown);
  return shown.filter((g) => g.fields.length > 0);
}

/**
 * The public fields of a product's variants, by variant: read together for the
 * product's page (one read of the values for all of them), in the shopper's
 * language. A variant with nothing to show is left out. Cached under the
 * store's fields tag.
 */
export async function shownFieldsForVariants(
  storeId: string,
  productId: string,
  locale: string,
  lang: string,
  marketSlug: string,
): Promise<Record<string, ShownGroup[]>> {
  "use cache";
  cacheLife("hours");
  cacheTag(fieldsTag(storeId));
  const groups = await activeFieldGroups(storeId, "variant");
  if (groups.length === 0) return {};
  const run = readDb();
  const facts = await productFacts(run, storeId, productId);
  if (!facts) return {};
  const applying = groups.filter((g) => groupApplies(g, { ...facts, entity: "variant" }) && g.fields.some((f) => f.access === "public"));
  if (applying.length === 0) return {};
  const [slug] = await run.execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = slug ? await getStore(String(slug.slug)) : null;
  if (store) cacheTag(storeTag(store.slug));
  const main = store?.localization.locales[0] ?? locale;
  const rows = await run.execute<Row>(sql`
    select fv.entity_id, fv.locale, fv.values
    from commerce.field_values fv
    join commerce.product_variants v on v.id = fv.entity_id
    where fv.store_id = ${storeId}::uuid and fv.entity = 'variant' and v.product_id = ${productId}::uuid and v.active
  `);
  const data = new Map<string, FieldData>();
  for (const row of rows) {
    const id = String(row.entity_id);
    const own = data.get(id) ?? { values: {}, translations: {} };
    if (row.locale === "") own.values = (row.values ?? {}) as Values;
    else own.translations[String(row.locale)] = (row.values ?? {}) as Values;
    data.set(id, own);
  }
  const words = fieldWords(store, marketSlug, locale, lang);
  const out: Record<string, ShownGroup[]> = {};
  for (const [id, own] of data) out[id] = applying.map((g) => shownGroup(g, own, locale, main, words, { publicOnly: true }));
  if (store) await resolveRelations(run, storeId, store.slug, marketSlug, locale, Object.values(out).flat());
  for (const id of Object.keys(out)) {
    out[id] = out[id].filter((g) => g.fields.length > 0);
    if (out[id].length === 0) delete out[id];
  }
  return out;
}

type Target = { label: string; href: string; image?: string | null };

/**
 * Fills in what links and relational fields point at (a product's title and
 * address, a page's, a category's) in the shopper's market, and takes out
 * what no longer exists or is not on the site: a field that then points at
 * nothing is not drawn.
 */
async function resolveRelations(
  run: Runner,
  storeId: string,
  storeSlug: string,
  marketSlug: string,
  locale: string,
  groups: ShownGroup[],
): Promise<void> {
  const wanted = { product: new Set<string>(), page: new Set<string>(), term: new Set<string>() };
  const each = (fields: ShownField[], visit: (field: ShownField) => void) => {
    for (const field of fields) {
      visit(field);
      if (field.children) each(field.children, visit);
      for (const row of field.rows ?? []) each(row, visit);
      for (const block of field.blocks ?? []) each(block.fields, visit);
    }
  };
  const idsOf = (field: ShownField): { kind: "product" | "page" | "term"; id: string }[] => {
    if (field.type === "link") {
      const link = field.value as FieldLink;
      if (link.kind === "url") return [];
      return [{ kind: link.kind === "product" ? "product" : link.kind === "page" ? "page" : "term", id: link.ref }];
    }
    if (field.type === "product" || field.type === "page" || field.type === "term") {
      const ids = Array.isArray(field.value) ? (field.value as string[]) : [String(field.value)];
      return ids.map((id) => ({ kind: field.type as "product" | "page" | "term", id }));
    }
    return [];
  };
  for (const group of groups) each(group.fields, (field) => idsOf(field).forEach(({ kind, id }) => wanted[kind].add(id)));
  if (wanted.product.size + wanted.page.size + wanted.term.size === 0) return;

  const base = (path: string) => marketPath(storeSlug, marketSlug, path);
  const list = (ids: Set<string>) => sql.join([...ids].map((id) => sql`${id}::uuid`), sql`, `);
  const found = { product: new Map<string, Target>(), page: new Map<string, Target>(), term: new Map<string, Target>() };
  if (wanted.product.size > 0) {
    const rows = await run.execute<Row>(sql`
      select p.id, p.handle, coalesce(tl.title, tf.title) as title,
        (select coalesce(thumbnail_url, url) from commerce.product_media where product_id = p.id order by position limit 1) as image
      from commerce.products p
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
      left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
      where p.store_id = ${storeId}::uuid and p.status = 'active' and p.id in (${list(wanted.product)})
    `);
    for (const r of rows) found.product.set(String(r.id), { label: String(r.title), href: base(`/p/${String(r.handle)}`), image: r.image ? String(r.image) : null });
  }
  if (wanted.page.size > 0) {
    const rows = await run.execute<Row>(sql`
      select id, type, slug, coalesce(nullif(published ->> 'title', ''), slug) as title, published -> 'thumbnail' ->> 'url' as image
      from commerce.pages
      where store_id = ${storeId}::uuid and published_at is not null and type in ('page', 'article') and id in (${list(wanted.page)})
    `);
    for (const r of rows) {
      const path = r.type === "article" ? `/blog/${String(r.slug)}` : `/${String(r.slug)}`;
      found.page.set(String(r.id), { label: String(r.title), href: base(path), image: r.image ? String(r.image) : null });
    }
  }
  if (wanted.term.size > 0) {
    const rows = await run.execute<Row>(sql`
      select id, kind, name, slug from commerce.terms where store_id = ${storeId}::uuid and id in (${list(wanted.term)})
    `);
    for (const r of rows) found.term.set(String(r.id), { label: String(r.name), href: base(`/${r.kind === "tag" ? "tag" : "category"}/${String(r.slug)}`) });
  }

  const drop = new WeakSet<ShownField>();
  for (const group of groups) {
    each(group.fields, (field) => {
      const ids = idsOf(field);
      if (ids.length === 0) return;
      const own = field.type === "link" ? (field.value as FieldLink).label : "";
      const links = ids
        .map(({ kind, id }) => found[kind].get(id))
        .filter((target): target is Target => target !== undefined)
        .map((target) => ({ label: own || target.label, href: target.href, ...(target.image !== undefined && { image: target.image }), ...(field.type === "link" && (field.value as FieldLink).newTab && { newTab: true }) }));
      if (links.length === 0) drop.add(field);
      else {
        field.links = links;
        field.text = links.map((link) => link.label).join(", ");
      }
    });
  }
  // A relation that points at nothing on the site draws nothing.
  const prune = (fields: ShownField[]): ShownField[] =>
    fields
      .filter((field) => !drop.has(field))
      .map((field) => ({
        ...field,
        ...(field.children && { children: prune(field.children) }),
        ...(field.rows && { rows: field.rows.map(prune).filter((row) => row.length > 0) }),
        ...(field.blocks && { blocks: field.blocks.map((block) => ({ ...block, fields: prune(block.fields) })).filter((block) => block.fields.length > 0) }),
      }))
      .filter((field) =>
        field.children ? field.children.length > 0 : field.rows ? field.rows.length > 0 : field.blocks ? field.blocks.length > 0 : true,
      );
  for (const group of groups) group.fields = prune(group.fields);
}

/** Whether a field type keeps a value per language (for callers building change sets). */
export const keepsPerLanguage = (def: FieldDef): boolean => isTranslatable(def.type);

export type { FieldValue };
