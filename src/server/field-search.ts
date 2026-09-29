import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { groupApplies, type FieldData, type FieldGroup, type Facts, type Values } from "@/lib/custom-fields";
import { searchBodies, usesSearch } from "@/lib/field-search";

import { getFieldData, listFieldGroups, productFacts } from "./custom-fields";
import { getStore } from "./stores";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Keyword search over custom fields (D118, D72): the words of a product's
 * public fields flagged `search`, one text per language in
 * `commerce.field_search` (made by `searchBodies()`), read by `matchingIds()`
 * in `search.ts` next to the product's own texts. Kept as the product's
 * fields are saved, and made again for the whole store when its groups change.
 */

/** Products made again at a time when a store's search texts are rebuilt. */
const BATCH = 100;

/** The store's active groups that can be on a product and have a field flagged for search. */
async function searchGroups(storeId: string): Promise<FieldGroup[]> {
  // Read past the cache: a group just saved is what these texts are made from.
  return (await listFieldGroups(storeId)).filter((g) => g.active && g.entities.includes("product") && usesSearch(g));
}

/** The store's languages, main first, unless the caller knows them. */
async function localesOf(storeId: string): Promise<{ locales: readonly string[]; main: string } | null> {
  const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  const store = row ? await getStore(String(row.slug)) : null;
  return store ? { locales: store.localization.locales, main: store.localization.locales[0] ?? "" } : null;
}

const NO_FACTS: Facts = { entity: "product", categories: [], tags: [], roles: [] };

/** Rows to insert for one product: a text for each language that has words. */
function rowsFor(
  storeId: string,
  productId: string,
  groups: FieldGroup[],
  facts: Facts,
  data: FieldData,
  where: { locales: readonly string[]; main: string },
) {
  const applying = groups.filter((g) => groupApplies(g, facts));
  const bodies = applying.length > 0 ? searchBodies(applying, data, where.locales, where.main) : {};
  return Object.entries(bodies).map(
    ([locale, body]) => sql`(${storeId}::uuid, 'product', ${productId}::uuid, ${locale}, ${body})`,
  );
}

const insertRows = (run: Runner, rows: SQL[]) =>
  rows.length === 0
    ? Promise.resolve()
    : run.execute(sql`
        insert into commerce.field_search (store_id, entity, entity_id, locale, body)
        values ${sql.join(rows, sql`, `)}
      `);

/**
 * Makes a product's search texts again from what is entered now: rows are
 * replaced, and none are left when the product has no words in fields
 * flagged for search. Inside the caller's transaction when given one (the
 * product's fields have just been written in it). `where` gives the store's
 * languages when the caller has them at hand.
 */
export async function refreshFieldSearch(
  run: Runner,
  storeId: string,
  productId: string,
  where?: { locales: readonly string[]; main: string },
): Promise<void> {
  const groups = await searchGroups(storeId);
  let rows: SQL[] = [];
  if (groups.length > 0) {
    const known = where ?? (await localesOf(storeId));
    const facts = await productFacts(run, storeId, productId);
    if (known && facts) {
      rows = rowsFor(storeId, productId, groups, facts, await getFieldData(storeId, "product", productId, run), known);
    }
  }
  await run.execute(sql`
    delete from commerce.field_search where store_id = ${storeId}::uuid and entity = 'product' and entity_id = ${productId}::uuid
  `);
  await insertRows(run, rows);
}

/**
 * Makes the search texts of all the store's products again, in batches: when
 * its groups change (a field flagged or unflagged, a group switched on or
 * off or taken away). A store with no field flagged for search is cleaned of
 * any rows it has.
 */
export async function refreshStoreFieldSearch(storeId: string): Promise<void> {
  const groups = await searchGroups(storeId);
  const known = groups.length > 0 ? await localesOf(storeId) : null;
  if (!known) {
    await db().execute(sql`delete from commerce.field_search where store_id = ${storeId}::uuid and entity = 'product'`);
    return;
  }
  // Facts are only needed when some group is narrowed by where it applies.
  const needFacts = groups.some((g) => g.location.length > 0);
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const products = await db().execute<Row>(sql`
      select id from commerce.products where store_id = ${storeId}::uuid and id > ${after}::uuid order by id limit ${BATCH}
    `);
    if (products.length === 0) break;
    const ids = products.map((p) => String(p.id));
    after = ids[ids.length - 1];
    await db().transaction(async (tx) => {
      const values = await tx.execute<Row>(sql`
        select entity_id, locale, values from commerce.field_values
        where store_id = ${storeId}::uuid and entity = 'product' and entity_id = any(${`{${ids.join(",")}}`}::uuid[])
      `);
      const dataOf = new Map<string, FieldData>();
      for (const row of values) {
        const id = String(row.entity_id);
        const data = dataOf.get(id) ?? { values: {}, translations: {} };
        if (row.locale === "") data.values = (row.values ?? {}) as Values;
        else data.translations[String(row.locale)] = (row.values ?? {}) as Values;
        dataOf.set(id, data);
      }
      const rows: SQL[] = [];
      for (const id of ids) {
        const data = dataOf.get(id);
        if (!data) continue;
        const facts = needFacts ? await productFacts(tx, storeId, id) : NO_FACTS;
        if (facts) rows.push(...rowsFor(storeId, id, groups, facts, data, known));
      }
      await tx.execute(sql`
        delete from commerce.field_search
        where store_id = ${storeId}::uuid and entity = 'product' and entity_id = any(${`{${ids.join(",")}}`}::uuid[])
      `);
      await insertRows(tx, rows);
    });
  }
  // Products that are gone have no rows (a trigger), but a product with no fields has none either: nothing more to clean.
}
