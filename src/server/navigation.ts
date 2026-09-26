import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cleanLabels, navigationSchema, type MenuItem, type StoreNavigation } from "@/lib/navigation";

import { audit, type Membership } from "./auth";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;

export type MenuProduct = { handle: string; title: string; status: string };

/** The store's products for the menu editor to link to, by title. */
export async function listMenuProducts(storeId: string, locale: string): Promise<MenuProduct[]> {
  const rows = await db().execute<Row>(sql`
    select p.handle, p.status, coalesce(tl.title, tf.title, p.handle) as title
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = p.id order by locale limit 1
    ) tf on true
    where p.store_id = ${storeId}::uuid and p.status <> 'archived'
    order by 3
  `);
  return rows.map((row) => ({ handle: String(row.handle), title: String(row.title), status: String(row.status) }));
}

/**
 * Saves the store's logo and menus (D30). Texts are kept for the store's
 * own languages; a product link left without text takes the product's
 * title in each language, so shoppers never see an empty link.
 */
export async function saveNavigation({ account, store }: Membership, input: unknown): Promise<SaveResult> {
  const parsed = navigationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const locales = [...new Set(store.markets.map((m) => m.locale))];
  const items = [...parsed.data.header, ...parsed.data.footer];

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
  const clean = (item: MenuItem): MenuItem => {
    if (item.link.kind === "page" && !known.has(`page:${item.link.slug}`)) {
      problems.push("A menu links to a page that no longer exists. Choose another.");
    }
    if (item.link.kind === "article" && !known.has(`article:${item.link.slug}`)) {
      problems.push("A menu links to an article that no longer exists. Choose another.");
    }
    let label = cleanLabels(item.label, locales);
    if (item.link.kind === "product") {
      const own = titles.get(item.link.handle);
      if (!own) problems.push("A menu links to a product that no longer exists. Choose another.");
      else label = { ...cleanLabels(own, locales), ...label };
    }
    if (item.link.kind === "url" && Object.keys(label).length === 0) {
      problems.push("Give each web address link a text.");
    }
    return { label, link: item.link };
  };
  const navigation: StoreNavigation = {
    logo: parsed.data.logo,
    logoDark: parsed.data.logoDark,
    favicon: parsed.data.favicon,
    header: parsed.data.header.map(clean),
    footer: parsed.data.footer.map(clean),
  };
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  await db().execute(sql`
    update commerce.stores set navigation = ${JSON.stringify(navigation)}::jsonb where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, "store.navigation_updated", {
    logo: navigation.logo !== null,
    logoDark: navigation.logoDark !== null,
    favicon: navigation.favicon !== null,
    header: navigation.header.length,
    footer: navigation.footer.length,
  });
  return { ok: true };
}
