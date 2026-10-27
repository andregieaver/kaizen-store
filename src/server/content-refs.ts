import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { readEntryContent, withoutEntry } from "@/lib/content-types";
import type { FieldData, FieldDef, Values } from "@/lib/custom-fields";

import { col, typedRows, type Executor } from "./typed-rows";

/**
 * Deleting an entry clears the references to it (D326, rule of the row `catalogue.metaobjects`): in the delete's transaction, every entry
 * field that names one of the deleted entries loses it, in the owner's other entries (draft and published) and in its field values, so no
 * stored value points at an entry that is gone. The rows are found by the id in their text (a uuid is unique) and changed only through
 * `withoutEntry()`, over the definitions that hold them.
 */
export async function clearEntryRefs(tx: Executor, owner: string | null, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const patterns = sql`array[${sql.join(
    ids.map((id) => sql`${`%${id}%`}`),
    sql`, `,
  )}]::text[]`;
  const strip = (defs: FieldDef[], data: FieldData): FieldData | null => {
    let current = data;
    let changed = false;
    for (const id of ids) {
      const next = withoutEntry(defs, current, id);
      if (next) {
        current = next;
        changed = true;
      }
    }
    return changed ? current : null;
  };

  const entries = await typedRows(
    z.object({ id: col.uuid, draft: z.unknown(), published: z.unknown(), fields: z.array(z.unknown()) }),
    sql`
      select e.id, e.draft, e.published, t.fields
      from commerce.content_entries e
      join commerce.content_types t on t.id = e.type_id
      where e.store_id is not distinct from ${owner}::uuid
        and (e.draft::text like any(${patterns}) or coalesce(e.published::text, '') like any(${patterns}))
      for update of e
    `,
    tx,
  );
  for (const row of entries) {
    const defs = row.fields as FieldDef[];
    const draft = readEntryContent(row.draft);
    const published = row.published ? readEntryContent(row.published) : null;
    const draftData = strip(defs, draft.data);
    const publishedData = published ? strip(defs, published.data) : null;
    if (!draftData && !publishedData) continue;
    await tx.execute(sql`
      update commerce.content_entries set
        draft = ${JSON.stringify(draftData ? { ...draft, data: draftData } : draft)}::jsonb,
        published = ${published ? JSON.stringify(publishedData ? { ...published, data: publishedData } : published) : null}::jsonb
      where id = ${row.id}::uuid
    `);
  }

  // Field values are a store's (Kaizena Flow's own site keeps none).
  if (owner === null) return;
  const values = await typedRows(
    z.object({ entity: col.text, entity_id: col.uuid, locale: col.text, values: z.record(z.string(), z.unknown()) }),
    sql`
      select entity, entity_id, locale, values from commerce.field_values
      where store_id = ${owner}::uuid and values::text like any(${patterns})
      for update
    `,
    tx,
  );
  if (values.length === 0) return;
  const groups = await typedRows(z.object({ fields: z.array(z.unknown()) }), sql`select fields from commerce.field_groups where store_id = ${owner}::uuid`, tx);
  const defs = groups.flatMap((g) => g.fields as FieldDef[]);
  for (const row of values) {
    const own = row.values as Values;
    const data: FieldData = row.locale === "" ? { values: own, translations: {} } : { values: {}, translations: { [row.locale]: own } };
    const next = strip(defs, data);
    if (!next) continue;
    const kept = row.locale === "" ? next.values : (next.translations[row.locale] ?? {});
    await tx.execute(sql`
      update commerce.field_values set values = ${JSON.stringify(kept)}::jsonb, updated_at = now()
      where store_id = ${owner}::uuid and entity = ${row.entity} and entity_id = ${row.entity_id}::uuid and locale = ${row.locale}
    `);
  }
}
