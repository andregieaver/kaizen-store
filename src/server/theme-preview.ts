import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parsePageContent, type PageContent } from "@/lib/page-content";
import { themeLayersOf } from "@/lib/section-styles";
import { parseStoreTheme, type StoreTheme } from "@/lib/theme";
import { whatChanges, type LayoutKind, type LookFacts, type PageFacts, type WhatChanges } from "@/lib/theme-changes";
import { themeFontFamilies } from "@/lib/theme-elements";

import { installLook, liveLook, type InstalledLook, type InstallWithLook } from "./theme-installs";

type Row = Record<string, unknown>;

/** A layout page an installed theme chose, as the preview draws it: its published content, or null for the standard one. */
export type PreviewLayout = { id: string; title: string; content: PageContent } | null;

/** A page or article of the store that the preview can show. */
export type PreviewPage = { id: string; type: "page" | "article"; slug: string; title: string };

export type InstallPreview = {
  install: InstallWithLook;
  theme: StoreTheme;
  css: string;
  header: PreviewLayout;
  footer: PreviewLayout;
  productLayout: PreviewLayout;
  pages: PreviewPage[];
};

const LAYOUT_TYPES: Record<LayoutKind, string> = { header: "header", footer: "footer", productLayout: "product_layout" };
const LAYOUT_ID: Record<LayoutKind, keyof InstalledLook> = { header: "headerId", footer: "footerId", productLayout: "productLayoutId" };

/** A layout page of the store, published and of its kind, as a look names it; null when it is not (the standard one is drawn then). */
async function layoutPage(storeId: string, kind: LayoutKind, id: string | null): Promise<PreviewLayout> {
  if (!id) return null;
  const [row] = await db().execute<Row>(sql`
    select id, published from commerce.pages
    where store_id = ${storeId}::uuid and id = ${id}::uuid and type = ${LAYOUT_TYPES[kind]} and published_at is not null
  `);
  const content = row ? parsePageContent(row.published) : null;
  return row && content ? { id: String(row.id), title: content.title || "Untitled", content } : null;
}

/**
 * What the preview of an installed theme draws (D244, `docs/theme-phase-2.md` step 3): the theme's look (live or not) and the store's own
 * pages and articles to show in it. Read per request and never cached: a preview is the person's own, and nothing of it reaches visitors.
 */
export async function installPreview(storeId: string, installId: string): Promise<InstallPreview | null> {
  const install = await installLook(storeId, installId);
  if (!install) return null;
  const { look } = install;
  const [header, footer, productLayout, pageRows] = await Promise.all([
    layoutPage(storeId, "header", look.headerId),
    layoutPage(storeId, "footer", look.footerId),
    layoutPage(storeId, "productLayout", look.productLayoutId),
    db().execute<Row>(sql`
      select id, type, slug, published from commerce.pages
      where store_id = ${storeId}::uuid and type in ('page', 'article') and published_at is not null
      order by type, slug
      limit 200
    `),
  ]);
  const pages = pageRows.flatMap((row): PreviewPage[] => {
    const content = parsePageContent(row.published);
    return content ? [{ id: String(row.id), type: row.type === "article" ? "article" : "page", slug: String(row.slug), title: content.title || String(row.slug) }] : [];
  });
  return { install, theme: parseStoreTheme(look.theme), css: look.css, header, footer, productLayout, pages };
}

/** A published page or article of the store, for the preview to draw. */
export async function previewPageContent(storeId: string, pageId: string): Promise<PageContent | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return null;
  const [row] = await db().execute<Row>(sql`
    select published from commerce.pages
    where store_id = ${storeId}::uuid and id = ${pageId}::uuid and type in ('page', 'article') and published_at is not null
  `);
  return row ? parsePageContent(row.published) : null;
}

async function lookFacts(storeId: string, title: string, look: InstalledLook): Promise<LookFacts> {
  const settings = parseStoreTheme(look.theme).settings;
  const layouts = {} as LookFacts["layouts"];
  for (const kind of Object.keys(LAYOUT_TYPES) as LayoutKind[]) {
    const id = look[LAYOUT_ID[kind]] as string | null;
    const page = await layoutPage(storeId, kind, id);
    layouts[kind] = { id: page?.id ?? null, title: page?.title ?? null };
  }
  return { title, ...themeLayersOf(settings), fonts: themeFontFamilies(settings), css: look.css, layouts };
}

/**
 * *What changes* when the store switches from its live theme to an installed one (D244): `whatChanges()` over the two looks and the store's
 * pages and articles as visitors see them (published, else the draft). Null for an install that is not the store's or is live already.
 */
export async function whatChangesFor(storeId: string, installId: string): Promise<{ live: string; target: string; changes: WhatChanges } | null> {
  const [live, target] = await Promise.all([liveLook(storeId), installLook(storeId, installId)]);
  if (!live || !target || target.live) return null;
  const rows = await db().execute<Row>(sql`
    select coalesce(published, draft) as content from commerce.pages
    where store_id = ${storeId}::uuid and type in ('page', 'article')
  `);
  const pages = rows.flatMap((row): PageFacts[] => {
    const content = parsePageContent(row.content);
    return content ? [{ title: content.title, rows: content.rows }] : [];
  });
  const [from, to] = await Promise.all([lookFacts(storeId, live.title, live), lookFacts(storeId, target.title, target.look)]);
  return { live: live.title, target: target.title, changes: whatChanges(from, to, pages) };
}
