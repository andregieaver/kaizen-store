import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { PageLayout } from "@/lib/page-layout";
import {
  COPYABLE_BUCKETS,
  contentTypeOf,
  copyPathFor,
  fileNameOf,
  isStoreFile,
  mediaKindOf,
  rewriteFiles,
  storageRef,
  storeFileUrlsIn,
  type FileResolver,
} from "@/lib/store-copy-media";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { mapTemplateMedia } from "@/lib/template-content";

import { copyStoredFile } from "./media";
import { copyToLibrary, libraryFilesByUrl, type LibraryFile } from "./media-library";

type Row = Record<string, unknown>;

/**
 * The media phase of a store copy (D129, `docs/store-copy.md`): every file the copied content points at inside
 * the original store's folder of Storage is copied by Storage's own copy into the new store's folder and
 * registered in the new store's library (`copyToLibrary()`, with its alt texts), and then every address in the
 * copy is rewritten from the old to the new. A file that cannot be copied is left out (a picture removed, a
 * background dropped, an address taken out of a text) and counted, never left pointing at the original. A file
 * used twice is copied once (`libraryFilesByUrl()` finds it by either of its addresses), and what was copied is kept
 * in `store_copy_files`, so a run that stopped goes on where it was and copies nothing twice. Files that are not the
 * original's (another site's, Kaizen's demo pictures) are not touched.
 */

export type MediaCopyDeps = { copyFile?: typeof copyStoredFile };
export type MediaCopyContext = { copyId: string; sourceId: string; newId: string; accountId: string };
export type MediaCopyState = {
  /** Files copied or left out so far, and the files still to do (the whole is `done + todo`). */
  done: number;
  todo: number;
  leftOut: number;
  /** Every file is copied and every address rewritten. */
  finished: boolean;
};

// ---------------------------------------------------------------------------
// Where a copy holds addresses of files
// ---------------------------------------------------------------------------

/** A column of JSON (or text) that can hold addresses of files, with what names its row. */
type Carrier = {
  table: string;
  /** The column that says whose row it is: `store_id`, or `id` on the store itself. */
  scope: "store_id" | "id";
  keys: string[];
  column: string;
  text?: boolean;
  /** The column is null, not empty, when its picture is left out. */
  nullable?: boolean;
  /** Pages hold rows of blocks, which the template code knows how to walk. */
  page?: boolean;
  /** Which rows: custom field values of customers and orders are staff's personal data and hold no pictures, so are never read here. */
  only?: ReturnType<typeof sql>;
};

const CARRIERS: Carrier[] = [
  { table: "stores", scope: "id", keys: ["id"], column: "navigation" },
  { table: "stores", scope: "id", keys: ["id"], column: "seo" },
  { table: "stores", scope: "id", keys: ["id"], column: "theme" },
  { table: "stores", scope: "id", keys: ["id"], column: "custom_code" },
  { table: "stores", scope: "id", keys: ["id"], column: "custom_css", text: true },
  { table: "pages", scope: "store_id", keys: ["id"], column: "draft", page: true },
  { table: "pages", scope: "store_id", keys: ["id"], column: "published", page: true },
  { table: "menus", scope: "store_id", keys: ["id"], column: "items" },
  { table: "saved_parts", scope: "store_id", keys: ["id"], column: "content" },
  { table: "chat_agents", scope: "store_id", keys: ["id"], column: "avatar", nullable: true },
  { table: "store_themes", scope: "store_id", keys: ["id"], column: "settings" },
  { table: "cart_reminder_steps", scope: "store_id", keys: ["id"], column: "content" },
  {
    table: "field_values",
    scope: "store_id",
    keys: ["entity", "entity_id", "locale"],
    column: "values",
    only: sql`"entity" in ('product', 'page', 'article', 'variant', 'term', 'store')`,
  },
];

const col = (name: string) => sql.raw(`"${name}"`);
const tbl = (name: string) => sql.raw(`commerce."${name}"`);
const like = (storeId: string) => `%${storeId.toLowerCase()}%`;

/** Pictures in their own columns: a product's pictures and its variants'. */
async function pictureRows(newId: string, sourceId: string) {
  const [media, variants] = await Promise.all([
    db().execute<Row>(sql`
      select id, url, thumbnail_url from commerce.product_media
      where store_id = ${newId}::uuid and (url like ${like(sourceId)} or thumbnail_url like ${like(sourceId)})
    `),
    db().execute<Row>(sql`
      select id, image_url, image_thumbnail_url from commerce.product_variants
      where store_id = ${newId}::uuid and (image_url like ${like(sourceId)} or image_thumbnail_url like ${like(sourceId)})
    `),
  ]);
  return { media, variants };
}

/** Every address of a file in the original's folder that the copy holds, once each. */
async function discover(ctx: MediaCopyContext): Promise<string[]> {
  const found = new Set<string>();
  const add = (text: unknown) => {
    if (typeof text === "string") for (const url of storeFileUrlsIn(text, ctx.sourceId)) found.add(url);
  };
  for (const carrier of CARRIERS) {
    const rows = await db().execute<Row>(sql`
      select ${col(carrier.column)}::text as body from ${tbl(carrier.table)}
      where ${col(carrier.scope)} = ${ctx.newId}::uuid and ${col(carrier.column)}::text like ${like(ctx.sourceId)}
        and ${carrier.only ?? sql`true`}
    `);
    for (const row of rows) add(row.body);
  }
  const { media, variants } = await pictureRows(ctx.newId, ctx.sourceId);
  for (const row of media) {
    add(row.url);
    add(row.thumbnail_url);
  }
  for (const row of variants) {
    add(row.image_url);
    add(row.image_thumbnail_url);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Copying the files
// ---------------------------------------------------------------------------

type FileGroup = {
  /** The library item (when the source library holds it) and every address of it that the content uses. */
  file: LibraryFile | null;
  urls: { url: string; main: boolean }[];
};

/** The source library's items by address, asked in chunks so a long list stays a short query. */
async function libraryFor(sourceId: string, urls: string[]): Promise<Map<string, LibraryFile>> {
  const found = new Map<string, LibraryFile>();
  for (let start = 0; start < urls.length; start += 100) {
    for (const [url, file] of await libraryFilesByUrl(sourceId, urls.slice(start, start + 100))) found.set(url, file);
  }
  return found;
}

const mappingOf = async (copyId: string): Promise<Map<string, string | null>> => {
  const rows = await db().execute<Row>(
    sql`select source_url, new_url from commerce.store_copy_files where copy_id = ${copyId}::uuid`,
  );
  return new Map(rows.map((row) => [String(row.source_url), row.new_url === null ? null : String(row.new_url)]));
};

/** The files still to copy, from the addresses not yet in the mapping: a library item once, however many of its addresses are used. */
async function groupsOf(
  ctx: MediaCopyContext,
  pending: string[],
  mapped: Map<string, string | null>,
): Promise<FileGroup[]> {
  const library = await libraryFor(ctx.sourceId, pending);
  const groups = new Map<string, FileGroup>();
  for (const url of pending) {
    const file = library.get(url);
    if (!file) {
      groups.set(url, { file: null, urls: [{ url, main: true }] });
      continue;
    }
    const group = groups.get(file.id) ?? { file, urls: [] };
    group.urls.push({ url, main: url === file.url });
    groups.set(file.id, group);
  }
  // A small copy asked for after its picture was copied takes the picture's copy.
  return [...groups.values()].filter((group) => {
    const main = group.file?.url;
    if (!main || !mapped.has(main)) return true;
    return false;
  });
}

async function remember(copyId: string, rows: { url: string; next: string | null; main: boolean }[]): Promise<void> {
  if (rows.length === 0) return;
  await db().execute(sql`
    insert into commerce.store_copy_files (copy_id, source_url, new_url, main)
    values ${sql.join(
      rows.map((row) => sql`(${copyId}::uuid, ${row.url}, ${row.next}, ${row.main})`),
      sql`, `,
    )}
    on conflict do nothing
  `);
}

/** Copies one file (with its small copy) into the new store; the new addresses by old address, null for what failed. */
async function copyGroup(
  ctx: MediaCopyContext,
  group: FileGroup,
  copyFile: typeof copyStoredFile,
): Promise<{ url: string; next: string | null; main: boolean }[]> {
  const failed = () => group.urls.map(({ url, main }) => ({ url, main, next: null }));
  if (group.file) {
    const file = group.file;
    const copy = await copyToLibrary({ storeId: ctx.newId, accountId: ctx.accountId }, file, copyFile);
    if (!copy) return failed();
    // Its alt texts are the same picture's, so they come along (`copyToLibrary()` leaves them for a template).
    await db().execute(sql`
      update commerce.media n
         set alt = s.alt, alt_translations = s.alt_translations, alt_source = s.alt_source, alt_written_at = s.alt_written_at
        from commerce.media s
       where s.id = ${file.id}::uuid and n.url = ${copy.url}
    `);
    return group.urls.map(({ url, main }) => ({
      url,
      main,
      next: url === file.url ? copy.url : (copy.thumbnailUrl ?? copy.url),
    }));
  }
  // A file the library never registered: still in the original's folder, so still the original's to hand over.
  const [{ url, main }] = group.urls;
  const ref = storageRef(url);
  if (!ref || !isStoreFile(url, ctx.sourceId) || !(COPYABLE_BUCKETS as readonly string[]).includes(ref.bucket))
    return failed();
  const next = await copyFile(ref.bucket, ref.path, copyPathFor(ref, ctx.newId, randomUUID()));
  if (!next) return failed();
  const nextRef = storageRef(next);
  if (ref.bucket !== "field-files" && nextRef) {
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, created_by)
      values (${ctx.newId}::uuid, ${mediaKindOf(ref.path)}, ${next}, ${ref.bucket}, ${nextRef.path}, ${fileNameOf(ref.path)},
              ${contentTypeOf(ref.path)}, 0, ${ctx.accountId}::uuid)
      on conflict (url) do nothing
    `);
  }
  return [{ url, main, next }];
}

// ---------------------------------------------------------------------------
// Rewriting what the copy holds
// ---------------------------------------------------------------------------

const keyMatch = (carrier: Carrier, row: Row) =>
  sql.join(
    carrier.keys.map((key) => sql`${col(key)}::text = ${String(row[key])}`),
    sql` and `,
  );

/** Rewrites one page's content: the blocks and backgrounds the template code knows, then whatever else holds an address. */
function rewritePage(content: unknown, sourceId: string, resolve: FileResolver): unknown {
  let value = content;
  if (typeof value === "object" && value !== null && Array.isArray((value as { rows?: unknown }).rows)) {
    try {
      value = mapTemplateMedia("page", value as PageLayout, (url) => (isStoreFile(url, sourceId) ? resolve(url) : url));
    } catch {
      // Not in the shape blocks are saved in (an old page): the plain rewrite below takes care of it.
    }
  }
  return rewriteFiles(value, sourceId, resolve);
}

async function rewriteAll(ctx: MediaCopyContext, mapped: Map<string, string | null>): Promise<void> {
  const resolve: FileResolver = (url) => mapped.get(url) ?? null;
  for (const carrier of CARRIERS) {
    const rows = await db().execute<Row>(sql`
      select ${sql.join(
        carrier.keys.map((key) => col(key)),
        sql`, `,
      )}, ${col(carrier.column)}::text as body
      from ${tbl(carrier.table)}
      where ${col(carrier.scope)} = ${ctx.newId}::uuid and ${col(carrier.column)}::text like ${like(ctx.sourceId)}
        and ${carrier.only ?? sql`true`}
    `);
    for (const row of rows) {
      const body = String(row.body);
      let update;
      if (carrier.text) {
        update = sql`${rewriteFiles(body, ctx.sourceId, resolve) ?? ""}`;
      } else {
        const parsed: unknown = JSON.parse(body);
        const next = carrier.page
          ? rewritePage(parsed, ctx.sourceId, resolve)
          : rewriteFiles(parsed, ctx.sourceId, resolve);
        // A column that is one picture (the chat agent's) is null when that picture is left out; the others are objects or lists.
        update = sql`${next === null ? (carrier.nullable ? null : Array.isArray(parsed) ? "[]" : "{}") : JSON.stringify(next)}::jsonb`;
      }
      await db().execute(sql`
        update ${tbl(carrier.table)} set ${col(carrier.column)} = ${update}
        where ${col(carrier.scope)} = ${ctx.newId}::uuid and ${keyMatch(carrier, row)}
      `);
    }
  }

  const { media, variants } = await pictureRows(ctx.newId, ctx.sourceId);
  const own = (url: unknown) => (typeof url === "string" && isStoreFile(url, ctx.sourceId) ? url : null);
  const other = (url: unknown) => (typeof url === "string" ? url : null);
  for (const row of media) {
    const url = own(row.url);
    const next = url ? (mapped.get(url) ?? null) : other(row.url);
    if (next === null) {
      // A picture that could not be copied is not the product's any more.
      await db().execute(sql`delete from commerce.product_media where id = ${String(row.id)}::uuid`);
      continue;
    }
    const thumb = own(row.thumbnail_url);
    await db().execute(sql`
      update commerce.product_media set url = ${next}, thumbnail_url = ${thumb ? (mapped.get(thumb) ?? null) : other(row.thumbnail_url)}
      where id = ${String(row.id)}::uuid
    `);
  }
  for (const row of variants) {
    const url = own(row.image_url);
    const next = url ? (mapped.get(url) ?? null) : other(row.image_url);
    const thumb = own(row.image_thumbnail_url);
    await db().execute(sql`
      update commerce.product_variants
         set image_url = ${next}, image_thumbnail_url = ${next === null ? null : thumb ? (mapped.get(thumb) ?? null) : other(row.image_thumbnail_url)}
       where id = ${String(row.id)}::uuid
    `);
  }
  // A product that lost its pictures cannot be on sale (the publishing check wants one).
  await db().execute(sql`
    update commerce.products p set status = 'draft'
    where p.store_id = ${ctx.newId}::uuid and p.status = 'active'
      and not exists (select 1 from commerce.product_media m where m.product_id = p.id)
  `);
}

// ---------------------------------------------------------------------------
// The phase
// ---------------------------------------------------------------------------

/**
 * Copies the files and rewrites the addresses, as far as the time allows (`until`, a timestamp in ms); call it
 * again to go on. It is finished when nothing of the original's is left to copy and every address is rewritten.
 */
export async function copyStoreMedia(
  ctx: MediaCopyContext,
  until: number,
  deps: MediaCopyDeps = {},
): Promise<MediaCopyState> {
  const copyFile = deps.copyFile ?? copyStoredFile;
  const found = await discover(ctx);
  let mapped = await mappingOf(ctx.copyId);
  const pending = found.filter((url) => !mapped.has(url));
  const groups = await groupsOf(ctx, pending, mapped);

  // Small copies asked for after their picture was copied take the picture's copy.
  const late = pending.filter((url) => !groups.some((group) => group.urls.some((u) => u.url === url)));
  if (late.length > 0) {
    const library = await libraryFor(ctx.sourceId, late);
    await remember(
      ctx.copyId,
      late.map((url) => ({ url, main: false, next: mapped.get(library.get(url)?.url ?? "") ?? null })),
    );
  }

  let copied = 0;
  for (const group of groups) {
    if (Date.now() >= until) break;
    await remember(ctx.copyId, await copyGroup(ctx, group, copyFile));
    copied += 1;
  }
  mapped = await mappingOf(ctx.copyId);
  const todo = groups.length - copied;

  const [counts] = await db().execute<Row>(sql`
    select count(*) filter (where main)::int as done, count(*) filter (where main and new_url is null)::int as left_out
    from commerce.store_copy_files where copy_id = ${ctx.copyId}::uuid
  `);
  const state: MediaCopyState = { done: Number(counts.done), todo, leftOut: Number(counts.left_out), finished: false };
  await db().execute(sql`
    update commerce.store_copies set media_left_out = ${state.leftOut}, updated_at = now() where id = ${ctx.copyId}::uuid
  `);
  if (todo > 0) return state;

  await rewriteAll(ctx, mapped);
  return { ...state, finished: true };
}

/**
 * A last check that nothing the copy holds names a file in the original's folder: the tables copied as settings,
 * products and pages (a table added later is checked as soon as it is listed in `COPY_RULES`). Returns the tables
 * that do, which should be none.
 */
export async function tablesPointingAtOriginal(newId: string, sourceId: string): Promise<string[]> {
  const pattern = `%/storage/v1/object/public/%/${sourceId.toLowerCase()}/%`;
  const tables = Object.entries(COPY_RULES)
    .filter(([, rule]) => ["settings", "catalogue", "pages", "derived"].includes(rule.group))
    .map(([table]) => table);
  const hits: string[] = [];
  for (const table of tables) {
    // The store itself is checked as one row; a library holds files of its own.
    if (table === "media") continue;
    const [row] = await db().execute<Row>(sql`
      select exists (select 1 from ${tbl(table)} t where t.store_id = ${newId}::uuid and to_jsonb(t)::text like ${pattern}) as hit
    `);
    if (row?.hit) hits.push(table);
  }
  const [store] = await db().execute<Row>(sql`
    select exists (select 1 from commerce.stores t where t.id = ${newId}::uuid and to_jsonb(t)::text like ${pattern}) as hit
  `);
  if (store?.hit) hits.push("stores");
  return hits;
}
