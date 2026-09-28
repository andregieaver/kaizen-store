import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { z } from "zod";

import { navigationSchema, type StoreNavigation } from "@/lib/navigation";

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

/** The menus shown in the standard header (and the phone's menu) and footer (D85): ids, or null for none. */
export const standardMenusInput = z.object({
  headerMenuId: z.uuid().nullable().default(null),
  footerMenuId: z.uuid().nullable().default(null),
});

/** The owner's menus among `ids` (Kaizen's with a null store). */
export async function ownMenus(storeId: string | null, ids: (string | null)[]): Promise<Set<string>> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return new Set();
  const rows = await db().execute<Row>(sql`
    select id from commerce.menus
    where store_id is not distinct from ${storeId}::uuid and id in (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  return new Set(rows.map((row) => String(row.id)));
}

/** Saves the store's logo and icon (D30, D62) and the menus its standard header and footer show (D85). */
export async function saveNavigation({ account, store }: Membership, input: unknown): Promise<SaveResult> {
  const parsed = navigationSchema.safeParse(input);
  const menus = standardMenusInput.safeParse(input);
  if (!parsed.success || !menus.success) {
    const issues = [...(parsed.error?.issues ?? []), ...(menus.error?.issues ?? [])];
    return { ok: false, problems: [...new Set(issues.map((i) => i.message))] };
  }
  const { headerMenuId, footerMenuId } = menus.data;
  const own = await ownMenus(store.id, [headerMenuId, footerMenuId]);
  if ((headerMenuId && !own.has(headerMenuId)) || (footerMenuId && !own.has(footerMenuId))) {
    return { ok: false, problems: ["That menu no longer exists. Choose another."] };
  }
  const navigation: StoreNavigation = { logo: parsed.data.logo, logoDark: parsed.data.logoDark, favicon: parsed.data.favicon };

  await db().execute(sql`
    update commerce.stores
    set navigation = ${JSON.stringify(navigation)}::jsonb, header_menu_id = ${headerMenuId}::uuid, footer_menu_id = ${footerMenuId}::uuid
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, "store.navigation_updated", {
    logo: navigation.logo !== null,
    logoDark: navigation.logoDark !== null,
    favicon: navigation.favicon !== null,
    headerMenuId,
    footerMenuId,
  });
  return { ok: true };
}
