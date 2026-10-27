import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { entryTitle, readEntryContent } from "@/lib/content-types";
import type { FieldDef, FieldImage } from "@/lib/custom-fields";

import { col, typedRows, type Executor } from "./typed-rows";

/** What a reference to an entry draws as: its title, its page's address (empty for a type without pages) and its picture. */
export type EntryTarget = { label: string; href: string; image: string | null };

/**
 * The published entries among `ids` that are the owner's (D326), each as a reference draws it: the title in `locale` (else the main
 * language's), linked to `/{type}/{entry}` through `path` when its type has pages, with its picture field's small copy. An entry not
 * published, deleted or another owner's is not in the answer, so the reference draws nothing.
 */
export async function entryTargets(
  run: Executor,
  owner: string | null,
  ids: readonly string[],
  locale: string,
  main: string,
  path: (path: string) => string,
): Promise<Map<string, EntryTarget>> {
  const out = new Map<string, EntryTarget>();
  if (ids.length === 0) return out;
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      slug: col.text,
      published: z.unknown(),
      type_slug: col.text,
      has_pages: z.boolean(),
      fields: z.array(z.unknown()),
      title_field: col.text,
      picture_field: col.text.nullable(),
    }),
    sql`
      select e.id, e.slug, e.published, t.slug as type_slug, t.has_pages, t.fields, t.title_field, t.picture_field
      from commerce.content_entries e join commerce.content_types t on t.id = e.type_id
      where e.store_id is not distinct from ${owner}::uuid and e.published is not null
        and e.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
    `,
    run,
  );
  for (const row of rows) {
    const content = readEntryContent(row.published);
    const type = { fields: row.fields as FieldDef[], titleField: row.title_field };
    const picture = row.picture_field ? (content.data.values[row.picture_field] as FieldImage | undefined) : undefined;
    out.set(row.id, {
      label: entryTitle(type, content.data, locale, main) || row.slug,
      href: row.has_pages ? path(`/${row.type_slug}/${row.slug}`) : "",
      image: picture && typeof picture === "object" && "url" in picture ? (picture.thumbnailUrl ?? picture.url) : null,
    });
  }
  return out;
}

/** The owner's entries an entry field's editor chooses from (D326), drafts too, each by its title in the main language. */
export async function entryLookups(run: Executor, owner: string | null, main: string, limit: number): Promise<{ id: string; title: string; type: string }[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, slug: col.text, draft: z.unknown(), key: col.text, fields: z.array(z.unknown()), title_field: col.text }),
    sql`
      select e.id, e.slug, e.draft, t.key, t.fields, t.title_field
      from commerce.content_entries e join commerce.content_types t on t.id = e.type_id
      where e.store_id is not distinct from ${owner}::uuid
      order by t.position, e.position
      limit ${limit}
    `,
    run,
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.key,
    title: entryTitle({ fields: row.fields as FieldDef[], titleField: row.title_field }, readEntryContent(row.draft).data, main, main) || row.slug,
  }));
}
