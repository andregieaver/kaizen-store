import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { pageImageUrls, withLibraryAlts, type LibraryAlt } from "@/lib/page-images";
import type { PageContent } from "@/lib/page-content";

type Row = Record<string, unknown>;

/**
 * The media library's alt texts (D89) for pictures by address, either the
 * file's or its small copy's; by address alone, as `commerce.media_alt()`,
 * so a store copied from the template describes the template's pictures.
 */
export async function libraryAlts(urls: string[]): Promise<Map<string, LibraryAlt>> {
  const wanted = [...new Set(urls.filter(Boolean))];
  const alts = new Map<string, LibraryAlt>();
  if (wanted.length === 0) return alts;
  const list = sql.join(wanted.map((url) => sql`${url}`), sql`, `);
  const rows = await readDb().execute<Row>(sql`
    select url, thumbnail_url, alt, alt_translations from commerce.media
    where (url in (${list}) or thumbnail_url in (${list})) and (alt <> '' or alt_translations <> '{}'::jsonb)
  `);
  for (const row of rows) {
    const translations = (row.alt_translations ?? {}) as Record<string, string>;
    const alt = { alt: String(row.alt ?? ""), translations };
    alts.set(String(row.url), alt);
    if (row.thumbnail_url) alts.set(String(row.thumbnail_url), alt);
  }
  return alts;
}

/** Pages' contents with the library's alt texts where their pictures have none (`withLibraryAlts()`), in one query. */
export async function withPageAlts<T extends { content: PageContent }>(pages: T[]): Promise<T[]> {
  const alts = await libraryAlts(pages.flatMap((page) => pageImageUrls(page.content)));
  if (alts.size === 0) return pages;
  return pages.map((page) => ({ ...page, content: withLibraryAlts(page.content, (url) => alts.get(url)) }));
}
