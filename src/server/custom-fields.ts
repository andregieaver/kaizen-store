import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import {
  EMPTY_DATA,
  MAX_FIELD_GROUPS,
  applyChanges,
  exportGroups,
  fieldGroupInput,
  groupApplies,
  importGroups,
  isFieldEntity,
  isTranslatable,
  parseFieldChanges,
  requiredProblems,
  shownGroup,
  type Facts,
  type FieldData,
  type FieldDef,
  type FieldEntity,
  type FieldGroup,
  type FieldValue,
  type Values,
  type ShownGroup,
} from "@/lib/custom-fields";
import { t } from "@/lib/i18n";
import type { PageContent } from "@/lib/page-content";

import { audit, type Membership } from "./auth";
import type { SaveResult } from "./settings";
import { getStore } from "./stores";

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
    select * from commerce.field_groups where store_id = ${storeId}::uuid and active order by sort, created_at
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
  if (id) {
    const before = await getFieldGroup(store.id, id);
    if (!before) return { ok: false, problems: ["The group no longer exists."] };
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
    where store_id = ${store.id}::uuid and id = ${id}::uuid returning name
  `);
  if (rows.length === 0) return { ok: false, problems: ["The group no longer exists."] };
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
  if (raw === undefined || raw === null) return [];
  const groups = (await activeFieldGroups(storeId, entity)).filter((g) => groupApplies(g, options.facts));
  const defs = groups.flatMap((g) => g.fields);
  if (defs.length === 0) return [];

  const { changes, problems } = parseFieldChanges(defs, raw, options.locales, options.main);
  if (problems.length > 0) return problems;

  const existing = await getFieldData(storeId, entity, entityId, run);
  const next = applyChanges(existing, changes);
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
 * The editor's view of a thing's fields: every active group that could be on
 * the kind of thing (the editor works out which apply as the thing changes),
 * and what was entered.
 */
export async function fieldsForEditor(
  storeId: string,
  entity: FieldEntity,
  entityId: string | null,
): Promise<{ groups: FieldGroup[]; data: FieldData }> {
  const [groups, data] = await Promise.all([
    activeFieldGroups(storeId, entity),
    entityId ? getFieldData(storeId, entity, entityId) : Promise.resolve(EMPTY_DATA),
  ]);
  return { groups, data };
}

// ---------------------------------------------------------------------------
// On the site
// ---------------------------------------------------------------------------

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
): Promise<ShownGroup[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(fieldsTag(storeId));
  const groups = await activeFieldGroups(storeId, entity);
  if (groups.length === 0) return [];
  const run = readDb();
  const [slug] = await run.execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = slug ? await getStore(String(slug.slug)) : null;
  const main = store?.localization.locales[0] ?? locale;
  const facts =
    entity === "product" ? await productFacts(run, storeId, entityId) : await pageFacts(run, storeId, entityId);
  if (!facts) return [];
  const applying = groups.filter((g) => groupApplies(g, facts) && g.fields.some((f) => f.access === "public"));
  if (applying.length === 0) return [];
  const data = await getFieldData(storeId, entity, entityId, run);
  const m = t(lang);
  const words = { yes: m.customFields.yes, no: m.customFields.no };
  return applying
    .map((g) => shownGroup(g, data, locale, main, words, { publicOnly: true }))
    .filter((g) => g.fields.length > 0);
}

/** Whether a field type keeps a value per language (for callers building change sets). */
export const keepsPerLanguage = (def: FieldDef): boolean => isTranslatable(def.type);

export type { FieldValue };
