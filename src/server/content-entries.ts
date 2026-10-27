import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  EMPTY_ENTRY,
  ENTRY_SLUG_MAX,
  entryInput,
  publishProblems,
  readEntryContent,
  type ContentType,
  type Entry,
  type EntryContent,
  type EntrySeo,
} from "@/lib/content-types";
import { applyChanges, holdsMoney, moneyProblems, parseFieldChanges, requiredProblems, tidyFlexible } from "@/lib/custom-fields";

import { audit } from "./auth";
import { clearEntryRefs } from "./content-refs";
import { getContentType, refusal, type ContentActor } from "./content-types";
import { keepOwnRelations } from "./custom-fields";
import type { SaveResult } from "./settings";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Entries of content types (wave 6 unit H, D326): the only writer of `commerce.content_entries`. An entry's draft is saved through
 * `saveEntry()`; what the site shows is its published copy, made by `publishEntry()` and taken away by `unpublishEntry()`. Its values go
 * through the custom fields' own checks against its type's fields: the editor's change parsed (`parseFieldChanges()`), money in a currency
 * the owner offers, relations to the owner's own things only, laid over the draft as kept; publishing asks for a title and the required
 * fields. Every query carries the owner (a store, or null for Kaizena Flow's own site).
 */

/** What an entry is written in: the owner's languages (the main one first) and the currencies its money fields may use. */
export type EntryContext = ContentActor & { locales: readonly string[]; main: string; currencies: readonly string[] };

const ENTRY_ROW = z.object({
  id: col.uuid,
  type_id: col.uuid,
  slug: col.text,
  draft: z.unknown(),
  published: z.unknown().nullable(),
  published_at: col.timestampOrNull,
  first_published_at: col.timestampOrNull,
  position: col.int,
  updated_at: col.timestamp,
});

const toEntry = (row: z.output<typeof ENTRY_ROW>): Entry => ({
  id: row.id,
  typeId: row.type_id,
  slug: row.slug,
  draft: readEntryContent(row.draft),
  published: row.published === null ? null : readEntryContent(row.published),
  publishedAt: row.published_at,
  firstPublishedAt: row.first_published_at,
  position: row.position,
  updatedAt: row.updated_at,
});

const entryColumns = sql`e.id, e.type_id, e.slug, e.draft, e.published, e.published_at, e.first_published_at, e.position, e.updated_at`;

/** A type's entries in the owner's order. */
export async function listEntries(owner: string | null, typeId: string, run: Executor = db()): Promise<Entry[]> {
  if (!z.uuid().safeParse(typeId).success) return [];
  const rows = await typedRows(
    ENTRY_ROW,
    sql`
      select ${entryColumns} from commerce.content_entries e
      where e.store_id is not distinct from ${owner}::uuid and e.type_id = ${typeId}::uuid
      order by e.position, e.created_at, e.id
    `,
    run,
  );
  return rows.map(toEntry);
}

/** One of an owner's entries; null for an unknown one or another owner's. */
export async function getEntry(owner: string | null, id: string, run: Executor = db()): Promise<Entry | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    ENTRY_ROW,
    sql`select ${entryColumns} from commerce.content_entries e where e.store_id is not distinct from ${owner}::uuid and e.id = ${id}::uuid`,
    run,
  );
  return row ? toEntry(row) : null;
}

const SLUG_TAKEN = "Another entry of this type has that address. Choose another.";

/** The address itself when free, else the first of `-2`, `-3`, … that is, kept within the longest address. */
export function freeSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    const end = `-${n}`;
    const next = `${slug.slice(0, ENTRY_SLUG_MAX - end.length).replace(/-+$/, "")}${end}`;
    if (!taken.has(next)) return next;
  }
}

/** Saves an entry's draft: a new entry (no id) at the end of its type's order, or a change to one. Returns its id or what is wrong. */
export async function saveEntry(ctx: EntryContext, raw: unknown): Promise<SaveResult & { id?: string }> {
  const parsed = entryInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const input = parsed.data;
  try {
    const result = await db().transaction(async (tx): Promise<SaveResult & { id?: string }> => {
      const type = await getContentType(ctx.owner, input.typeId, tx);
      if (!type) return { ok: false, problems: ["That content type no longer exists."] };
      let existing: Entry | null = null;
      if (input.id) {
        await tx.execute(sql`select id from commerce.content_entries where id = ${input.id}::uuid for update`);
        existing = await getEntry(ctx.owner, input.id, tx);
        if (!existing || existing.typeId !== type.id) return { ok: false, problems: ["That entry no longer exists."] };
      }
      const { changes, problems } = parseFieldChanges(type.fields, input.fields, ctx.locales, ctx.main);
      if (problems.length > 0) return { ok: false, problems };
      if (type.fields.some(holdsMoney)) {
        const wrong = moneyProblems(type.fields, changes, ctx.currencies);
        if (wrong.length > 0) return { ok: false, problems: wrong };
      }
      await keepOwnRelations(tx, ctx.owner, type.fields, changes);
      const base = existing?.draft ?? EMPTY_ENTRY;
      const draft: EntryContent = {
        data: tidyFlexible(type.fields, applyChanges(base.data, changes)),
        seo: input.seo,
        // Only the owner's other languages' search texts are kept.
        seoTranslations: Object.fromEntries(
          Object.entries(input.seoTranslations).filter(([locale, seo]) => locale !== ctx.main && ctx.locales.includes(locale) && (seo.title || seo.description)),
        ) as Record<string, EntrySeo>,
      };
      if (existing) {
        await tx.execute(sql`
          update commerce.content_entries set slug = ${input.slug}, draft = ${JSON.stringify(draft)}::jsonb, updated_at = now(),
            updated_by = ${ctx.accountId}::uuid
          where id = ${existing.id}::uuid
        `);
        return { ok: true, id: existing.id };
      }
      // A new entry takes the next free address (`dinner`, `dinner-2`, …), so two drafts with the same title both save.
      const taken = new Set(
        (
          await typedRows(
            z.object({ slug: col.text }),
            sql`select slug from commerce.content_entries where type_id = ${type.id}::uuid and (slug = ${input.slug} or slug like ${`${input.slug}-%`})`,
            tx,
          )
        ).map((r) => r.slug),
      );
      const slug = freeSlug(input.slug, taken);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into commerce.content_entries (store_id, type_id, slug, draft, position, created_by, updated_by)
        values (${ctx.owner}::uuid, ${type.id}::uuid, ${slug}, ${JSON.stringify(draft)}::jsonb,
          (select coalesce(max(position) + 1, 0) from commerce.content_entries where type_id = ${type.id}::uuid),
          ${ctx.accountId}::uuid, ${ctx.accountId}::uuid)
        returning id
      `);
      return { ok: true, id: String(row.id) };
    });
    if (result.ok) await audit(ctx.accountId, ctx.owner, "content.entry_saved", { entry: result.id, type: input.typeId, created: !input.id });
    return result;
  } catch (error) {
    const { code, constraint } = refusal(error);
    if (code === "23505" && constraint === "content_entries_type_slug_key") return { ok: false, problems: [SLUG_TAKEN] };
    if (constraint === "content_entries_max") return { ok: false, problems: ["The site keeps at most 10,000 entries."] };
    throw error;
  }
}

/** What stops an entry being published as its draft is: a title, and its type's required fields. */
export function entryPublishProblems(type: ContentType, draft: EntryContent, main: string): string[] {
  return [...publishProblems(type, draft, main), ...requiredProblems(type.fields, draft.data, main)];
}

/** Publishes an entry's draft: the site shows it from now. */
export async function publishEntry(ctx: EntryContext, id: string): Promise<SaveResult> {
  const result = await db().transaction(async (tx): Promise<SaveResult> => {
    const entry = await getEntry(ctx.owner, id, tx);
    if (!entry) return { ok: false, problems: ["That entry no longer exists."] };
    const type = await getContentType(ctx.owner, entry.typeId, tx);
    if (!type) return { ok: false, problems: ["That content type no longer exists."] };
    const problems = entryPublishProblems(type, entry.draft, ctx.main);
    if (problems.length > 0) return { ok: false, problems };
    await tx.execute(sql`
      update commerce.content_entries set published = draft, published_at = now(), first_published_at = coalesce(first_published_at, now()),
        updated_by = ${ctx.accountId}::uuid
      where id = ${entry.id}::uuid
    `);
    return { ok: true };
  });
  if (result.ok) await audit(ctx.accountId, ctx.owner, "content.entry_published", { entry: id });
  return result;
}

/** Takes an entry off the site; its draft stays. */
export async function unpublishEntry(ctx: ContentActor, id: string): Promise<SaveResult> {
  const entry = await getEntry(ctx.owner, id);
  if (!entry) return { ok: false, problems: ["That entry no longer exists."] };
  await db().execute(sql`
    update commerce.content_entries set published = null, published_at = null, updated_by = ${ctx.accountId}::uuid
    where store_id is not distinct from ${ctx.owner}::uuid and id = ${entry.id}::uuid
  `);
  await audit(ctx.accountId, ctx.owner, "content.entry_unpublished", { entry: id });
  return { ok: true };
}

/** Deletes an entry. */
export async function deleteEntry(ctx: ContentActor, id: string): Promise<SaveResult> {
  const entry = await getEntry(ctx.owner, id);
  if (!entry) return { ok: false, problems: ["That entry no longer exists."] };
  await db().transaction(async (tx) => {
    await tx.execute(sql`delete from commerce.content_entries where store_id is not distinct from ${ctx.owner}::uuid and id = ${entry.id}::uuid`);
    await clearEntryRefs(tx, ctx.owner, [entry.id]);
  });
  await audit(ctx.accountId, ctx.owner, "content.entry_deleted", { entry: id, type: entry.typeId });
  return { ok: true };
}

/** Moves an entry one place earlier or later in its type's order. */
export async function moveEntry(ctx: ContentActor, id: string, direction: "earlier" | "later"): Promise<SaveResult> {
  const entry = await getEntry(ctx.owner, id);
  if (!entry) return { ok: false, problems: ["That entry no longer exists."] };
  await db().transaction(async (tx) => {
    const list = await listEntries(ctx.owner, entry.typeId, tx);
    const at = list.findIndex((e) => e.id === entry.id);
    const to = direction === "earlier" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= list.length) return;
    const order = list.map((e) => e.id);
    [order[at], order[to]] = [order[to], order[at]];
    // Numbered again in the new order, so two entries never share a place.
    for (const [index, entryId] of order.entries()) {
      if (list[index].id !== entryId || list[index].position !== index) {
        await tx.execute(sql`update commerce.content_entries set position = ${index} where id = ${entryId}::uuid`);
      }
    }
  });
  return { ok: true };
}
