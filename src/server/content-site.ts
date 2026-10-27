import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { readDb } from "@/db/client";
import { EMPTY_GRID, type GridData, type GridItem } from "@/lib/content-grid";
import {
  contentTag,
  entryPicture,
  entrySummary,
  entryTitle,
  readEntryContent,
  typeAsGroup,
  type ContentType,
  type EntryContent,
} from "@/lib/content-types";
import { shownGroup } from "@/lib/custom-fields";
import { t } from "@/lib/i18n";
import { pageLocaleOf, platformPath, PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { parsePageContent, type PageContent } from "@/lib/page-content";
import { marketPath } from "@/lib/paths";
import { summarize } from "@/lib/seo";
import { tileLines } from "@/lib/tile-fields";

import { contentTypeByKey, getContentType } from "./content-types";
import { pagesTag } from "./pages";
import { getOpenStore, storeTag } from "./stores";
import { marketIn } from "./shop";
import { col, typedRows } from "./typed-rows";

/**
 * Content entries on the site (wave 6 unit H2, D326): what a grid of a type's entries lists. Only published entries are read, by the
 * owner (a store, or Kaizena Flow's own site: null), cached under the owner's content tag, which every writer refreshes.
 */

const EXCERPT_MAX = 300;

/** The language a grid is drawn in and the address an entry's page has there, for a store's market or Kaizena Flow's own site. */
async function siteOf(owner: string | null, marketCode: string | null, lang: PlatformLang) {
  if (owner === null) {
    const locale = pageLocaleOf(lang) ?? "en";
    return { main: "en", locale, lang: PLATFORM_LANG_FACTS[lang].messages, gridLocale: PLATFORM_LANG_FACTS[lang].locale, path: (p: string) => platformPath(lang, p) };
  }
  const [row] = await readDb().execute<Record<string, unknown>>(sql`select slug from commerce.stores where id = ${owner}::uuid`);
  if (!row) return null;
  cacheTag(storeTag(String(row.slug)));
  const store = await getOpenStore(String(row.slug));
  const market = store && marketIn(store, marketCode);
  if (!store || !market) return null;
  return {
    main: store.localization.locales[0] ?? market.locale,
    locale: market.locale,
    lang: market.lang,
    gridLocale: market.locale,
    path: (p: string) => marketPath(store.slug, market.slug, p),
  };
}

/** The order a grid of entries asks for, in SQL: newest or oldest by first publishing, by title in the main language, or the owner's. */
function entryOrder(sort: string, type: ContentType, main: string) {
  const title = sql`lower(e.published -> 'data' -> 'translations' -> ${main} ->> ${type.titleField})`;
  switch (sort) {
    case "oldest":
      return sql`e.first_published_at, e.slug`;
    case "title":
      return sql`${title} nulls last, e.slug`;
    case "manual":
      return sql`e.position, e.slug`;
    default:
      return sql`e.first_published_at desc, e.slug`;
  }
}

/**
 * The published entries of one of the owner's types for a content grid (D326): its title field as the tile's heading, its summary as the
 * excerpt, its picture, its page when its type has pages, and up to three of its public plain fields as tile lines.
 */
export async function gridEntries(
  owner: string | null,
  marketCode: string | null,
  key: string,
  filter: { sort: string; limit: number; tileFields: string[] },
  lang: PlatformLang = "en",
): Promise<GridData> {
  "use cache";
  cacheLife("hours");
  cacheTag(contentTag(owner));
  const site = await siteOf(owner, marketCode, lang);
  if (!site) return { ...EMPTY_GRID };
  const language = { lang: site.lang, locale: site.gridLocale };
  const type = await contentTypeByKey(owner, key, readDb());
  if (!type) return { items: [], ...language };
  const rows = await typedRows(
    z.object({ id: col.uuid, slug: col.text, published: z.unknown() }),
    sql`
      select e.id, e.slug, e.published from commerce.content_entries e
      where e.store_id is not distinct from ${owner}::uuid and e.type_id = ${type.id}::uuid and e.published is not null
      order by ${entryOrder(filter.sort, type, site.main)}
      limit ${Math.max(1, Math.min(48, filter.limit))}
    `,
    readDb(),
  );
  const m = t(site.lang);
  const words = { yes: m.customFields.yes, no: m.customFields.no };
  const group = typeAsGroup(type);
  const items = rows.map((row): GridItem => {
    const { data } = readEntryContent(row.published);
    const picture = entryPicture(type, data);
    const title = entryTitle(type, data, site.locale, site.main) || row.slug;
    const fields = filter.tileFields.length > 0 ? tileLines([shownGroup(group, data, site.locale, site.main, words, { publicOnly: true })], filter.tileFields) : [];
    return {
      id: row.id,
      href: type.hasPages ? site.path(`/${type.slug}/${row.slug}`) : "",
      title,
      excerpt: summarize(entrySummary(type, data, site.locale, site.main), EXCERPT_MAX),
      image: picture ? { url: picture.url, alt: picture.alt || title } : null,
      price: null,
      ...(fields.length > 0 && { fields }),
    };
  });
  return { items, ...language };
}

/** A published entry at its page's address, with its type and the layout its type draws it with (D326). */
export type EntryPage = {
  type: ContentType;
  entry: { id: string; slug: string; content: EntryContent; publishedAt: string; firstPublishedAt: string };
  /** The type's published entry layout; null: the standard entry view. */
  layout: PageContent | null;
};

/**
 * The published entry at `/{type}/{entry}` of the owner, while its type has pages; null otherwise (the route then answers as a miss, so a
 * redirect from an old address can take over). Cached under the owner's content and pages tags.
 */
export async function findEntryPage(owner: string | null, typeSlug: string, entrySlug: string): Promise<EntryPage | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(contentTag(owner), pagesTag(owner));
  const [row] = await typedRows(
    z.object({ id: col.uuid, slug: col.text, published: z.unknown(), published_at: col.timestamp, first_published_at: col.timestamp, type_id: col.uuid }),
    sql`
      select e.id, e.slug, e.published, e.published_at, e.first_published_at, e.type_id
      from commerce.content_entries e join commerce.content_types t on t.id = e.type_id
      where e.store_id is not distinct from ${owner}::uuid and t.slug = ${typeSlug} and t.has_pages
        and e.slug = ${entrySlug} and e.published is not null
    `,
    readDb(),
  );
  if (!row) return null;
  const type = await getContentType(owner, row.type_id, readDb());
  if (!type) return null;
  let layout: PageContent | null = null;
  if (type.layoutId) {
    const [page] = await readDb().execute<Record<string, unknown>>(sql`
      select published from commerce.pages
      where id = ${type.layoutId}::uuid and store_id is not distinct from ${owner}::uuid and type = 'entry_layout' and published_at is not null
    `);
    layout = page ? parsePageContent(page.published) : null;
  }
  return {
    type,
    entry: {
      id: row.id,
      slug: row.slug,
      content: readEntryContent(row.published),
      publishedAt: row.published_at,
      firstPublishedAt: row.first_published_at,
    },
    layout,
  };
}

/**
 * The owner's published entries that have pages, for the sitemap (D326): each entry's address part (`{type}/{entry}`) and when it last
 * changed. At most `limit`, oldest first so a sitemap that cuts keeps the same entries.
 */
export async function listIndexedEntries(owner: string | null, limit = 10_000): Promise<{ path: string; updatedAt: string }[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(contentTag(owner));
  const rows = await typedRows(
    z.object({ type_slug: col.text, slug: col.text, published_at: col.timestamp }),
    sql`
      select t.slug as type_slug, e.slug, e.published_at
      from commerce.content_entries e join commerce.content_types t on t.id = e.type_id
      where e.store_id is not distinct from ${owner}::uuid and t.has_pages and e.published is not null
      order by e.first_published_at, e.id
      limit ${limit}
    `,
    readDb(),
  );
  return rows.map((row) => ({ path: `${row.type_slug}/${row.slug}`, updatedAt: row.published_at }));
}
