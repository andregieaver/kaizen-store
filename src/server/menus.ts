import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife } from "next/cache";

import { db, readDb } from "@/db/client";
import { t } from "@/lib/i18n";
import {
  cleanLabels,
  menuInput,
  menuLabel,
  platformMenuLink,
  termNames,
  parseMenuItems,
  parsePlatformMenuItems,
  platformMenuInput,
  type Menu,
  type MenuEntry,
  type PlatformMenu,
  type PlatformMenuEntry,
} from "@/lib/navigation";

import { audit, type Account, type Membership } from "./auth";
import { publishedPageNames } from "./pages";
import { getPlatformChrome } from "./platform-navigation";
import type { Store } from "./stores";
import { siteTerms } from "./taxonomy";

/** The names Kaizen's own links take without a text of their own. */
const PLATFORM_BUILT_IN = { home: "Home", signUp: "Start your store", signIn: "Sign in", blog: "Blog" };

type Row = Record<string, unknown>;

/** What saving a menu gives: its id, or what to fix. */
export type MenuSaveResult = { ok: true; id: string } | { ok: false; problems: string[] };

/** Where a menu is shown (D85): the standard header or footer, and the pages, headers and footers with it in a menu component. */
export type MenuUses = { standard: ("header" | "footer")[]; pages: { id: string; type: string; title: string }[] };

/** A store's menus, by name, read fresh for the admin. */
export async function listStoreMenus(storeId: string): Promise<Menu[]> {
  const rows = await db().execute<Row>(sql`
    select id, name, items from commerce.menus where store_id = ${storeId}::uuid order by name
  `);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), items: parseMenuItems(row.items) }));
}

/** Kaizen's menus, by name, read fresh for the admin. */
export async function listPlatformMenus(): Promise<PlatformMenu[]> {
  const rows = await db().execute<Row>(sql`
    select id, name, items from commerce.menus where store_id is null order by name
  `);
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), items: parsePlatformMenuItems(row.items) }));
}

const problemsOf = (issues: { message: string }[]) => [...new Set(issues.map((i) => i.message))];

/** Whether the owner has another menu by this name. */
async function nameTaken(storeId: string | null, name: string, id: string | null): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    select 1 from commerce.menus
    where store_id is not distinct from ${storeId}::uuid and name = ${name}
      and (${id}::uuid is null or id <> ${id}::uuid)
  `);
  return rows.length > 0;
}

/** Writes a new menu, or the owner's menu `id`; null if `id` is not the owner's. */
async function writeMenu(storeId: string | null, id: string | null, name: string, items: unknown[], accountId: string) {
  const json = JSON.stringify(items);
  const [row] = id
    ? await db().execute<Row>(sql`
        update commerce.menus set name = ${name}, items = ${json}::jsonb, updated_at = now(), updated_by = ${accountId}::uuid
        where id = ${id}::uuid and store_id is not distinct from ${storeId}::uuid
        returning id
      `)
    : await db().execute<Row>(sql`
        insert into commerce.menus (store_id, name, items, created_by, updated_by)
        values (${storeId}::uuid, ${name}, ${json}::jsonb, ${accountId}::uuid, ${accountId}::uuid)
        returning id
      `);
  return row ? String(row.id) : null;
}

/**
 * Saves a store's menu (a new one without `id`). Texts are kept for the
 * store's own languages; a product link left without text takes the
 * product's title in each language, so shoppers never see an empty link.
 * Page and article links must name one of the store's own.
 */
export async function saveStoreMenu({ account, store }: Membership, id: string | null, input: unknown): Promise<MenuSaveResult> {
  const parsed = menuInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  const { name, items } = parsed.data;
  const locales = [...new Set(store.markets.map((m) => m.locale))];

  const handles = [...new Set(items.flatMap((i) => (i.link.kind === "product" ? [i.link.handle] : [])))];
  const titles = new Map<string, Record<string, string>>();
  if (handles.length > 0) {
    const rows = await db().execute<Row>(sql`
      select p.handle, coalesce(json_object_agg(t.locale, t.title) filter (where t.locale is not null), '{}') as titles
      from commerce.products p
      left join commerce.product_translations t on t.product_id = p.id
      where p.store_id = ${store.id}::uuid and p.status <> 'archived'
        and p.handle in (${sql.join(handles.map((h) => sql`${h}`), sql`, `)})
      group by p.handle
    `);
    for (const row of rows) titles.set(String(row.handle), row.titles as Record<string, string>);
  }

  // Page and article links (D54, D57) name one of the store's own, by its address now or one it had.
  const slugs = [...new Set(items.flatMap((i) => (i.link.kind === "page" || i.link.kind === "article" ? [i.link.slug] : [])))];
  const known = new Set<string>();
  if (slugs.length > 0) {
    const list = sql.join(slugs.map((slug) => sql`${slug}`), sql`, `);
    const rows = await db().execute<Row>(sql`
      select type || ':' || slug as key from commerce.pages where store_id = ${store.id}::uuid and slug in (${list})
      union
      select type || ':' || slug from commerce.page_redirects where store_id = ${store.id}::uuid and slug in (${list})
    `);
    for (const row of rows) known.add(String(row.key));
  }

  const problems: string[] = [];
  const clean = (item: MenuEntry): MenuEntry => {
    if (item.link.kind === "page" && !known.has(`page:${item.link.slug}`)) {
      problems.push("A link goes to a page that no longer exists. Choose another.");
    }
    if (item.link.kind === "article" && !known.has(`article:${item.link.slug}`)) {
      problems.push("A link goes to an article that no longer exists. Choose another.");
    }
    let label = cleanLabels(item.label, locales);
    if (item.link.kind === "product") {
      const own = titles.get(item.link.handle);
      if (!own) problems.push("A link goes to a product that no longer exists. Choose another.");
      else label = { ...cleanLabels(own, locales), ...label };
    }
    if (item.link.kind === "url" && Object.keys(label).length === 0) problems.push("Give each custom link a text.");
    return { label, link: item.link, depth: item.depth, ...(item.newTab && { newTab: true }) };
  };
  const cleaned = items.map(clean);
  if (await nameTaken(store.id, name, id)) problems.push(`There is already a menu called ${name}.`);
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const saved = await writeMenu(store.id, id, name, cleaned, account.id);
  if (!saved) return { ok: false, problems: ["That menu no longer exists."] };
  await audit(account.id, store.id, id ? "store.menu_updated" : "store.menu_created", { menuId: saved, name, items: cleaned.length });
  return { ok: true, id: saved };
}

/** Saves one of Kaizen's menus (a new one without `id`); page and article links must name one of Kaizen's own. */
export async function savePlatformMenu(account: Account, id: string | null, input: unknown): Promise<MenuSaveResult> {
  const parsed = platformMenuInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  const { name, items } = parsed.data;
  const ids = [...new Set(items.flatMap((i) => (i.link.kind === "page" || i.link.kind === "article" ? [i.link.pageId] : [])))];
  const existing = new Set<string>();
  if (ids.length > 0) {
    const rows = await db().execute<Row>(sql`
      select type || ':' || id as key from commerce.pages
      where store_id is null and id in (${sql.join(ids.map((pageId) => sql`${pageId}::uuid`), sql`, `)})
    `);
    for (const row of rows) existing.add(String(row.key));
  }

  const problems: string[] = [];
  const clean = (item: PlatformMenuEntry): PlatformMenuEntry => {
    const label = cleanLabels(item.label, ["en"]);
    if (item.link.kind === "page" && !existing.has(`page:${item.link.pageId}`)) {
      problems.push("A link goes to a page that no longer exists. Choose another.");
    }
    if (item.link.kind === "article" && !existing.has(`article:${item.link.pageId}`)) {
      problems.push("A link goes to an article that no longer exists. Choose another.");
    }
    if (item.link.kind === "url" && !label.en) problems.push("Give each custom link a text.");
    return { label, link: item.link, depth: item.depth, ...(item.newTab && { newTab: true }) };
  };
  const cleaned = items.map(clean);
  if (await nameTaken(null, name, id)) problems.push(`There is already a menu called ${name}.`);
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const saved = await writeMenu(null, id, name, cleaned, account.id);
  if (!saved) return { ok: false, problems: ["That menu no longer exists."] };
  await audit(account.id, null, id ? "platform.menu_updated" : "platform.menu_created", { menuId: saved, name, items: cleaned.length });
  return { ok: true, id: saved };
}

/**
 * Deletes one of the owner's menus. The standard header and footer let go
 * of it (the database sets them back to none); menu components naming it
 * show nothing until another is chosen.
 */
export async function deleteMenu(accountId: string, storeId: string | null, id: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    delete from commerce.menus where id = ${id}::uuid and store_id is not distinct from ${storeId}::uuid returning name
  `);
  if (!row) return false;
  await audit(accountId, storeId, storeId ? "store.menu_deleted" : "platform.menu_deleted", { menuId: id, name: String(row.name) });
  return true;
}

/** Where each of the owner's menus is shown, by menu id. */
export async function menuUses(storeId: string | null): Promise<Map<string, MenuUses>> {
  const uses = new Map<string, MenuUses>();
  const of = (id: string) => uses.get(id) ?? (uses.set(id, { standard: [], pages: [] }).get(id) as MenuUses);
  const [standard] = await db().execute<Row>(
    storeId
      ? sql`select header_menu_id, footer_menu_id from commerce.stores where id = ${storeId}::uuid`
      : sql`select header_menu_id, footer_menu_id from commerce.platform_settings`,
  );
  if (standard?.header_menu_id) of(String(standard.header_menu_id)).standard.push("header");
  if (standard?.footer_menu_id) of(String(standard.footer_menu_id)).standard.push("footer");
  // Menu components name their menu by id, in a page's draft or its published copy.
  const rows = await db().execute<Row>(sql`
    select m.id as menu_id, p.id, p.type, coalesce(p.draft ->> 'title', '') as title
    from commerce.menus m
    join commerce.pages p on p.store_id is not distinct from m.store_id
      and (p.draft::text like '%"' || m.id::text || '"%' or p.published::text like '%"' || m.id::text || '"%')
    where m.store_id is not distinct from ${storeId}::uuid
    order by p.type, title
  `);
  for (const row of rows) of(String(row.menu_id)).pages.push({ id: String(row.id), type: String(row.type), title: String(row.title) });
  return uses;
}

/** A menu as the page builder's canvas shows it (D85): its links' texts in the page's main language, and their depths. */
export type MenuPreview = { id: string; name: string; items: { text: string; depth: number }[] };

/** A store's menus for the builder, its links named as the site names them in `locale`. */
export async function storeMenuPreviews(store: Pick<Store, "id" | "menus" | "frontPageId">, locale: string, lang: string): Promise<MenuPreview[]> {
  const m = t(lang);
  const [terms, pages, articles, blogTerms] = await Promise.all([
    siteTerms(store.id, "product"),
    publishedPageNames(store.id, locale),
    publishedPageNames(store.id, locale, "article"),
    siteTerms(store.id, "article"),
  ]);
  const names = { ...termNames(terms), page: new Map(pages), article: new Map(articles), blogCategory: termNames(blogTerms).category };
  const builtIn = { home: store.frontPageId ? m.home : m.allProducts, products: m.allProducts, account: m.account.title, cart: m.cart, blog: m.blog };
  return store.menus.map((menu) => ({
    id: menu.id,
    name: menu.name,
    items: menu.items.map((item) => ({
      text: menuLabel(item, locale, builtIn, names) || ("slug" in item.link ? item.link.slug : item.link.kind),
      depth: item.depth,
    })),
  }));
}

/** Kaizen's menus for the builder, named as its site names them. */
export async function platformMenuPreviews(): Promise<MenuPreview[]> {
  const chrome = await getPlatformChrome();
  return chrome.menus.map((menu) => ({
    id: menu.id,
    name: menu.name,
    items: menu.items.map((item) => ({
      text:
        platformMenuLink(item, chrome.pages, PLATFORM_BUILT_IN, chrome.terms, chrome.blog)?.text ||
        item.label.en ||
        ("slug" in item.link ? item.link.slug : item.link.kind),
      depth: item.depth,
    })),
  }));
}

/** A store's address by its id, for menu components, which know the store by id (cached: addresses do not change). */
export async function storeSlugOf(storeId: string): Promise<string | null> {
  "use cache";
  cacheLife("days");
  const [row] = await readDb().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  return row ? String(row.slug) : null;
}
