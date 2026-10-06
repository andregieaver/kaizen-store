import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { imageSize } from "@/lib/image-size";
import { ALT_MAX } from "@/lib/page-content";
import { fileNameKey, isFileNameQuery, readableFileName, type MediaKind, type MediaQuery } from "@/lib/media-query";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { normalizeQuery, prefixQuery, reciprocalRankFusion } from "@/lib/search";
import { siteUrl } from "@/lib/site";
import { vectorLiteral } from "@/lib/vectors";

import { aiFor, AiError, embedTexts, type AiConnection } from "./ai";
import { audit } from "./auth";
import { copyStoredFile, removeStoredFiles, uploadProductImage, type UploadResult } from "./media";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * The media library (D88): every picture and video a site uploads, kept in
 * `commerce.media` with its name as uploaded, type, size and measurements.
 * What uses an item is looked up where it is shown (`mediaUses()`), never
 * stored, so it is always true. Search is keyword (the name in words, the
 * description, and parts of the name by trigram) and, with the site's AI
 * (D73), meaning, merged by reciprocal rank as the storefront's search is
 * (D74); without AI, keyword alone.
 */

/**
 * Where an item is used, for people: what it is, where to change it, and
 * (D89) its full address on the site while visitors see it there, on the
 * store's own domain in its main market.
 */
export type MediaUse = { label: string; href: string | null; siteUrl?: string | null };

export type MediaItem = {
  id: string;
  kind: MediaKind;
  url: string;
  thumbnailUrl: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** Its alt text in the owner's main language, and in the others by locale (D89). */
  alt: string;
  altTranslations: Record<string, string>;
  /** Who wrote it: the site's AI or staff; null while there is none. */
  altSource: "ai" | "staff" | null;
  createdAt: string;
  uses: MediaUse[];
};

export type MediaOwner = { storeId: string | null; storeSlug: string | null };

const owned = (storeId: string | null, column = sql`store_id`) =>
  storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`;

/** A file name as people gave it, safe to show and keep. */
function cleanName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 255);
  return cleaned || fallback;
}

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

/**
 * Stores a picture the browser shrank (and its small copy) in the site's
 * folder and keeps it in the library, with the name the file had on the
 * person's computer (`name`), its size and, read from its first bytes, its
 * width and height. Every picture upload in the admin comes through here.
 */
export async function uploadToLibrary(
  owner: { storeId: string | null; accountId: string },
  data: FormData,
): Promise<UploadResult> {
  const image = data.get("image");
  const thumbnail = data.get("thumbnail");
  if (!(image instanceof File) || !(thumbnail instanceof File)) return { ok: false, problem: "Choose a picture to upload." };
  const given = data.get("name");
  return storePicture(owner, image, thumbnail, { fileName: cleanName(typeof given === "string" ? given : "", image.name || "picture") });
}

/**
 * Stores a picture and its small copy in the site's folder and keeps it in
 * the library: an upload's, or one the site's AI made (D92), which comes
 * with its alt text in the main language, marked as the AI's (the alt-text
 * run adds the other languages).
 */
export async function storePicture(
  owner: { storeId: string | null; accountId: string },
  image: File,
  thumbnail: File,
  details: { fileName: string; alt?: string },
): Promise<UploadResult> {
  const uploaded = await uploadProductImage(owner.storeId ?? "platform", image, thumbnail);
  if (!uploaded.ok || !("stored" in uploaded)) return uploaded;
  const size = imageSize(new Uint8Array(await image.slice(0, 64 * 1024).arrayBuffer()));
  const alt = details.alt?.trim().slice(0, ALT_MAX) || null;
  await db().execute(sql`
    insert into commerce.media (
      store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height, created_by,
      alt, alt_source, alt_written_at
    ) values (
      ${owner.storeId}::uuid, 'image', ${uploaded.url}, ${uploaded.thumbnailUrl}, ${uploaded.stored.bucket}, ${uploaded.stored.path},
      ${uploaded.stored.thumbnailPath}, ${cleanName(details.fileName, "picture")},
      ${image.type}, ${image.size}, ${size?.width ?? null}, ${size?.height ?? null}, ${owner.accountId}::uuid,
      ${alt ?? ""}, ${alt ? "ai" : null}, ${alt ? sql`now()` : null}
    )
    on conflict (url) do nothing
  `);
  return { ok: true, url: uploaded.url, thumbnailUrl: uploaded.thumbnailUrl };
}

/** Keeps a video in the library as its upload starts (it goes straight from the browser to Storage). */
export async function registerVideo(
  owner: { storeId: string | null; accountId: string },
  video: { url: string; bucket: string; path: string },
  file: { name?: string; type: string; size: number },
): Promise<void> {
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, created_by)
    values (
      ${owner.storeId}::uuid, 'video', ${video.url}, ${video.bucket}, ${video.path},
      ${cleanName(file.name ?? "", video.path.split("/").pop() ?? "video")}, ${file.type}, ${file.size}, ${owner.accountId}::uuid
    )
    on conflict (url) do nothing
  `);
}

/** A library item as Storage keeps it, for copying it to another owner's library (D125). */
export type LibraryFile = {
  id: string;
  kind: MediaKind;
  url: string;
  thumbnailUrl: string | null;
  bucket: string;
  path: string;
  thumbnailPath: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

/**
 * The owner's library items whose address (or small copy's) is one of `urls`, by the address asked for. Only the
 * owner's own: an address that is another owner's, or none of the library's, is not found.
 */
export async function libraryFilesByUrl(storeId: string | null, urls: string[]): Promise<Map<string, LibraryFile>> {
  const found = new Map<string, LibraryFile>();
  if (urls.length === 0) return found;
  const list = sql.join(urls.map((url) => sql`${url}`), sql`, `);
  const rows = await db().execute<Row>(sql`
    select id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height
    from commerce.media
    where ${owned(storeId)} and (url in (${list}) or thumbnail_url in (${list}))
  `);
  for (const row of rows) {
    const file: LibraryFile = {
      id: String(row.id),
      kind: row.kind as MediaKind,
      url: String(row.url),
      thumbnailUrl: row.thumbnail_url === null ? null : String(row.thumbnail_url),
      bucket: String(row.bucket),
      path: String(row.path),
      thumbnailPath: row.thumbnail_path === null ? null : String(row.thumbnail_path),
      fileName: String(row.file_name),
      contentType: String(row.content_type),
      sizeBytes: Number(row.size_bytes),
      width: row.width === null ? null : Number(row.width),
      height: row.height === null ? null : Number(row.height),
    };
    for (const url of [file.url, file.thumbnailUrl]) if (url && urls.includes(url)) found.set(url, file);
  }
  return found;
}

/**
 * Copies a file of another owner's library (a template's picture or video, D125) into this store's, in Storage and
 * in the library, under its own name; its alt texts are not copied (the picture's own in a page comes with the
 * page, and the alt-text run describes it for this store). The new item's addresses, or null if the file could not be
 * copied. `copyFile` is Storage's copy, replaceable in tests.
 */
export async function copyToLibrary(
  target: { storeId: string; accountId: string },
  file: LibraryFile,
  copyFile: typeof copyStoredFile = copyStoredFile,
): Promise<{ url: string; thumbnailUrl: string | null } | null> {
  const name = randomUUID();
  const extension = (path: string) => path.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
  const path = `${target.storeId}/${name}${extension(file.path)}`;
  const url = await copyFile(file.bucket, file.path, path);
  if (!url) return null;
  let thumbnail: { url: string; path: string } | null = null;
  if (file.thumbnailPath) {
    const thumbnailPath = `${target.storeId}/${name}-480${extension(file.thumbnailPath)}`;
    const thumbnailUrl = await copyFile(file.bucket, file.thumbnailPath, thumbnailPath);
    if (thumbnailUrl) thumbnail = { url: thumbnailUrl, path: thumbnailPath };
  }
  await db().execute(sql`
    insert into commerce.media (
      store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height, created_by
    ) values (
      ${target.storeId}::uuid, ${file.kind}, ${url}, ${thumbnail?.url ?? null}, ${file.bucket}, ${path}, ${thumbnail?.path ?? null},
      ${file.fileName}, ${file.contentType}, ${file.sizeBytes}, ${file.width}, ${file.height}, ${target.accountId}::uuid
    )
    on conflict (url) do nothing
  `);
  return { url, thumbnailUrl: thumbnail?.url ?? null };
}

// ---------------------------------------------------------------------------
// Where items are used
// ---------------------------------------------------------------------------

type UseRow = {
  media_id: string;
  source: string;
  ref_id: string | null;
  label: string | null;
  type: string | null;
  /** A product's handle or a page's address, for its address on the site. */
  slug: string | null;
  /** Whether visitors see it there: an active product, a published page with the item, the chosen header or footer. */
  live: boolean | null;
};

/** The admin's segment for each page type, as `PAGE_TYPE_COPY` has them. */
const PAGE_SEGMENTS: Record<string, string> = {
  page: "pages",
  article: "articles",
  product_layout: "product-layouts",
  header: "headers",
  footer: "footers",
};
const PAGE_NOUNS: Record<string, string> = { page: "Page", article: "Article", product_layout: "Product layout", header: "Header", footer: "Footer" };

/**
 * Everywhere the owner's items appear or are linked, by item id: products'
 * pictures and variants', pages, articles, layouts, headers and footers
 * (drafts too), menus, the logo and icon, search and sharing, the chat
 * agent's picture, the theme and saved parts. An item counts where its
 * address or its small copy's is found.
 */
export async function mediaUses(owner: MediaOwner, ids: string[]): Promise<Map<string, MediaUse[]>> {
  const uses = new Map<string, MediaUse[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return uses;
  const { storeId } = owner;
  const found = (text: ReturnType<typeof sql>) =>
    sql`(position(m.url in ${text}) > 0 or (m.thumbnail_url is not null and position(m.thumbnail_url in ${text}) > 0))`;
  const rows = await db().execute<Row>(sql`
    with m as (
      select id, url, thumbnail_url from commerce.media
      where ${owned(storeId)} and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    )
    select m.id as media_id, 'product' as source, p.id::text as ref_id,
      (select title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1) as label, null as type,
      p.handle as slug, p.status = 'active' as live
    from m join commerce.products p on ${owned(storeId, sql`p.store_id`)} and p.status <> 'archived'
    where exists (
      select 1 from commerce.product_media pm where pm.product_id = p.id and (pm.url in (m.url, m.thumbnail_url) or pm.thumbnail_url in (m.url, m.thumbnail_url))
    ) or exists (
      select 1 from commerce.product_variants v where v.product_id = p.id and (v.image_url in (m.url, m.thumbnail_url) or v.image_thumbnail_url in (m.url, m.thumbnail_url))
    )
    union all
    select m.id, 'page', pg.id::text, coalesce(nullif(pg.draft ->> 'title', ''), pg.slug), pg.type, pg.slug,
      pg.published is not null and ${found(sql`pg.published::text`)} and (pg.type not in ('header', 'footer') or pg.id in (
        ${storeId ? sql`select unnest(array[s.header_id, s.footer_id]) from commerce.stores s where s.id = ${storeId}::uuid` : sql`select unnest(array[k.header_id, k.footer_id]) from commerce.platform_settings k`}
      ))
    from m join commerce.pages pg on ${owned(storeId, sql`pg.store_id`)}
    where ${found(sql`pg.draft::text`)} or (pg.published is not null and ${found(sql`pg.published::text`)})
    union all
    select m.id, 'menu', mn.id::text, mn.name, null, null, null from m join commerce.menus mn on ${owned(storeId, sql`mn.store_id`)} where ${found(sql`mn.items::text`)}
    union all
    select m.id, 'saved', sp.id::text, sp.name, null, null, null from m join commerce.saved_parts sp on ${owned(storeId, sql`sp.store_id`)} where ${found(sql`sp.content::text`)}
    union all
    select m.id, 'chat', null, null, null, null, null from m join commerce.chat_agents c on ${owned(storeId, sql`c.store_id`)} where ${found(sql`coalesce(c.avatar::text, '')`)}
    union all
    ${
      storeId
        ? sql`
    select m.id, 'navigation', null, null, null, null, true from m join commerce.stores s on s.id = ${storeId}::uuid where ${found(sql`s.navigation::text`)}
    union all
    select m.id, 'seo', null, null, null, null, true from m join commerce.stores s on s.id = ${storeId}::uuid where ${found(sql`s.seo::text`)}
    union all
    select m.id, 'theme', null, null, null, null, null from m join commerce.stores s on s.id = ${storeId}::uuid where ${found(sql`s.theme::text`)}
    `
        : sql`
    select m.id, 'navigation', null, null, null, null, true from m join commerce.platform_settings k on true where ${found(sql`k.navigation::text`)}
    union all
    select m.id, 'seo', null, null, null, null, true from m join commerce.platform_settings k on true where ${found(sql`k.seo::text`)}
    `
    }
  `);
  const base = storeId ? `/admin/${owner.storeSlug}` : "/admin/platform";
  const site = rows.length > 0 ? await siteAddresses(owner) : null;
  for (const raw of rows as unknown as UseRow[]) {
    const list = uses.get(String(raw.media_id));
    if (!list) continue;
    list.push(describeUse(raw, base, storeId !== null, site));
  }
  return uses;
}

/**
 * Where the owner's site is, for uses' addresses on it (D89): the store's
 * own domain (P7, P8) and its main market, or Kaizen's site.
 */
type SiteAddresses = { origin: string; base: string; frontPageId: string | null; productsPageId: string | null };

async function siteAddresses(owner: MediaOwner): Promise<SiteAddresses | null> {
  if (!owner.storeId) return { origin: siteUrl(), base: "", frontPageId: null, productsPageId: null };
  const store = owner.storeSlug ? await getStore(owner.storeSlug) : null;
  const market = store?.markets[0];
  if (!store || !market) return null;
  return {
    origin: storeSiteUrl(store.slug),
    base: marketPath(store.slug, market.slug),
    frontPageId: store.frontPageId,
    productsPageId: store.productsPageId,
  };
}

/** A use's full address on the site while visitors see it there, else null. */
function siteUrlOf(row: UseRow, site: SiteAddresses | null, store: boolean): string | null {
  if (!site || !row.live) return null;
  const at = (path: string) => `${site.origin}${site.base}${path}` || "/";
  const home = at(site.base ? "" : "/");
  switch (row.source) {
    case "product":
      return store && row.slug ? at(`/p/${row.slug}`) : null;
    case "page":
      switch (row.type) {
        case "page":
          if (row.ref_id === site.frontPageId) return home;
          if (row.ref_id === site.productsPageId) return at("/products");
          return row.slug ? at(`/${row.slug}`) : null;
        case "article":
          return row.slug ? at(`/blog/${row.slug}`) : null;
        case "header":
        case "footer":
          // On every page: its front page stands for them.
          return home;
        default:
          return null;
      }
    case "navigation":
    case "seo":
      return home;
    default:
      return null;
  }
}

function describeUse(row: UseRow, base: string, store: boolean, site: SiteAddresses | null): MediaUse {
  const use = describePlace(row, base, store);
  return { ...use, siteUrl: siteUrlOf(row, site, store) };
}

function describePlace(row: UseRow, base: string, store: boolean): MediaUse {
  const label = row.label ?? "";
  switch (row.source) {
    case "product":
      return { label: `Product: ${label || "Untitled"}`, href: `${base}/products/${row.ref_id}` };
    case "page": {
      const type = row.type ?? "page";
      return { label: `${PAGE_NOUNS[type] ?? "Page"}: ${label || "Untitled"}`, href: `${base}/${PAGE_SEGMENTS[type] ?? "pages"}/${row.ref_id}` };
    }
    case "menu":
      return { label: `Menu: ${label}`, href: `${base}/menus?menu=${row.ref_id}` };
    case "saved":
      return { label: `Saved part: ${label}`, href: null };
    case "chat":
      return { label: "Chat agent's picture", href: `${base}/chat` };
    case "navigation":
      return { label: "Logo and icon (Header and footer)", href: store ? `${base}/settings/navigation` : `${base}/navigation` };
    case "seo":
      return { label: "Search and sharing picture", href: store ? `${base}/settings/seo` : `${base}/seo` };
    case "theme":
      return { label: "Design", href: `${base}/settings/design` };
    default:
      return { label: row.source, href: null };
  }
}

// ---------------------------------------------------------------------------
// Listing and searching
// ---------------------------------------------------------------------------

/** How far below the closest match a match by meaning may be, as in the storefront's search. */
const MEANING_MARGIN = 0.1;

const toItem = (row: Row): Omit<MediaItem, "uses"> => ({
  id: String(row.id),
  kind: row.kind as MediaKind,
  url: String(row.url),
  thumbnailUrl: row.thumbnail_url ? String(row.thumbnail_url) : null,
  fileName: String(row.file_name),
  contentType: String(row.content_type),
  sizeBytes: Number(row.size_bytes),
  width: row.width === null ? null : Number(row.width),
  height: row.height === null ? null : Number(row.height),
  alt: String(row.alt ?? ""),
  altTranslations: stringRecord(row.alt_translations),
  altSource: row.alt_source === "ai" || row.alt_source === "staff" ? row.alt_source : null,
  createdAt: new Date(String(row.created_at)).toISOString(),
});

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * The ids a search for a file name finds (`isFileNameQuery()`): that file,
 * then files whose names start with it, then those holding it; by name
 * alone.
 */
async function fileNameIds(storeId: string | null, text: string, limit: number): Promise<string[]> {
  const key = fileNameKey(text);
  const name = sql`lower(regexp_replace(m.file_name, '\.[a-z0-9]+$', '', 'i'))`;
  const rows = await readDb().execute<Row>(sql`
    select m.id from commerce.media m
    where ${owned(storeId, sql`m.store_id`)} and (${name} = ${key} or position(${key} in ${name}) > 0)
    order by ${name} = ${key} desc, starts_with(${name}, ${key}) desc, m.created_at desc
    limit ${limit}
  `);
  return rows.map((row) => String(row.id));
}

/** A file's name without its ending and ids, for likeness to what was typed: a stored file's id is like anything. */
const wordsOfName = sql`lower(regexp_replace(
  regexp_replace(m.file_name, '\.[a-z0-9]+$', '', 'i'),
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ' ', 'gi'
))`;

/** The ids a query finds by keyword, best first. */
async function keywordIds(storeId: string | null, text: string, limit: number): Promise<string[]> {
  const words = prefixQuery(text);
  const rows = await readDb().execute<Row>(sql`
    with q as (
      select websearch_to_tsquery('simple', ${text}) as full_q,
        ${words ? sql`to_tsquery('simple', ${words})` : sql`null::tsquery`} as prefix_q,
        ${text}::text as text
    )
    select m.id,
      coalesce(ts_rank_cd(m.search, q.full_q), 0) * 4 + coalesce(ts_rank_cd(m.search, q.prefix_q), 0) * 2
        + extensions.word_similarity(q.text, ${wordsOfName}) as score
    from commerce.media m cross join q
    where ${owned(storeId, sql`m.store_id`)}
      and (m.search @@ q.full_q or (q.prefix_q is not null and m.search @@ q.prefix_q)
        or extensions.word_similarity(q.text, ${wordsOfName}) >= 0.4)
    order by score desc, m.created_at desc
    limit ${limit}
  `);
  return rows.map((row) => String(row.id));
}

/** The ids a query finds by meaning with the site's AI, nearest first; none without AI or when it fails. */
async function meaningIds(storeId: string | null, text: string, limit: number): Promise<string[]> {
  const connection = await aiFor(storeId, { feature: "media" });
  if (!connection?.space) return [];
  try {
    const { vectors } = await embedTexts(connection, [text], 5000);
    const rows = await readDb().execute<Row>(sql`
      with q as (select ${vectorLiteral(vectors[0])}::extensions.vector as v)
      select e.media_id, 1 - (e.embedding OPERATOR(extensions.<=>) q.v) as similarity
      from commerce.media_embeddings e cross join q
      where ${owned(storeId, sql`e.store_id`)} and e.space = ${connection.space}
        and extensions.vector_dims(e.embedding) = extensions.vector_dims(q.v)
      order by similarity desc, e.media_id
      limit ${limit}
    `);
    // As the storefront's search (D74): only the close ones, near the closest.
    const best = rows.length > 0 ? Number(rows[0].similarity) : 1;
    const floor = Math.max(connection.minSimilarity, best - MEANING_MARGIN);
    return rows.filter((row) => Number(row.similarity) >= floor).map((row) => String(row.media_id));
  } catch (error) {
    if (error instanceof AiError) return [];
    throw error;
  }
}

/**
 * A page of the owner's library, with where each item is used: all of it
 * in the chosen order, or what a search finds, best first. `total` counts
 * what the list holds before the page's limit.
 */
export async function listMedia(owner: MediaOwner, query: MediaQuery): Promise<{ items: MediaItem[]; total: number; searched: boolean }> {
  const { storeId } = owner;
  const text = normalizeQuery(query.q);
  const kindFilter = query.kind === "all" ? sql`true` : sql`m.kind = ${query.kind}`;
  let rows: Row[];
  let total: number;
  if (text) {
    // Both lists deep enough that the kind filter still leaves a page.
    const depth = Math.max(query.limit * 2, 100);
    // A file's name finds that file by its name alone; anything else by keyword and meaning.
    const ranked = isFileNameQuery(text)
      ? await fileNameIds(storeId, text, depth)
      : reciprocalRankFusion(await Promise.all([keywordIds(storeId, text, depth), meaningIds(storeId, text, depth)]));
    if (ranked.length === 0) return { items: [], total: 0, searched: true };
    const found = await readDb().execute<Row>(sql`
      select m.* from commerce.media m
      where ${owned(storeId, sql`m.store_id`)} and ${kindFilter}
        and m.id in (${sql.join(ranked.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    const byId = new Map<string, Row>(found.map((row) => [String(row.id), row]));
    const ordered = ranked.flatMap((id): Row[] => { const row = byId.get(id); return row ? [row] : []; });
    total = ordered.length;
    rows = ordered.slice(0, query.limit);
  } else {
    const order = {
      newest: sql`m.created_at desc`,
      oldest: sql`m.created_at asc`,
      largest: sql`m.size_bytes desc, m.created_at desc`,
      name: sql`lower(m.file_name) asc, m.created_at desc`,
    }[query.sort];
    rows = await readDb().execute<Row>(sql`
      select m.*, count(*) over () as total from commerce.media m
      where ${owned(storeId, sql`m.store_id`)} and ${kindFilter}
      order by ${order}
      limit ${query.limit}
    `);
    total = rows.length > 0 ? Number(rows[0].total) : 0;
  }
  const items = rows.map(toItem);
  const uses = await mediaUses(owner, items.map((item) => item.id));
  return { items: items.map((item) => ({ ...item, uses: uses.get(item.id) ?? [] })), total, searched: Boolean(text) };
}

// ---------------------------------------------------------------------------
// Changing and deleting
// ---------------------------------------------------------------------------

/** A language code as the site's markets have them: `nb-NO`, `en`. */
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

/**
 * Staff's alt text for an item (D89): its main language's and the others'
 * by locale, kept as staff's (the AI never writes over it). All empty
 * clears it. False if the item is not the owner's.
 */
export async function describeMedia(
  owner: MediaOwner,
  accountId: string,
  id: string,
  texts: { alt: string; translations: Record<string, string> },
): Promise<boolean> {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, ALT_MAX);
  const alt = clean(texts.alt);
  const translations = Object.fromEntries(
    Object.entries(texts.translations)
      .filter(([locale, value]) => LOCALE.test(locale) && typeof value === "string")
      .map(([locale, value]) => [locale, clean(value)] as const)
      .filter(([, value]) => value !== ""),
  );
  const written = alt !== "" || Object.keys(translations).length > 0;
  const rows = await db().execute<Row>(sql`
    update commerce.media set alt = ${alt}, alt_translations = ${JSON.stringify(translations)}::jsonb,
      alt_source = ${written ? "staff" : null}, alt_written_at = ${written ? sql`now()` : null}, updated_at = now()
    where id = ${id}::uuid and ${owned(owner.storeId)} returning id
  `);
  if (rows.length === 0) return false;
  await audit(accountId, owner.storeId, owner.storeId ? "store.media_described" : "platform.media_described", { mediaId: id });
  return true;
}

/** Keeps the width and height the library measured, for an item that has none yet. */
export async function measureMedia(owner: MediaOwner, id: string, width: number, height: number): Promise<void> {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width < 100_000 && height < 100_000)) return;
  await db().execute(sql`
    update commerce.media set width = ${width}, height = ${height}
    where id = ${id}::uuid and ${owned(owner.storeId)} and width is null
  `);
}

/**
 * Deletes an item and its files. Places that use it show nothing where it
 * was; the library says where before asking. False if it is not the
 * owner's, or Storage would not remove the files (then it is kept).
 */
export async function deleteMedia(owner: MediaOwner, accountId: string, id: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const [row] = await db().execute<Row>(sql`
    select bucket, path, thumbnail_path, file_name from commerce.media where id = ${id}::uuid and ${owned(owner.storeId)}
  `);
  if (!row) return { ok: false, problem: "That file is no longer in the library." };
  const paths = [String(row.path), ...(row.thumbnail_path ? [String(row.thumbnail_path)] : [])];
  if (!(await removeStoredFiles(String(row.bucket), paths))) {
    return { ok: false, problem: "The file could not be removed from storage. Try again." };
  }
  await db().execute(sql`delete from commerce.media where id = ${id}::uuid`);
  await audit(accountId, owner.storeId, owner.storeId ? "store.media_deleted" : "platform.media_deleted", {
    mediaId: id,
    fileName: String(row.file_name),
  });
  return { ok: true };
}

/** The most files one request deletes: the library asks again for the rest of a larger choice. */
export const MEDIA_DELETE_MAX = 100;

/**
 * Deletes several items and their files at once (the library's bulk delete: a page copy adds a picture for every part it could not build from boxes, and they fill the
 * library fast). Same rules as `deleteMedia()`: only the owner's, a file Storage will not remove is kept, and places that use one show nothing where it was. One audit entry
 * for the whole request. Gives how many were deleted and how many were kept (not the owner's, or Storage refused).
 */
export async function deleteMediaMany(owner: MediaOwner, accountId: string, ids: string[]): Promise<{ deleted: number; kept: number; problem?: string }> {
  const wanted = [...new Set(ids)].slice(0, MEDIA_DELETE_MAX);
  if (wanted.length === 0) return { deleted: 0, kept: 0 };
  const rows = await db().execute<Row>(sql`
    select id, bucket, path, thumbnail_path, file_name from commerce.media
    where id in (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)}) and ${owned(owner.storeId)}
  `);
  const byBucket = new Map<string, Row[]>();
  for (const row of rows) byBucket.set(String(row.bucket), [...(byBucket.get(String(row.bucket)) ?? []), row]);
  const removed: string[] = [];
  for (const [bucket, group] of byBucket) {
    const paths = group.flatMap((row) => [String(row.path), ...(row.thumbnail_path ? [String(row.thumbnail_path)] : [])]);
    if (await removeStoredFiles(bucket, paths)) removed.push(...group.map((row) => String(row.id)));
  }
  if (removed.length > 0) {
    await db().execute(sql`delete from commerce.media where id in (${sql.join(removed.map((id) => sql`${id}::uuid`), sql`, `)}) and ${owned(owner.storeId)}`);
    await audit(accountId, owner.storeId, owner.storeId ? "store.media_deleted" : "platform.media_deleted", {
      count: removed.length,
      mediaIds: removed,
      fileNames: rows.filter((row) => removed.includes(String(row.id))).slice(0, 20).map((row) => String(row.file_name)),
    });
  }
  const kept = wanted.length - removed.length;
  return { deleted: removed.length, kept, ...(kept > 0 ? { problem: "Some files could not be removed from storage or are no longer in the library. Try again." } : {}) };
}

// ---------------------------------------------------------------------------
// Vectors for search by meaning
// ---------------------------------------------------------------------------

const BATCH = 32;
const PER_RUN = 128;

/**
 * What an item's vector is made from: its alt text in every language (what
 * it shows, D89), its name where it is words rather than an id, and the
 * names of what uses it. Empty when there is nothing that says what it is.
 */
export function mediaDocument(fileName: string, alt: string, translations: Record<string, string>, uses: MediaUse[]): string {
  const alts = [...new Set([alt, ...Object.values(translations)].map((text) => text.trim()).filter(Boolean))];
  const name = readableFileName(fileName);
  if (alts.length === 0 && !name) return "";
  return [...alts, name, uses.length > 0 ? `Used in: ${uses.map((use) => use.label).join("; ")}` : ""].filter(Boolean).join("\n");
}

/**
 * Whether an item has words to be found by meaning: an alt text, or a
 * name that is not only an id (as `readableFileName()`, in SQL).
 */
const described = sql`(m.alt <> '' or m.alt_translations <> '{}'::jsonb or regexp_replace(
  regexp_replace(m.file_name, '\.[a-z0-9]+$', '', 'i'),
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ' ', 'gi'
) ~ '(^|[^[:alnum:]])[[:alpha:]]{2,}([^[:alnum:]]|$)')`;

/**
 * Gives a site's items vectors from its AI where they have none from its
 * current model, where the item changed since, or once a day (so what uses
 * an item is kept current); unchanged text keeps its vector.
 */
export async function embedMedia(owner: MediaOwner, connection: AiConnection, limit = PER_RUN): Promise<{ embedded: number; failed: string | null }> {
  const space = connection.space;
  if (!space) return { embedded: 0, failed: null };
  // Items with nothing that says what they are have no vector: an id's likeness to other ids means nothing.
  await db().execute(sql`
    delete from commerce.media_embeddings e using commerce.media m
    where e.media_id = m.id and ${owned(owner.storeId, sql`m.store_id`)} and not ${described}
  `);
  const stale = await db().execute<Row>(sql`
    select m.id, m.file_name, m.alt, m.alt_translations, e.content_hash from commerce.media m
    left join commerce.media_embeddings e on e.media_id = m.id
    where ${owned(owner.storeId, sql`m.store_id`)} and ${described}
      and (e.media_id is null or e.space <> ${space} or e.updated_at < m.updated_at or e.updated_at < now() - interval '1 day')
    order by e.updated_at nulls first, m.created_at
    limit ${limit}
  `);
  if (stale.length === 0) return { embedded: 0, failed: null };
  const uses = await mediaUses(owner, stale.map((row) => String(row.id)));
  const docs = stale
    .map((row) => {
      const text = mediaDocument(String(row.file_name), String(row.alt), stringRecord(row.alt_translations), uses.get(String(row.id)) ?? []);
      return { id: String(row.id), text, previous: row.content_hash ? String(row.content_hash) : null };
    })
    .filter((doc) => doc.text !== "");
  const hash = (text: string) => createHash("md5").update(`${space}\u001f${text}`).digest("hex");
  // Unchanged texts only have their date moved on; the rest are embedded.
  const unchanged = docs.filter((doc) => doc.previous === hash(doc.text));
  if (unchanged.length > 0) {
    await db().execute(sql`
      update commerce.media_embeddings set updated_at = now()
      where space = ${space} and media_id in (${sql.join(unchanged.map((doc) => sql`${doc.id}::uuid`), sql`, `)})
    `);
  }
  const changed = docs.filter((doc) => doc.previous !== hash(doc.text));
  let embedded = 0;
  for (let start = 0; start < changed.length; start += BATCH) {
    const batch = changed.slice(start, start + BATCH);
    try {
      const { vectors } = await embedTexts(connection, batch.map((doc) => doc.text));
      await db().execute(sql`
        insert into commerce.media_embeddings (media_id, store_id, space, content_hash, embedding)
        values ${sql.join(
          batch.map(
            (doc, i) =>
              sql`(${doc.id}::uuid, ${owner.storeId}::uuid, ${space}, ${hash(doc.text)}, ${vectorLiteral(vectors[i])}::extensions.vector)`,
          ),
          sql`, `,
        )}
        on conflict (media_id) do update set
          space = excluded.space, content_hash = excluded.content_hash, embedding = excluded.embedding, updated_at = now()
      `);
      embedded += batch.length;
    } catch (error) {
      const message = error instanceof AiError ? error.message : String(error);
      console.warn(`[media] embedding failed (${connection.source} AI, ${space}): ${message}`);
      return { embedded, failed: message };
    }
  }
  return { embedded, failed: null };
}

/** The cron's share: each site with media and an AI brings its library's vectors up to date. */
export async function refreshMediaEmbeddings(): Promise<{ sites: number; embedded: number }> {
  const owners = await db().execute<Row>(sql`
    select distinct m.store_id, s.slug from commerce.media m left join commerce.stores s on s.id = m.store_id
    where m.store_id is null or s.status = 'active'
  `);
  let embedded = 0;
  for (const row of owners) {
    const owner = { storeId: row.store_id ? String(row.store_id) : null, storeSlug: row.slug ? String(row.slug) : null };
    try {
      const connection = await aiFor(owner.storeId, { feature: "media" });
      if (connection) embedded += (await embedMedia(owner, connection)).embedded;
    } catch (error) {
      console.warn(`[media] refresh failed for ${owner.storeSlug ?? "Kaizen"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { sites: owners.length, embedded };
}
