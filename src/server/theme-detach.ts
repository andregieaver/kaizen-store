import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parsePageContent } from "@/lib/page-content";
import { parseStoreTheme } from "@/lib/theme";
import { detachThemeValues } from "@/lib/theme-detach";

type Row = Record<string, unknown>;

/** What the migration of `docs/theme-store.md` 4.4 would do to one page. */
export type DetachPage = { id: string; type: string; slug: string; title: string; followed: number; own: number };
export type DetachReport = { pages: DetachPage[]; followed: number; own: number; unreadable: number };

/**
 * The migration of `docs/theme-store.md` 4.4 as a dry run (D241, phase 1): for each of the store's pages (its published content, else its
 * draft), how many of its parts' settings only repeat the live theme and would follow it once taken out, and how many are the owner's own.
 * Reads only; nothing is written, and the store's theme is read as stored, as the site lays it under the pages.
 */
export async function detachDryRun(storeId: string): Promise<DetachReport | null> {
  const [store] = await db().execute<Row>(sql`select theme from commerce.stores where id = ${storeId}::uuid`);
  if (!store) return null;
  const { elements, sectionStyles } = parseStoreTheme(store.theme).settings;
  const rows = await db().execute<Row>(sql`
    select id, type, slug, coalesce(published, draft) as content from commerce.pages
    where store_id = ${storeId}::uuid and type <> 'variant'
    order by type, slug
  `);
  const report: DetachReport = { pages: [], followed: 0, own: 0, unreadable: 0 };
  for (const row of rows) {
    const content = parsePageContent(row.content);
    if (!content) {
      report.unreadable += 1;
      continue;
    }
    const result = detachThemeValues(content.rows, elements, sectionStyles);
    report.followed += result.followed;
    report.own += result.own;
    if (result.followed + result.own > 0) {
      report.pages.push({ id: String(row.id), type: String(row.type), slug: String(row.slug), title: content.title || String(row.slug), followed: result.followed, own: result.own });
    }
  }
  report.pages.sort((a, b) => b.followed - a.followed || a.slug.localeCompare(b.slug));
  return report;
}
