import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { latestMade, siteOf, type FeedItem } from "@/lib/dream-showcase";
import { LEGAL_ROLE_COPY, isLegalRole } from "@/lib/legal-roles";
import { formatMoney } from "@/lib/money";
import type { SiteFonts } from "@/lib/fonts-schema";
import { parseStoreTheme, type Palette } from "@/lib/theme";

import { parsePageContent } from "@/lib/page-content";
import { compareVersions, type PageDifference } from "@/lib/version-compare";

import { brandOf } from "./brand";
import { keptChanges, preparedPages, preparedProducts, type DreamRun } from "./dream-factory";
import { listInstalls } from "./theme-installs";
import { openDraft } from "./store-drafts";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What a Dream Factory run has made so far (D419, `src/lib/dream-showcase.ts`), for the owner to watch it take shape: the research notes, the
 * brand and the look (its colours, fonts and title), the logo and icon, the products with a picture and a price, the website's pages, the
 * legal pages and the goals, each made since the run began, read from the store's own records. Reads only; the store's own, never another's.
 */

const PRODUCTS_SHOWN = 8;
const NOTES_SHOWN = 4;

export type DreamShowcase = {
  notes: { topic: string; finding: string; sites: string[]; at: string }[];
  brand: { tagline: string; voice: string; values: string[] } | null;
  look: { title: string; light: Palette; fonts: SiteFonts; at: string } | null;
  marks: { logo: string | null; icon: string | null; at: string | null };
  products: { id: string; title: string; picture: string | null; price: string | null; at: string }[];
  /** How many products the run has made, all of them (the list shows the latest few). */
  productCount: number;
  pages: { title: string; status: "building" | "built" | "live" | "failed"; pageId: string | null }[];
  legal: { name: string; status: string }[];
  goals: string[];
  feed: FeedItem[];
};

export async function dreamShowcase(store: Store, run: Pick<DreamRun, "createdAt">): Promise<DreamShowcase> {
  const since = run.createdAt.toISOString();
  const market = store.markets[0];
  const locale = market?.locale ?? "en";
  const [notes, brand, look, marks, products, productCount, draft, published, legal, goals] = await Promise.all([
    typedRows(
      z.object({ topic: col.text, finding: col.text, sources: z.array(z.string()), created_at: col.timestamp }),
      sql`select topic, finding, sources, created_at from commerce.research_notes
          where store_id = ${store.id}::uuid and created_at >= ${since}::timestamptz order by created_at desc limit ${NOTES_SHOWN}`,
    ),
    brandOf(store.id),
    typedRow(
      z.object({ title: col.text, look: z.unknown(), installed_at: col.timestamp }),
      sql`select title, look, installed_at from commerce.store_theme_installs
          where store_id = ${store.id}::uuid and installed_at >= ${since}::timestamptz order by installed_at desc limit 1`,
    ),
    typedRows(
      z.object({ file_name: col.text, url: col.text, created_at: col.timestamp }),
      sql`select file_name, url, created_at from commerce.media
          where store_id = ${store.id}::uuid and created_at >= ${since}::timestamptz
            and (file_name like '%-logo.png' or file_name like '%-icon.png')
          order by created_at desc limit 6`,
    ),
    typedRows(
      z.object({ id: col.uuid, title: col.text, picture: col.textOrNull, amount: col.minorOrNull, currency: col.textOrNull, created_at: col.timestamp }),
      sql`
        select p.id, coalesce(
            (select t.title from commerce.product_translations t where t.product_id = p.id and t.title <> '' order by t.locale = ${locale} desc, t.locale limit 1),
            p.handle) as title,
          (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m where m.product_id = p.id and m.kind = 'image' order by m.position limit 1) as picture,
          (select min(k.amount_minor) from commerce.kept_prices k join commerce.product_variants v on v.id = k.variant_id
            where k.store_id = p.store_id and v.product_id = p.id and k.market_code = ${market?.code ?? ""}) as amount,
          ${market?.currency ?? null}::text as currency,
          p.created_at
        from commerce.products p
        where p.store_id = ${store.id}::uuid and p.created_at >= ${since}::timestamptz and p.status <> 'archived'
        order by p.created_at desc limit ${PRODUCTS_SHOWN}
      `,
    ),
    typedRow(
      z.object({ n: col.int }),
      sql`select count(*)::int as n from commerce.products where store_id = ${store.id}::uuid and created_at >= ${since}::timestamptz and status <> 'archived'`,
    ),
    openDraft(store.id),
    typedRows(
      z.object({ id: col.uuid, title: col.text, live: col.bool, created_at: col.timestamp }),
      sql`select id, coalesce(published ->> 'title', draft ->> 'title', '') as title, published_at is not null as live, created_at
          from commerce.pages where store_id = ${store.id}::uuid and type = 'page' and created_at >= ${since}::timestamptz
          order by created_at limit 8`,
    ),
    typedRows(
      z.object({ role: col.text, status: col.text, created_at: col.timestamp }),
      sql`select distinct on (role) role, status, created_at from commerce.legal_ai_writes
          where store_id = ${store.id}::uuid and created_at >= ${since}::timestamptz order by role, created_at desc`,
    ),
    typedRows(
      z.object({ title: col.text, created_at: col.timestamp }),
      sql`select title, created_at from commerce.assistant_goals
          where store_id = ${store.id}::uuid and created_at >= ${since}::timestamptz and status <> 'dropped' order by created_at limit 4`,
    ),
  ]);

  const settings = look ? parseStoreTheme((look.look as { theme?: unknown } | null)?.theme ?? {}).settings : null;
  // The marks the brand step drew (`makeBrandMarks()`): named after the brand's name, `{name}-logo.png` and `{name}-icon.png`, the newest.
  const logo = marks.find((m) => m.file_name.endsWith("-logo.png")) ?? null;
  const icon = marks.find((m) => m.file_name.endsWith("-icon.png")) ?? null;
  const madeProducts = products.map((p) => ({
    id: p.id,
    title: p.title,
    picture: p.picture,
    price: p.amount !== null && p.currency ? formatMoney(p.amount, p.currency.trim(), locale) : null,
    at: p.created_at,
  }));
  // The website's pages: the draft's builds while it is open, else the pages the run made (live once published).
  const pages: DreamShowcase["pages"] = draft
    ? draft.pages.map((p) => ({ title: p.title, status: p.status, pageId: p.pageId }))
    : published.map((p) => ({ title: p.title, status: p.live ? "live" : "built", pageId: p.id }));
  const legalPages = legal.map((l) => ({ name: isLegalRole(l.role) ? LEGAL_ROLE_COPY[l.role].name : l.role, status: l.status, at: l.created_at }));

  const feed: FeedItem[] = [
    ...notes.map((n) => ({ at: n.created_at, kind: "note" as const, label: n.topic })),
    ...(look ? [{ at: look.installed_at, kind: "look" as const, label: look.title }] : []),
    ...(logo ? [{ at: logo.created_at, kind: "mark" as const, label: store.name }] : []),
    ...madeProducts.map((p) => ({ at: p.at, kind: "product" as const, label: p.title })),
    ...published.filter((p) => p.title).map((p) => ({ at: p.created_at, kind: "page" as const, label: p.title })),
    ...legalPages.map((l) => ({ at: l.at, kind: "legal" as const, label: l.name })),
    ...goals.map((g) => ({ at: g.created_at, kind: "goal" as const, label: g.title })),
  ];

  return {
    notes: notes.map((n) => ({
      topic: n.topic,
      finding: n.finding,
      sites: [...new Set(n.sources.map(siteOf).filter((s): s is string => s !== null))].slice(0, 3),
      at: n.created_at,
    })),
    brand: brand.tagline || brand.voice || brand.values.length ? { tagline: brand.tagline, voice: brand.voice, values: brand.values } : null,
    look: look && settings ? { title: look.title, light: settings.light, fonts: settings.fonts, at: look.installed_at } : null,
    marks: { logo: logo?.url ?? null, icon: icon?.url ?? null, at: logo?.created_at ?? null },
    products: madeProducts,
    productCount: productCount?.n ?? madeProducts.length,
    pages,
    legal: legalPages.map((l) => ({ name: l.name, status: l.status })),
    goals: goals.map((g) => g.title),
    feed: latestMade(feed),
  };
}

/**
 * What a rework has prepared (D527), for the owner's review: the new look waiting in the library, each page with what its draft changes on
 * the page visitors see (`compareVersions()`: words from facts), the new products, and the changes to products on the site that wait for
 * a yes, in the words they were kept with. Reads only, the store's own.
 */
export type ReworkPrepared = {
  look: { id: string; title: string; live: boolean } | null;
  pages: { id: string; title: string; isNew: boolean; changed: boolean; differences: PageDifference[] }[];
  building: number;
  products: { id: string; title: string; status: string; complete: boolean }[];
  changes: { id: string; summary: string; status: string }[];
};

export async function reworkPrepared(store: Store, run: Pick<DreamRun, "storeId" | "createdAt" | "plan" | "steps">): Promise<ReworkPrepared> {
  const [installs, own, pages, products, changes] = await Promise.all([
    listInstalls(store.id),
    typedRow(
      z.object({ id: col.uuid }),
      sql`select id from commerce.store_theme_installs
          where store_id = ${store.id}::uuid and preset_id is null and installed_at >= ${run.createdAt.toISOString()}::timestamptz
          order by installed_at desc limit 1`,
    ),
    preparedPages(run),
    preparedProducts(store, run),
    keptChanges(run, true),
  ]);
  const contents =
    pages.pages.length > 0
      ? await typedRows(
          z.object({ id: col.uuid, draft: z.unknown(), published: z.unknown() }),
          sql`select id, draft, published from commerce.pages where store_id = ${store.id}::uuid and id = any(${`{${pages.pages.map((p) => p.id).join(",")}}`}::uuid[])`,
        )
      : [];
  const look = own ? (installs.find((i) => i.id === own.id) ?? null) : null;
  return {
    look: look ? { id: look.id, title: look.title, live: look.live } : null,
    pages: pages.pages.map((page) => {
      const row = contents.find((c) => c.id === page.id);
      const draft = row ? parsePageContent(row.draft) : null;
      const published = row ? parsePageContent(row.published) : null;
      return { ...page, differences: draft && published ? compareVersions(published, draft) : [] };
    }),
    building: pages.building,
    products: products.map((p) => ({ id: p.id, title: p.title, status: p.status, complete: p.complete })),
    changes,
  };
}
