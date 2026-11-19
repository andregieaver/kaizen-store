import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { ContentType } from "@/lib/content-types";
import type { FieldDef } from "@/lib/custom-fields";

import { owned } from "./owned";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The reads of content types (D326), apart from their writer `content-types.ts` (bloat review step 2.21), which re-exports them: a page
 * that draws entries (`content-site.ts`, through the grid and search sections of `page-article.tsx`) reads a type without loading the
 * code that saves types and their layout pages (`savePage()` in `pages.ts`). Text unchanged from where it was.
 */

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
    sql`select ${typeColumns} from commerce.content_types t where ${owned(owner, sql`t.store_id`)} order by t.position, lower(t.name), t.id`,
    run,
  );
  return rows.map(toType);
}

/** One of an owner's types by id; null for an unknown one or another owner's. */
export async function getContentType(owner: string | null, id: string, run: Executor = db()): Promise<ContentType | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where ${owned(owner, sql`t.store_id`)} and t.id = ${id}::uuid`,
    run,
  );
  return row ? toType(row) : null;
}

/** One of an owner's types by its key (what fields and grids name it by). */
export async function contentTypeByKey(owner: string | null, key: string, run: Executor = db()): Promise<ContentType | null> {
  const row = await typedRow(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where ${owned(owner, sql`t.store_id`)} and t.key = ${key}`,
    run,
  );
  return row ? toType(row) : null;
}

/** The type an entry layout belongs to (D326), or null when no type of the owner draws its entries with it. */
export async function typeOfLayout(owner: string | null, pageId: string): Promise<ContentType | null> {
  if (!z.uuid().safeParse(pageId).success) return null;
  const row = await typedRow(
    TYPE_ROW,
    sql`select ${typeColumns} from commerce.content_types t where ${owned(owner, sql`t.store_id`)} and t.layout_id = ${pageId}::uuid`,
  );
  return row ? toType(row) : null;
}
