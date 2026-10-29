import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { imageSize } from "@/lib/image-size";
import { COMPRESS_WORTH, compressPlan, keepsOriginal } from "@/lib/media-compress";

import { audit } from "./auth";
import { log } from "./log";
import { removeStoredFiles, startVideoUpload, storedVideo, uploadProductImage, type VideoUpload } from "./media";
import { mediaUses, type MediaOwner } from "./media-library";

/**
 * The media library's Compress (D213): a file uploaded before compressing was measured is made smaller in the person's
 * browser (`compressPicture()`, `compressVideo()`), uploaded beside the original, and takes its place here. Pictures are
 * kept for a year under their address by browsers and the CDN, so a smaller file cannot overwrite the original: it gets an
 * address of its own and every place that can be edited is moved to it in one transaction (`rewriteAddresses()`). The
 * original is then removed from Storage, unless the file was used where it leaves the site (`keepsOriginal()`) or something
 * that is not moved names it (`namedInRecords()`: terms a shopper accepted, a store template's or design profile's picture).
 */

export type CompressOutcome = { ok: true; before: number; after: number; keptOriginal: boolean } | { ok: false; problem: string };

type Row = Record<string, unknown>;

type Current = {
  id: string;
  kind: "image" | "video";
  url: string;
  thumbnailUrl: string | null;
  bucket: string;
  path: string;
  thumbnailPath: string | null;
  contentType: string;
  sizeBytes: number;
  compressedAt: string | null;
};

type Next = {
  url: string;
  thumbnailUrl: string | null;
  path: string;
  thumbnailPath: string | null;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

const owned = (storeId: string | null, column = sql`store_id`) => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`);

const GONE = "That file is no longer in the library.";

async function current(owner: MediaOwner, id: string): Promise<Current | null> {
  const [row] = await db().execute<Row>(sql`
    select id, kind, url, thumbnail_url, bucket, path, thumbnail_path, content_type, size_bytes, compressed_at
    from commerce.media where id = ${id}::uuid and ${owned(owner.storeId)}
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind === "video" ? "video" : "image",
    url: String(row.url),
    thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
    bucket: String(row.bucket),
    path: String(row.path),
    thumbnailPath: row.thumbnail_path ? String(row.thumbnail_path) : null,
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    compressedAt: row.compressed_at ? String(row.compressed_at) : null,
  };
}

/** Why the file may not be compressed (as the library decides, asked again here), or null. */
async function refusal(owner: MediaOwner, file: Current, avif: boolean): Promise<string | null> {
  const uses = (await mediaUses(owner, [file.id])).get(file.id) ?? [];
  const plan = compressPlan({ kind: file.kind, contentType: file.contentType, compressedAt: file.compressedAt, uses });
  if (!plan.offered) return plan.why;
  if (avif && !plan.avif) return "This picture is used outside the site's pages, so it stays a WebP.";
  return null;
}

/** Whether a result is not worth keeping: empty, or not clearly smaller than the original (whose size older rows may lack). */
const tooLarge = (file: Current, size: number) => !(size > 0) || (file.sizeBytes > 0 && size > file.sizeBytes * COMPRESS_WORTH);

/** A picture the browser compressed takes the original's place. */
export async function replacePicture(owner: MediaOwner, accountId: string, id: string, image: File, thumbnail: File): Promise<CompressOutcome> {
  const file = await current(owner, id);
  if (!file || file.kind !== "image") return { ok: false, problem: GONE };
  const refused = await refusal(owner, file, image.type === "image/avif");
  if (refused) return { ok: false, problem: refused };
  if (tooLarge(file, image.size)) return { ok: false, problem: "It is already about as small as it can be while it looks the same." };
  const uploaded = await uploadProductImage(owner.storeId ?? "platform", image, thumbnail);
  if (!uploaded.ok || !("stored" in uploaded)) return uploaded.ok ? { ok: false, problem: "The smaller file could not be stored." } : uploaded;
  const size = imageSize(new Uint8Array(await image.slice(0, 64 * 1024).arrayBuffer()));
  return swap(owner, accountId, file, {
    url: uploaded.url,
    thumbnailUrl: uploaded.thumbnailUrl,
    path: uploaded.stored.path,
    thumbnailPath: uploaded.stored.thumbnailPath,
    contentType: image.type,
    sizeBytes: image.size,
    width: size?.width ?? null,
    height: size?.height ?? null,
  });
}

/** The folder a site's videos are kept in, as their uploads are started. */
const videoFolder = (owner: MediaOwner) => owner.storeId ?? "platform";

/** Lets the browser upload a compressed video beside the original (not kept in the library: it replaces one). */
export async function startVideoReplacement(owner: MediaOwner, id: string, video: { type: string; size: number }): Promise<VideoUpload> {
  const file = await current(owner, id);
  if (!file || file.kind !== "video") return { ok: false, problem: GONE };
  const refused = await refusal(owner, file, false);
  if (refused) return { ok: false, problem: refused };
  if (tooLarge(file, video.size)) return { ok: false, problem: "It is already about as small as it can be while it looks the same." };
  return startVideoUpload(videoFolder(owner), video);
}

/** A compressed video the browser uploaded takes the original's place, once Storage shows it is there and smaller. */
export async function replaceVideo(owner: MediaOwner, accountId: string, id: string, path: string): Promise<CompressOutcome> {
  const file = await current(owner, id);
  if (!file || file.kind !== "video") return { ok: false, problem: GONE };
  if (!path.startsWith(`${videoFolder(owner)}/`) || path.includes("..") || path === file.path) return { ok: false, problem: "That upload is not this site's." };
  // A replacement is a file no library item has: a path the library knows is another video, never to be moved or removed here.
  const [known] = await db().execute<Row>(sql`select 1 from commerce.media where bucket = ${file.bucket} and path = ${path} limit 1`);
  if (known) return { ok: false, problem: "That upload is not this site's." };
  const stored = await storedVideo(path);
  if (!stored) return { ok: false, problem: "The smaller video did not arrive. Try again." };
  if (tooLarge(file, stored.size)) {
    await removeStoredFiles(file.bucket, [path]);
    return { ok: false, problem: "It is already about as small as it can be while it looks the same." };
  }
  return swap(owner, accountId, file, {
    url: stored.url,
    thumbnailUrl: null,
    path,
    thumbnailPath: null,
    contentType: stored.type || "video/mp4",
    sizeBytes: stored.size,
    width: null,
    height: null,
  });
}

async function swap(owner: MediaOwner, accountId: string, file: Current, next: Next): Promise<CompressOutcome> {
  const usesBefore = (await mediaUses(owner, [file.id])).get(file.id) ?? [];
  const pairs: [string, string][] = [[file.url, next.url]];
  if (file.thumbnailUrl && next.thumbnailUrl) pairs.push([file.thumbnailUrl, next.thumbnailUrl]);
  const swapped = await db()
    .transaction(async (tx) => {
    const [locked] = await tx.execute<Row>(sql`
      select url from commerce.media where id = ${file.id}::uuid and ${owned(owner.storeId)} for update
    `);
    if (!locked || String(locked.url) !== file.url) return false;
    await tx.execute(sql`
      update commerce.media set
        url = ${next.url}, thumbnail_url = ${next.thumbnailUrl ?? file.thumbnailUrl}, path = ${next.path},
        thumbnail_path = ${next.thumbnailPath ?? file.thumbnailPath}, content_type = ${next.contentType}, size_bytes = ${next.sizeBytes},
        width = coalesce(${next.width}, width), height = coalesce(${next.height}, height), compressed_at = now(), updated_at = now()
      where id = ${file.id}::uuid
    `);
    for (const statement of rewriteAddresses(owner.storeId, pairs)) await tx.execute(statement);
    return true;
  })
    .catch((error: unknown) => {
      // A rule of the database refused a place's change (a product's, say): nothing moved, and the new files go.
      log("error", "media.compressed_swap_failed", {}, error);
      return false;
    });
  if (!swapped) {
    await removeStoredFiles(file.bucket, [next.path, ...(next.thumbnailPath ? [next.thumbnailPath] : [])]);
    return { ok: false, problem: "The file could not take the original's place, so nothing changed. Try again." };
  }
  const keptOriginal = keepsOriginal(usesBefore) || (await namedInRecords(owner.storeId, [file.url, file.thumbnailUrl]));
  if (!keptOriginal) {
    // A video's thumbnail is its own library picture, not this row's: only a picture's small copy goes with it.
    const replacedThumbnail = next.thumbnailPath && file.thumbnailPath ? [file.thumbnailPath] : [];
    await removeStoredFiles(file.bucket, [file.path, ...replacedThumbnail]);
  }
  await auditCompressed(owner, accountId, file, next.sizeBytes, keptOriginal);
  return { ok: true, before: file.sizeBytes, after: next.sizeBytes, keptOriginal };
}

/** A JSON or text column with every old address replaced by its new one. */
function replaced(column: SQL, pairs: [string, string][], cast: "jsonb" | "text"): SQL {
  let text: SQL = cast === "jsonb" ? sql`${column}::text` : sql`${column}`;
  for (const [from, to] of pairs) text = sql`replace(${text}, ${from}, ${to})`;
  return cast === "jsonb" ? sql`(${text})::jsonb` : text;
}

/** Whether the column mentions any old address. */
function mentions(column: SQL, pairs: [string, string][], cast: "jsonb" | "text"): SQL {
  const text = cast === "jsonb" ? sql`coalesce(${column}::text, '')` : sql`coalesce(${column}, '')`;
  return sql.join(
    pairs.map(([from]) => sql`position(${from} in ${text}) > 0`),
    sql` or `,
  );
}

/**
 * Every place that can be edited and may hold a library file's address, moved from the old addresses to the new: what
 * `mediaUses()` reads, and custom field values, categories' and tags' sharing pictures, reminder emails and the site's own
 * CSS. A new place that keeps a library file's address is added here and to `mediaUses()`. Store templates' and design
 * profiles' pictures are written only by their own modules (D176, D177), so a file they name keeps its original
 * (`namedInRecords()`).
 */
export function rewriteAddresses(storeId: string | null, pairs: [string, string][]): SQL[] {
  const json = (table: SQL, column: SQL, where: SQL = sql`true`) =>
    sql`update ${table} set ${column} = ${replaced(column, pairs, "jsonb")} where ${owned(storeId)} and ${where} and (${mentions(column, pairs, "jsonb")})`;
  const exact = (table: SQL, column: SQL) =>
    pairs.map(([from, to]) => sql`update ${table} set ${column} = ${to} where ${owned(storeId)} and ${column} = ${from}`);
  const statements: SQL[] = [
    ...exact(sql`commerce.product_media`, sql`url`),
    ...exact(sql`commerce.product_media`, sql`thumbnail_url`),
    ...exact(sql`commerce.product_media`, sql`media_url`),
    ...exact(sql`commerce.product_variants`, sql`image_url`),
    ...exact(sql`commerce.product_variants`, sql`image_thumbnail_url`),
    json(sql`commerce.pages`, sql`draft`),
    json(sql`commerce.pages`, sql`published`, sql`published is not null`),
    json(sql`commerce.menus`, sql`items`),
    json(sql`commerce.saved_parts`, sql`content`),
    json(sql`commerce.chat_agents`, sql`avatar`, sql`avatar is not null`),
    json(sql`commerce.terms`, sql`seo`),
    // A category's or tag's own picture (wave 6 unit A, D319).
    ...exact(sql`commerce.terms`, sql`image_url`),
    ...exact(sql`commerce.terms`, sql`image_thumbnail_url`),
    // An author's picture (D341).
    ...exact(sql`commerce.blog_authors`, sql`picture_url`),
    json(sql`commerce.field_values`, sql`values`),
    // A content entry's values (D326), its draft and what is published.
    json(sql`commerce.content_entries`, sql`draft`),
    json(sql`commerce.content_entries`, sql`published`, sql`published is not null`),
    json(sql`commerce.cart_reminder_steps`, sql`content`),
    // The look a store's installed theme keeps while it is not live (D241): its theme and CSS name the same files.
    ...(storeId ? [json(sql`commerce.store_theme_installs`, sql`look`, sql`look is not null`)] : []),
  ];
  // Kaizena Flow's own installed themes keep their looks the same way (`docs/theme-phase-4.md`); the table has no store column.
  if (!storeId) {
    statements.push(
      sql`update commerce.platform_theme_installs set look = ${replaced(sql`look`, pairs, "jsonb")} where look is not null and (${mentions(sql`look`, pairs, "jsonb")})`,
    );
  }
  const settings = storeId ? sql`commerce.stores` : sql`commerce.platform_settings`;
  const which = storeId ? sql`id = ${storeId}::uuid` : sql`true`;
  // Kaizena Flow's theme too (D235): its pictures are its library's as a store's are the store's.
  for (const column of [sql`navigation`, sql`seo`, sql`theme`]) {
    statements.push(sql`update ${settings} set ${column} = ${replaced(column, pairs, "jsonb")} where ${which} and (${mentions(column, pairs, "jsonb")})`);
  }
  statements.push(
    sql`update ${settings} set custom_css = ${replaced(sql`custom_css`, pairs, "text")} where ${which} and (${mentions(sql`custom_css`, pairs, "text")})`,
  );
  return statements;
}

/**
 * Whether something that is not moved names any of the addresses, so the original stays where it is: terms a shopper accepted
 * (a terms page's pictures are in their snapshot, which never changes), and for Kaizen's library a store template's or design
 * profile's picture (its main one, its listing's further pictures and its own in place of made ones, in its draft too). Invoices and
 * credit notes hold no picture.
 */
async function namedInRecords(storeId: string | null, addresses: (string | null)[]): Promise<boolean> {
  const list = addresses.filter((address): address is string => Boolean(address));
  if (list.length === 0) return false;
  const any = (column: SQL) => sql.join(list.map((address) => sql`position(${address} in coalesce(${column}::text, '')) > 0`), sql` or `);
  const [row] = await db().execute<Row>(
    storeId
      ? sql`
        select exists (select 1 from commerce.legal_snapshots where store_id = ${storeId}::uuid and (${any(sql`content`)}))
          or exists (select 1 from commerce.order_terms where store_id = ${storeId}::uuid and (${any(sql`snapshots`)})) as named
      `
      : sql`
        select exists (select 1 from commerce.store_starters where ${any(sql`picture_url`)})
          or exists (select 1 from commerce.design_presets where ${any(sql`picture_url`)} or ${any(sql`snapshot`)} or ${any(sql`listing`)} or ${any(sql`draft`)}) as named
      `,
  );
  return row?.named === true;
}

async function auditCompressed(owner: MediaOwner, accountId: string, file: Current, after: number, keptOriginal: boolean): Promise<void> {
  await audit(accountId, owner.storeId, owner.storeId ? "store.media_compressed" : "platform.media_compressed", {
    mediaId: file.id,
    before: file.sizeBytes,
    after,
    keptOriginal,
  });
}
