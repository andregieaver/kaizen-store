import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { parsePageContent, type PageContent } from "@/lib/page-content";

import { audit, type Account } from "./auth";
import { CATALOG_TAG, catalogTag } from "./catalog";
import { siteTests, siteVersionContent, type SiteTest } from "./experiments";
import { withPageAlts } from "./media-alts";
import { pagesTag } from "./pages";
import { termsTag } from "./taxonomy";

type Row = Record<string, unknown>;

/**
 * Which product layout (D79) a product's page uses, most particular first:
 * the product's own; else the nearest of its categories that has one (a
 * category's layout counts for those below it; at the same distance, by
 * name); else one of its tags' (by name); else the store's standard one.
 * Only published layouts count, as they were last published; null leaves
 * the built-in layout.
 */
export async function productLayoutFor(storeId: string, productId: string): Promise<{ id: string; content: PageContent } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId), pagesTag(storeId), termsTag({ storeId, contentType: "product" }));

  const [row] = await readDb().execute<Row>(sql`
    with recursive up as (
      select t.id, t.parent_id, t.product_layout_id, t.name, 0 as depth
      from commerce.product_terms pt join commerce.terms t on t.id = pt.term_id
      where pt.store_id = ${storeId}::uuid and pt.product_id = ${productId}::uuid and t.kind = 'category'
      union all
      select t.id, t.parent_id, t.product_layout_id, t.name, up.depth + 1
      from commerce.terms t join up on t.id = up.parent_id
      where up.depth < 20
    ),
    live as (
      select id from commerce.pages
      where store_id = ${storeId}::uuid and type = 'product_layout' and published_at is not null
    )
    select p.id, p.published
    from commerce.pages p
    where p.id = coalesce(
      (select product_layout_id from commerce.products
        where store_id = ${storeId}::uuid and id = ${productId}::uuid and product_layout_id in (select id from live)),
      (select product_layout_id from up where product_layout_id in (select id from live) order by depth, lower(name) limit 1),
      (select t.product_layout_id from commerce.product_terms pt join commerce.terms t on t.id = pt.term_id
        where pt.store_id = ${storeId}::uuid and pt.product_id = ${productId}::uuid and t.kind = 'tag'
          and t.product_layout_id in (select id from live)
        order by lower(t.name) limit 1),
      (select product_layout_id from commerce.stores where id = ${storeId}::uuid and product_layout_id in (select id from live))
    )
  `);
  const content = row ? parsePageContent(row.published) : null;
  if (!content) return null;
  const [layout] = await withPageAlts([{ content }]);
  return { id: String(row.id), content: layout.content };
}

/**
 * The layout a visitor's product page is drawn with (D148, phase 3): the layout the product uses, or, while a test of that layout
 * runs and the address carries the visitor's other version of it (`ab`), that version's page. `test` is the running test of the
 * layout, with the version drawn, for the marker that reports the exposure. Null for a product on the built-in layout.
 */
export async function productLayoutForVisitor(
  storeId: string,
  productId: string,
  ab: Record<string, string>,
): Promise<{ content: PageContent; test: SiteTest | null; version: string } | null> {
  const own = await productLayoutFor(storeId, productId);
  if (!own) return null;
  const test = (await siteTests(storeId)).find((t) => t.kind === "layout" && t.targetPageId === own.id) ?? null;
  const key = test ? ab[test.token] : undefined;
  if (test && key && key !== "a") {
    const version = await siteVersionContent(storeId, test.id, key);
    if (version) return { content: version.content, test, version: key };
  }
  return { content: own.content, test, version: "a" };
}

/** Where a layout is used (D79): as the store's standard, for categories and tags, and for single products. */
export type LayoutUse = { standard: boolean; categoryIds: string[]; tagIds: string[]; products: number };

/** Each of the store's layouts' uses, by layout id. */
export async function layoutUses(storeId: string): Promise<Map<string, LayoutUse>> {
  const [store, terms, products] = await Promise.all([
    db().execute<Row>(sql`select product_layout_id from commerce.stores where id = ${storeId}::uuid`),
    db().execute<Row>(sql`
      select id, kind, product_layout_id from commerce.terms
      where store_id = ${storeId}::uuid and content_type = 'product' and product_layout_id is not null
    `),
    db().execute<Row>(sql`
      select product_layout_id, count(*)::int as n from commerce.products
      where store_id = ${storeId}::uuid and product_layout_id is not null
      group by product_layout_id
    `),
  ]);
  const uses = new Map<string, LayoutUse>();
  const entry = (id: string) => {
    if (!uses.has(id)) uses.set(id, { standard: false, categoryIds: [], tagIds: [], products: 0 });
    return uses.get(id)!;
  };
  const standard = store[0]?.product_layout_id;
  if (standard) entry(String(standard)).standard = true;
  for (const term of terms) {
    const use = entry(String(term.product_layout_id));
    (term.kind === "category" ? use.categoryIds : use.tagIds).push(String(term.id));
  }
  for (const row of products) entry(String(row.product_layout_id)).products = Number(row.n);
  return uses;
}

/** The store's product layouts, to choose one for a product. */
export async function listLayoutChoices(storeId: string): Promise<{ id: string; title: string; published: boolean }[]> {
  const rows = await db().execute<Row>(sql`
    select id, draft ->> 'title' as title, published_at is not null as published from commerce.pages
    where store_id = ${storeId}::uuid and type = 'product_layout'
    order by lower(draft ->> 'title'), id
  `);
  return rows.map((row) => ({ id: String(row.id), title: String(row.title ?? "") || "Untitled", published: Boolean(row.published) }));
}

export type AssignResult = { ok: true } | { ok: false; problems: string[] };

/**
 * Chooses where a layout is used (D79): as the store's standard or not, and
 * for exactly these product categories and tags (others it was used for go
 * back to what comes next in line). Single products choose theirs in the
 * product editor.
 */
export async function assignLayout(
  account: Account,
  storeId: string,
  layoutId: string,
  choice: { standard: boolean; termIds: string[] },
): Promise<AssignResult> {
  const [layout] = await db().execute<Row>(sql`
    select id from commerce.pages where store_id = ${storeId}::uuid and id = ${layoutId}::uuid and type = 'product_layout'
  `);
  if (!layout) return { ok: false, problems: ["This layout no longer exists."] };
  const ids = `{${choice.termIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(",")}}`;
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.stores set product_layout_id = case
        when ${choice.standard} then ${layoutId}::uuid
        when product_layout_id = ${layoutId}::uuid then null
        else product_layout_id end
      where id = ${storeId}::uuid
    `);
    await tx.execute(sql`
      update commerce.terms set product_layout_id = null
      where store_id = ${storeId}::uuid and product_layout_id = ${layoutId}::uuid and not (id = any(${ids}::uuid[]))
    `);
    await tx.execute(sql`
      update commerce.terms set product_layout_id = ${layoutId}::uuid
      where store_id = ${storeId}::uuid and content_type = 'product' and id = any(${ids}::uuid[])
    `);
  });
  await audit(account.id, storeId, "product_layout.assigned", { layoutId, standard: choice.standard, terms: choice.termIds.length });
  return { ok: true };
}
