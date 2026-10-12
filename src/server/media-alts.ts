import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { backgroundImageUrls, pageImageUrls, withLibraryAlts, withSmallCopies, type LibraryAlt } from "@/lib/page-images";
import type { PageContent } from "@/lib/page-content";

type Row = Record<string, unknown>;

/**
 * The media library's alt texts (D89) for pictures by address, either the
 * file's or its small copy's; by address alone, as `commerce.media_alt()`,
 * so a store copied from the template describes the template's pictures.
 */
export async function libraryAlts(urls: string[]): Promise<Map<string, LibraryAlt>> {
  return (await libraryFacts(urls)).alts;
}

/**
 * What the library knows of pictures by address, in one query: their alt texts (above) and each file's small copy (480 px, made
 * when it was uploaded), so a page can offer a phone the small one (`withSmallCopies()`). A picture the library does not hold
 * has neither, and is drawn as it is.
 */
async function libraryFacts(urls: string[]): Promise<{ alts: Map<string, LibraryAlt>; small: Map<string, string> }> {
  const wanted = [...new Set(urls.filter(Boolean))];
  const alts = new Map<string, LibraryAlt>();
  const small = new Map<string, string>();
  if (wanted.length === 0) return { alts, small };
  const list = sql.join(wanted.map((url) => sql`${url}`), sql`, `);
  const rows = await readDb().execute<Row>(sql`
    select url, thumbnail_url, alt, alt_translations from commerce.media
    where (url in (${list}) or thumbnail_url in (${list}))
      and (alt <> '' or alt_translations <> '{}'::jsonb or thumbnail_url is not null)
  `);
  for (const row of rows) {
    if (row.thumbnail_url) small.set(String(row.url), String(row.thumbnail_url));
    const translations = (row.alt_translations ?? {}) as Record<string, string>;
    if (!row.alt && Object.keys(translations).length === 0) continue;
    const alt = { alt: String(row.alt ?? ""), translations };
    alts.set(String(row.url), alt);
    if (row.thumbnail_url) alts.set(String(row.thumbnail_url), alt);
  }
  return { alts, small };
}

/**
 * Pages' contents with the library's alt texts where their pictures have none (`withLibraryAlts()`) and their background pictures'
 * small copies (`withSmallCopies()`), in one query.
 */
export async function withPageAlts<T extends { content: PageContent }>(pages: T[]): Promise<T[]> {
  const { alts, small } = await libraryFacts(pages.flatMap((page) => [...pageImageUrls(page.content), ...backgroundImageUrls(page.content)]));
  if (alts.size === 0 && small.size === 0) return pages;
  return pages.map((page) => ({ ...page, content: withSmallCopies(withLibraryAlts(page.content, (url) => alts.get(url)), (url) => small.get(url)) }));
}
