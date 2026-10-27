import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  contentTypeInput,
  entryLayoutStarter,
  newTypeKey,
  readEntryContent,
  removedFieldIds,
  retypedFields,
  withoutFields,
  type ContentType,
} from "@/lib/content-types";
import { subFieldsOf, type FieldDef } from "@/lib/custom-fields";

import { audit, type Account } from "./auth";
import type { SaveResult } from "./settings";
import { clearEntryRefs } from "./content-refs";
import { savePage } from "./pages";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Content types (wave 6 unit H, D326): the only writer of `commerce.content_types`. An owner is a store, or Kaizena Flow's own site
 * (`owner` null, H4); every query carries it. The type's fields are custom field definitions, checked by `contentTypeInput` (the same
 * schema a group of fields passes); a field taken away takes its values out of every entry, draft and published, in the same transaction.
 */

export { contentTag } from "@/lib/content-types";

/** Who is changing content, for whose site: an account, and a store or Kaizena Flow's own (null). */
export type ContentActor = { accountId: string; owner: string | null };

const TYPE_ROW = z.object({
  id: col.uuid,
  key: col.text,
  name: col.text,
  slug: col.text,
  fields: z.array(z.unknown()),
  title_field: col.text,
  summary_field: col.textOrNull,
  picture_field: col.textOrNull,
  has_pages: col.bool,
  layout_id: z.uuid().nullable(),
  position: col.int,
  entries: col.int,
  ever_published: col.bool,
});

const toType = (row: z.output<typeof TYPE_ROW>): ContentType => ({
  id: row.id,
  key: row.key,
  name: row.name,
  slug: row.slug,
  fields: row.fields as FieldDef[],
  titleField: row.title_field,
  summaryField: row.summary_field,
  pictureField: row.picture_field,
  hasPages: row.has_pages,
  layoutId: row.layout_id,
  position: row.position,
  entries: row.entries,
  everPublished: row.ever_published,
});

const typeColumns = sql`
  t.id, t.key, t.name, t.slug, t.fields, t.title_field, t.summary_field, t.picture_field, t.has_pages, t.layout_id, t.position,
  (select count(*)::int from commerce.content_entries e where e.type_id = t.id) as entries,
  exists (select 1 from commerce.content_entries e where e.type_id = t.id and e.first_published_at is not null) as ever_published
`;

/** An owner's types in their order. */
export async function listContentTypes(owner: string | null, run: Executor = db()): Promise<ContentType[]> {
  const rows = await typedRows(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where t.store_id is not distinct from ${owner}::uuid order by t.position, lower(t.name), t.id`,
    run,
  );
  return rows.map(toType);
}

/** One of an owner's types by id; null for an unknown one or another owner's. */
export async function getContentType(owner: string | null, id: string, run: Executor = db()): Promise<ContentType | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where t.store_id is not distinct from ${owner}::uuid and t.id = ${id}::uuid`,
    run,
  );
  return row ? toType(row) : null;
}

/** One of an owner's types by its key (what fields and grids name it by). */
export async function contentTypeByKey(owner: string | null, key: string, run: Executor = db()): Promise<ContentType | null> {
  const row = await typedRow(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where t.store_id is not distinct from ${owner}::uuid and t.key = ${key}`,
    run,
  );
  return row ? toType(row) : null;
}

/** What the database said when it refused: its code, the constraint it named and its message, through any wrapping. */
export function refusal(error: unknown): { code: string; constraint: string; message: string } {
  const out = { code: "", constraint: "", message: "" };
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const r = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown; message?: unknown };
    if (!out.code && typeof r.code === "string") out.code = r.code;
    if (!out.constraint && typeof r.constraint_name === "string") out.constraint = r.constraint_name;
    if (!out.constraint && typeof r.constraint === "string") out.constraint = r.constraint;
    if (typeof r.message === "string") out.message += ` ${r.message}`;
  }
  return out;
}

/** A field of a kind Kaizena Flow's own site cannot keep (H4): money (no currencies) and files (no field files' folder). */
const PLATFORM_REFUSED = ["money", "file"];
const holdsRefused = (def: FieldDef): boolean => PLATFORM_REFUSED.includes(def.type) || subFieldsOf(def).some(holdsRefused);

/** Creates a type (no id) or changes one. Returns its id, or what is wrong in plain words. */
export async function saveContentType(actor: ContentActor, raw: unknown): Promise<SaveResult & { id?: string }> {
  const parsed = contentTypeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const input = parsed.data;
  const fields = input.fields as FieldDef[];
  if (actor.owner === null) {
    const refused = fields.find(holdsRefused);
    if (refused) return { ok: false, problems: [`${refused.label}: Kaizena Flow's own site keeps no money or file fields.`] };
  }
  try {
    const result = await db().transaction(async (tx): Promise<SaveResult & { id?: string }> => {
      if (input.id) {
        const [locked] = await tx.execute(
          sql`select id from commerce.content_types where store_id is not distinct from ${actor.owner}::uuid and id = ${input.id}::uuid for update`,
        );
        const existing = locked ? await getContentType(actor.owner, input.id, tx) : null;
        if (!existing) return { ok: false, problems: ["That content type no longer exists."] };
        const retyped = retypedFields(existing.fields, fields);
        if (retyped.length > 0) {
          return { ok: false, problems: retyped.map((f) => `${f.label}: a field's type cannot change once it is saved. Add a new field instead.`) };
        }
        if (existing.slug !== input.slug && existing.everPublished) {
          return { ok: false, problems: ["The web name is fixed once an entry of the type has been published: its entries' addresses use it."] };
        }
        await tx.execute(sql`
          update commerce.content_types set name = ${input.name}, slug = ${input.slug}, fields = ${JSON.stringify(fields)}::jsonb,
            title_field = ${input.titleField}, summary_field = ${input.summaryField}, picture_field = ${input.pictureField},
            has_pages = ${input.hasPages}, updated_at = now(), updated_by = ${actor.accountId}::uuid
          where id = ${input.id}::uuid
        `);
        const removed = removedFieldIds(existing.fields, fields);
        if (removed.length > 0) await removeFieldValues(tx, input.id, removed);
        return { ok: true, id: input.id };
      }
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into commerce.content_types (store_id, key, name, slug, fields, title_field, summary_field, picture_field, has_pages, position, updated_by)
        values (${actor.owner}::uuid, ${newTypeKey()}, ${input.name}, ${input.slug}, ${JSON.stringify(fields)}::jsonb, ${input.titleField},
          ${input.summaryField}, ${input.pictureField}, ${input.hasPages},
          (select coalesce(max(position) + 1, 0) from commerce.content_types where store_id is not distinct from ${actor.owner}::uuid),
          ${actor.accountId}::uuid)
        returning id
      `);
      return { ok: true, id: String(row.id) };
    });
    if (result.ok) await audit(actor.accountId, actor.owner, "content.type_saved", { type: result.id, name: input.name, created: !input.id });
    return result;
  } catch (error) {
    const { code, constraint } = refusal(error);
    if (code === "23505" && constraint === "content_types_store_slug_key") {
      return { ok: false, problems: [`Another content type has the web name ${input.slug}. Choose another.`] };
    }
    if (constraint === "content_types_max") return { ok: false, problems: ["The site keeps at most 50 content types."] };
    if (constraint === "content_types_slug_fixed") {
      return { ok: false, problems: ["The web name is fixed once an entry of the type has been published: its entries' addresses use it."] };
    }
    throw error;
  }
}

/** Takes the values of fields a type lost out of every entry of it, draft and published. */
async function removeFieldValues(run: Executor, typeId: string, ids: string[]): Promise<void> {
  const rows = await typedRows(
    z.object({ id: col.uuid, draft: z.unknown(), published: z.unknown().nullable() }),
    sql`select id, draft, published from commerce.content_entries where type_id = ${typeId}::uuid`,
    run,
  );
  for (const row of rows) {
    const draft = withoutFields(readEntryContent(row.draft), ids);
    const published = row.published === null ? null : withoutFields(readEntryContent(row.published), ids);
    await run.execute(sql`
      update commerce.content_entries set draft = ${JSON.stringify(draft)}::jsonb,
        published = ${published === null ? null : JSON.stringify(published)}::jsonb
      where id = ${row.id}::uuid
    `);
  }
}

/** Deletes a type and its entries. */
export async function deleteContentType(actor: ContentActor, id: string): Promise<SaveResult> {
  const type = await getContentType(actor.owner, id);
  if (!type) return { ok: false, problems: ["That content type no longer exists."] };
  await db().transaction(async (tx) => {
    // Its entries go with it (the foreign key cascades), and every reference to them, as deleting each would.
    const gone = await typedRows(
      z.object({ id: col.uuid }),
      sql`select id from commerce.content_entries where store_id is not distinct from ${actor.owner}::uuid and type_id = ${id}::uuid`,
      tx,
    );
    await tx.execute(sql`delete from commerce.content_types where store_id is not distinct from ${actor.owner}::uuid and id = ${id}::uuid`);
    await clearEntryRefs(
      tx,
      actor.owner,
      gone.map((row) => row.id),
    );
  });
  await audit(actor.accountId, actor.owner, "content.type_deleted", { type: id, name: type.name, entries: type.entries });
  return { ok: true };
}

/**
 * The page a type's entries are drawn with (D326): the type's layout when it has one, else a new draft entry layout made from
 * `entryLayoutStarter()` through `savePage()` and chosen for the type, in one go. Returns the layout page's id.
 */
export async function designEntryLayout(account: Account, owner: string | null, typeId: string): Promise<SaveResult & { id?: string }> {
  const type = await getContentType(owner, typeId);
  if (!type) return { ok: false, problems: ["That content type no longer exists."] };
  if (type.layoutId) return { ok: true, id: type.layoutId };
  const saved = await savePage(account, owner, null, entryLayoutStarter(type, () => randomUUID().replaceAll("-", "").slice(0, 16)), {
    publish: false,
    type: "entry_layout",
  });
  if (!saved.ok) return { ok: false, problems: "problems" in saved ? saved.problems : ["The entry page could not be made."] };
  await db().execute(sql`
    update commerce.content_types set layout_id = ${saved.id}::uuid, updated_by = ${account.id}::uuid
    where store_id is not distinct from ${owner}::uuid and id = ${type.id}::uuid and layout_id is null
  `);
  await audit(account.id, owner, "content.layout_made", { type: type.id, page: saved.id });
  return { ok: true, id: saved.id };
}

/** The type an entry layout belongs to (D326), or null when no type of the owner draws its entries with it. */
export async function typeOfLayout(owner: string | null, pageId: string): Promise<ContentType | null> {
  if (!z.uuid().safeParse(pageId).success) return null;
  const row = await typedRow(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where t.store_id is not distinct from ${owner}::uuid and t.layout_id = ${pageId}::uuid`,
  );
  return row ? toType(row) : null;
}

/** The owner's types as an entry field chooses among them (D326): key and name, in the owner's order. */
export async function contentTypeChoices(owner: string | null): Promise<{ key: string; name: string }[]> {
  return (await listContentTypes(owner)).map((type) => ({ key: type.key, name: type.name }));
}

/** Puts an owner's types in the order given (ids of other owners' types are ignored). */
export async function orderContentTypes(actor: ContentActor, ids: string[]): Promise<SaveResult> {
  const valid = ids.filter((id) => z.uuid().safeParse(id).success).slice(0, 50);
  await db().transaction(async (tx) => {
    for (const [index, id] of valid.entries()) {
      await tx.execute(sql`
        update commerce.content_types set position = ${index}
        where store_id is not distinct from ${actor.owner}::uuid and id = ${id}::uuid
      `);
    }
  });
  return { ok: true };
}
