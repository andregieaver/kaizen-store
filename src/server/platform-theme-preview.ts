import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parseSiteFonts } from "@/lib/fonts-schema";
import { parsePageContent, type PageContent } from "@/lib/page-content";
import { themeLayersOf } from "@/lib/section-styles";
import type { StoreTheme } from "@/lib/theme";
import { whatChanges, type ChangesWords, type LookFacts, type PageFacts, type WhatChanges } from "@/lib/theme-changes";
import { themeFontFamilies } from "@/lib/theme-elements";

import { platformTheme } from "./platform-navigation";
import { livePlatformInstall, platformInstallLook, type PlatformInstallWithLook, type PlatformLook } from "./platform-theme-installs";

/**
 * Kaizena Flow's own installed themes seen before switching (D252, `docs/theme-phase-4.md` step 2), as a store's are (D244,
 * `theme-preview.ts`): the install's look over Kaizena Flow's own published pages and articles, and *What changes* (`whatChanges()`). Read per
 * request and never cached; nothing of it reaches visitors.
 */

type Row = Record<string, unknown>;

/** A header or footer an install chose, as the preview draws it: its published content, or null for the standard one. */
export type PlatformPreviewLayout = { id: string; title: string; content: PageContent } | null;

/** One of Kaizena Flow's published pages or articles that the preview can show. */
export type PlatformPreviewPage = { id: string; type: "page" | "article"; slug: string; title: string };

export type PlatformInstallPreview = {
  install: PlatformInstallWithLook;
  /** The install's theme with its fonts laid over it, as Kaizena Flow's site reads its own (`platformTheme()`). */
  theme: StoreTheme;
  css: string;
  header: PlatformPreviewLayout;
  footer: PlatformPreviewLayout;
  pages: PlatformPreviewPage[];
};

const lookTheme = (look: PlatformLook) => platformTheme(look.theme, parseSiteFonts(look.fonts));

/** One of Kaizena Flow's layout pages, published and of its kind, as a look names it; null when it is not. */
async function layoutPage(type: "header" | "footer", id: string | null): Promise<PlatformPreviewLayout> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db().execute<Row>(sql`
    select id, published from commerce.pages
    where store_id is null and id = ${id}::uuid and type = ${type} and published_at is not null
  `);
  const content = row ? parsePageContent(row.published) : null;
  return row && content ? { id: String(row.id), title: content.title || "Untitled", content } : null;
}

/** What the preview of one of Kaizena Flow's installs draws: its look and Kaizena Flow's own published pages and articles. */
export async function platformInstallPreview(installId: string): Promise<PlatformInstallPreview | null> {
  const install = await platformInstallLook(installId);
  if (!install) return null;
  const { look } = install;
  const [header, footer, pageRows] = await Promise.all([
    layoutPage("header", look.headerId),
    layoutPage("footer", look.footerId),
    db().execute<Row>(sql`
      select id, type, slug, published from commerce.pages
      where store_id is null and type in ('page', 'article') and published_at is not null
      order by type, slug
      limit 200
    `),
  ]);
  const pages = pageRows.flatMap((row): PlatformPreviewPage[] => {
    const content = parsePageContent(row.published);
    return content ? [{ id: String(row.id), type: row.type === "article" ? "article" : "page", slug: String(row.slug), title: content.title || String(row.slug) }] : [];
  });
  return { install, theme: lookTheme(look), css: look.css, header, footer, pages };
}

/** One of Kaizena Flow's published pages or articles, for the preview to draw. */
export async function platformPreviewPage(pageId: string): Promise<{ type: "page" | "article"; content: PageContent; publishedAt: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return null;
  const [row] = await db().execute<Row>(sql`
    select type, published, first_published_at from commerce.pages
    where store_id is null and id = ${pageId}::uuid and type in ('page', 'article') and published_at is not null
  `);
  const content = row ? parsePageContent(row.published) : null;
  if (!row || !content) return null;
  return { type: row.type === "article" ? "article" : "page", content, publishedAt: row.first_published_at ? new Date(String(row.first_published_at)).toISOString() : null };
}

async function lookFacts(title: string, look: PlatformLook): Promise<LookFacts> {
  const { settings } = lookTheme(look);
  const [header, footer] = await Promise.all([layoutPage("header", look.headerId), layoutPage("footer", look.footerId)]);
  return {
    title,
    ...themeLayersOf(settings),
    fonts: themeFontFamilies(settings),
    css: look.css,
    layouts: {
      header: { id: header?.id ?? null, title: header?.title ?? null },
      footer: { id: footer?.id ?? null, title: footer?.title ?? null },
      // Kaizena Flow's site has no product page: a theme's is left out when it is added.
      productLayout: { id: null, title: null },
    },
  };
}

/**
 * *What changes* when Kaizena Flow's site switches from its live theme to an installed one: `whatChanges()` over the two looks and Kaizena
 * Flow's pages and articles as visitors see them (published, else the draft). Null for an id that is not an install, or the live one.
 */
export async function whatChangesForPlatform(installId: string, words?: ChangesWords): Promise<{ live: string; target: string; changes: WhatChanges } | null> {
  const [live, target] = await Promise.all([livePlatformInstall(), platformInstallLook(installId)]);
  if (!live || !target || target.live) return null;
  const rows = await db().execute<Row>(sql`
    select coalesce(published, draft) as content from commerce.pages where store_id is null and type in ('page', 'article')
  `);
  const pages = rows.flatMap((row): PageFacts[] => {
    const content = parsePageContent(row.content);
    return content ? [{ title: content.title, rows: content.rows }] : [];
  });
  const [from, to] = await Promise.all([lookFacts(live.title, live.look), lookFacts(target.title, target.look)]);
  return { live: live.title, target: target.title, changes: whatChanges(from, to, pages, words) };
}
