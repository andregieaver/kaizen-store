import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { parsePageContent, type PageContent } from "@/lib/page-content";

import { audit, type Account } from "./auth";
import { siteTests, siteVersionContent, type SiteTest } from "./experiments";
import { withPageAlts } from "./media-alts";
import { pagesTag } from "./pages";

type Row = Record<string, unknown>;

/** A site's header or footer (D80): a page of that type built in the page builder. */
export type SiteLayoutType = "header" | "footer";

/** A chosen header or footer as the site shows it: as last published. */
export type SiteLayout = { id: string; content: PageContent };

/**
 * The header or footer a site uses (D80): a store's (by id) or Kaizen's
 * (null), as last published; null while none is chosen or the chosen one
 * is not published, and the standard one shows.
 */
export async function siteLayoutFor(storeId: string | null, type: SiteLayoutType): Promise<SiteLayout | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  const column = type === "header" ? sql.raw("header_id") : sql.raw("footer_id");
  const [row] = await readDb().execute<Row>(
    storeId === null
      ? sql`select p.id, p.published from commerce.platform_settings s
              join commerce.pages p on p.id = s.${column} and p.store_id is null
             where s.id and p.published_at is not null`
      : sql`select p.id, p.published from commerce.stores s
              join commerce.pages p on p.id = s.${column} and p.store_id = s.id
             where s.id = ${storeId}::uuid and p.published_at is not null`,
  );
  const content = row ? parsePageContent(row.published) : null;
  if (!row || !content) return null;
  const [layout] = await withPageAlts([{ id: String(row.id), content }]);
  return layout;
}

/**
 * The header or footer a store's visitor sees (D148, phase 3): the chosen one, or, while a test of it runs and the address carries
 * the visitor's other version of it (`ab`, from `resolveShop()`), that version's page. `test` is the running test of it, if any,
 * with the version drawn (`a` for the original), for the marker that reports the exposure.
 */
export async function siteLayoutForVisitor(
  storeId: string,
  type: SiteLayoutType,
  ab: Record<string, string>,
): Promise<{ layout: SiteLayout | null; test: SiteTest | null; version: string }> {
  const layout = await siteLayoutFor(storeId, type);
  if (!layout) return { layout, test: null, version: "a" };
  const test = (await siteTests(storeId)).find((t) => t.kind === type && t.targetPageId === layout.id) ?? null;
  const key = test ? ab[test.token] : undefined;
  if (test && key && key !== "a") {
    const version = await siteVersionContent(storeId, test.id, key);
    if (version) return { layout: version, test, version: key };
  }
  return { layout, test, version: "a" };
}

/** Which header and footer a site has chosen (D80), published or not, for the admin. */
export async function siteLayoutChoice(storeId: string | null): Promise<{ header: string | null; footer: string | null }> {
  const [row] = await db().execute<Row>(
    storeId === null
      ? sql`select header_id, footer_id from commerce.platform_settings where id`
      : sql`select header_id, footer_id from commerce.stores where id = ${storeId}::uuid`,
  );
  return { header: row?.header_id ? String(row.header_id) : null, footer: row?.footer_id ? String(row.footer_id) : null };
}

export type ChooseResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Makes one of the site's headers or footers the one it uses, or with
 * `layoutId` null goes back to the standard one (D80). Only the owner's own
 * published ones can be chosen.
 */
export async function chooseSiteLayout(
  account: Account,
  storeId: string | null,
  type: SiteLayoutType,
  layoutId: string | null,
): Promise<ChooseResult> {
  if (layoutId !== null) {
    const [layout] = await db().execute<Row>(sql`
      select published_at is not null as published from commerce.pages
       where id = ${layoutId}::uuid and type = ${type}
         and ${storeId === null ? sql`store_id is null` : sql`store_id = ${storeId}::uuid`}
    `);
    if (!layout) return { ok: false, problems: [`This ${type} no longer exists.`] };
    if (!layout.published) return { ok: false, problems: [`Publish the ${type} before using it.`] };
  }
  const column = type === "header" ? sql.raw("header_id") : sql.raw("footer_id");
  const value = layoutId === null ? sql`null` : sql`${layoutId}::uuid`;
  await db().execute(
    storeId === null
      ? sql`update commerce.platform_settings set ${column} = ${value}, updated_by = ${account.id}::uuid where id`
      : sql`update commerce.stores set ${column} = ${value} where id = ${storeId}::uuid`,
  );
  await audit(account.id, storeId, `site_${type}.chosen`, { layoutId });
  return { ok: true };
}
