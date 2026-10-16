import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import {
  NO_DEMO,
  linksToRemoved,
  type DemoCounts,
  type DemoKind,
  type KeptItem,
  type KeptReason,
  type RemovedAddresses,
} from "@/lib/demo-content";
import { withoutItems } from "@/lib/menu-structure";

import { audit } from "./auth";

/**
 * A new store's demo content (`docs/theme-showcase-phase-1.md` step 4b). When a store is made for an owner (an approved request, *Create
 * a store*), everything its store template brought is marked (`commerce.store_demo_items`): its products, its pages and articles (not the
 * All products page or a page chosen for a role, which are the store's working pages) and its categories and tags. *Remove demo content*
 * then takes out, in one transaction, what is still as it was: products are archived (never deleted, so an order keeps its lines), pages,
 * articles, categories and tags are deleted, and the menus lose their links to them. Anything the owner changed since (its `updated_at`
 * or a custom field after the mark), a page they chose for a role or put in an A/B test, and a category or tag their own products or
 * pages still use stays, and is named. Afterwards nothing is marked: what stayed is the owner's.
 */

type Row = Record<string, unknown>;

/** Changed since the mark: the row's own time, or a custom field of it written after (D118). */
const changedSince = (table: SQL, mark: SQL): SQL =>
  sql`(${table}.updated_at > ${mark}.marked_at or exists (
    select 1 from commerce.field_values f where f.store_id = ${mark}.store_id and f.entity_id = ${mark}.ref_id and f.updated_at > ${mark}.marked_at
  ))`;

/**
 * A product that is still demo, as the setup wizard counts and removes them: copied from the Standard store with a `demo-` handle (as
 * before step 4b), or marked and not changed since (a content pack's products have their trade's own handles).
 */
export const isDemoProduct = (p: SQL): SQL => sql`(${p}.handle like 'demo-%' or exists (
  select 1 from commerce.store_demo_items d
  where d.store_id = ${p}.store_id and d.kind = 'product' and d.ref_id = ${p}.id and not ${changedSince(p, sql`d`)}
))`;

/**
 * Marks what a store just made holds as its demo content: called once, after the store is copied and its design applied, by
 * `approveAccessRequest()` and `createStoreForOwner()`. Never throws to its caller's harm: a store without marks only lacks the button.
 */
export async function markDemoContent(storeId: string): Promise<number> {
  const rows = await db().execute<Row>(sql`
    with marked as (
      insert into commerce.store_demo_items (store_id, kind, ref_id, marked_at)
      select p.store_id, 'product', p.id, clock_timestamp() from commerce.products p
       where p.store_id = ${storeId}::uuid and p.status <> 'archived'
      union all
      select pg.store_id, 'page', pg.id, clock_timestamp() from commerce.pages pg
        join commerce.stores s on s.id = pg.store_id
       where pg.store_id = ${storeId}::uuid and pg.type in ('page', 'article')
         and pg.id is distinct from s.products_page_id
         and not exists (select 1 from commerce.page_roles r where r.page_id = pg.id)
      union all
      select t.store_id, 'term', t.id, clock_timestamp() from commerce.terms t
       where t.store_id = ${storeId}::uuid
      on conflict do nothing
      returning 1
    )
    select count(*)::int as n from marked
  `);
  return Number(rows[0]?.n ?? 0);
}

export type DemoItem = {
  kind: DemoKind;
  id: string;
  title: string;
  /** What the owner calls it: a product, a page, an article, a category or a tag. */
  noun: "product" | "page" | "article" | "category" | "tag";
};

/** A store's demo content as the Home card shows it: what is still demo (`items`, counted), and what the owner changed and keeps. */
export type DemoContent = { counts: DemoCounts; items: DemoItem[]; changed: DemoItem[] };

/** The marked items that still exist, with their names in the store's main language and whether the owner changed them since. */
async function markedItems(storeId: string, locale: string): Promise<(DemoItem & { changed: boolean })[]> {
  const d = sql`d`;
  const rows = await db().execute<Row>(sql`
    select 'product' as kind, p.id, 'product' as noun, ${changedSince(sql`p`, d)} as changed, coalesce((
      select t.title from commerce.product_translations t where t.product_id = p.id order by (t.locale = ${locale}) desc, t.locale limit 1
    ), p.handle) as title, 0 as rank
    from commerce.store_demo_items d join commerce.products p on p.id = d.ref_id and p.store_id = d.store_id
    where d.store_id = ${storeId}::uuid and d.kind = 'product' and p.status <> 'archived'
    union all
    select 'page', pg.id, pg.type, ${changedSince(sql`pg`, d)}, coalesce(nullif(pg.published ->> 'title', ''), nullif(pg.draft ->> 'title', ''), pg.slug), 1
    from commerce.store_demo_items d join commerce.pages pg on pg.id = d.ref_id and pg.store_id = d.store_id
    where d.store_id = ${storeId}::uuid and d.kind = 'page'
    union all
    select 'term', t.id, t.kind, ${changedSince(sql`t`, d)}, t.name, 2
    from commerce.store_demo_items d join commerce.terms t on t.id = d.ref_id and t.store_id = d.store_id
    where d.store_id = ${storeId}::uuid and d.kind = 'term'
    order by rank, title
  `);
  return rows.map((row) => ({
    kind: String(row.kind) as DemoKind,
    id: String(row.id),
    title: String(row.title),
    noun: String(row.noun) as DemoItem["noun"],
    changed: Boolean(row.changed),
  }));
}

const countOf = (items: readonly DemoItem[]): DemoCounts => ({
  products: items.filter((i) => i.noun === "product").length,
  pages: items.filter((i) => i.noun === "page").length,
  articles: items.filter((i) => i.noun === "article").length,
  categories: items.filter((i) => i.noun === "category").length,
  tags: items.filter((i) => i.noun === "tag").length,
});

/** The store's demo content, or null when nothing is marked any more (removed, or a store made before step 4b). */
export async function demoContent(storeId: string, locale: string): Promise<DemoContent | null> {
  const all = await markedItems(storeId, locale);
  if (all.length === 0) return null;
  const strip = ({ changed: _, ...item }: DemoItem & { changed: boolean }): DemoItem => item;
  const items = all.filter((i) => !i.changed).map(strip);
  return { counts: countOf(items), items, changed: all.filter((i) => i.changed).map(strip) };
}

export type DemoRemoval = { removed: DemoCounts; kept: KeptItem[] };

/**
 * Removes the store's demo content (the owner's one press on Home), in one transaction: see the module's comment. Names are read in
 * `locale`, the store's main language. The caller has checked the owner's role; it refreshes the store's, catalogue's, pages', terms' and
 * redirects' tags after.
 */
export async function removeDemoContent(accountId: string, storeId: string, locale: string): Promise<DemoRemoval> {
  const result = await db().transaction(async (tx) => {
    // One removal at a time per store: the marks are locked first, so a second press waits and then finds none.
    const marks = await tx.execute<Row>(sql`select kind from commerce.store_demo_items where store_id = ${storeId}::uuid for update`);
    if (marks.length === 0) return { removed: NO_DEMO, kept: [] as KeptItem[], gone: null };
    const kept: KeptItem[] = [];
    const keep = (rows: Row[], kind: DemoKind, reasonOf: (row: Row) => KeptReason | null) =>
      rows.filter((row) => {
        const reason = reasonOf(row);
        if (reason) kept.push({ kind, title: String(row.title), reason });
        return reason === null;
      });

    // Products: archived, so orders, stock movements and reports keep them. One archived already (by the setup wizard's *Remove the
    // demo products*, or by the owner) is gone from the shop too, so its menu links go with the rest.
    const products = await tx.execute<Row>(sql`
      select p.id, p.handle, p.status = 'archived' as archived, ${changedSince(sql`p`, sql`d`)} as changed, coalesce((
        select t.title from commerce.product_translations t where t.product_id = p.id order by (t.locale = ${locale}) desc, t.locale limit 1
      ), p.handle) as title
      from commerce.store_demo_items d join commerce.products p on p.id = d.ref_id and p.store_id = d.store_id
      where d.store_id = ${storeId}::uuid and d.kind = 'product'
      order by title, p.id
      for update of p
    `);
    const archived = products.filter((row) => row.archived);
    const archive = keep(products.filter((row) => !row.archived), "product", (row) => (row.changed ? "changed" : null));
    if (archive.length > 0) {
      await tx.execute(sql`
        update commerce.products set status = 'archived', updated_at = now()
        where store_id = ${storeId}::uuid and id = any(${`{${archive.map((r) => String(r.id)).join(",")}}`}::uuid[])
      `);
    }

    // Pages and articles: a page chosen for a role or as the All products page since is the store's working page, and a page in an
    // A/B test (running or not) is the test's, so both stay; the front page goes like any other (the store's standard front page shows).
    const pages = await tx.execute<Row>(sql`
      select pg.id, pg.slug, pg.type, ${changedSince(sql`pg`, sql`d`)} as changed,
        coalesce(nullif(pg.published ->> 'title', ''), nullif(pg.draft ->> 'title', ''), pg.slug) as title,
        (exists (select 1 from commerce.page_roles r where r.page_id = pg.id)
          or exists (select 1 from commerce.stores s where s.id = pg.store_id and s.products_page_id = pg.id)) as in_use,
        (exists (select 1 from commerce.experiments e where e.store_id = pg.store_id and e.target_page_id = pg.id)
          or exists (select 1 from commerce.experiment_variants v where v.page_id = pg.id)) as in_test
      from commerce.store_demo_items d join commerce.pages pg on pg.id = d.ref_id and pg.store_id = d.store_id
      where d.store_id = ${storeId}::uuid and d.kind = 'page'
      order by title, pg.id
      for update of pg
    `);
    const drop = keep(pages, "page", (row) => (row.changed ? "changed" : row.in_test ? "in_test" : row.in_use ? "in_use" : null));
    if (drop.length > 0) {
      await tx.execute(sql`
        delete from commerce.pages where store_id = ${storeId}::uuid and id = any(${`{${drop.map((r) => String(r.id)).join(",")}}`}::uuid[])
      `);
    }

    // Categories and tags, once the products and pages have gone: one a product that is not archived still has, or that a page left
    // holds (its own categories and tags, or a content grid that shows it), or that the owner chose a product page layout for, stays.
    const terms = await tx.execute<Row>(sql`
      select t.id, t.slug, t.kind, t.content_type, t.name as title, ${changedSince(sql`t`, sql`d`)} as changed,
        (t.product_layout_id is not null
          or exists (
            select 1 from commerce.product_terms pt join commerce.products p on p.id = pt.product_id
            where pt.term_id = t.id and p.status <> 'archived'
          )
          or exists (
            select 1 from commerce.pages pg where pg.store_id = t.store_id
              and (position(t.id::text in pg.draft::text) > 0 or position(t.id::text in coalesce(pg.published::text, '')) > 0)
          )) as in_use
      from commerce.store_demo_items d join commerce.terms t on t.id = d.ref_id and t.store_id = d.store_id
      where d.store_id = ${storeId}::uuid and d.kind = 'term'
      order by t.name, t.id
      for update of t
    `);
    const unterm = keep(terms, "term", (row) => (row.changed ? "changed" : row.in_use ? "in_use" : null));
    // One by one, as deleting a category does: its subcategories move up to its parent.
    for (const term of unterm) {
      await tx.execute(sql`
        update commerce.terms set parent_id = (select parent_id from commerce.terms where id = ${String(term.id)}::uuid)
        where parent_id = ${String(term.id)}::uuid
      `);
      await tx.execute(sql`delete from commerce.terms where id = ${String(term.id)}::uuid`);
    }

    // The menus lose their links to what went, the links under one moving up in its place.
    const termSlugs = (kind: string, contentType: string) =>
      unterm.filter((t) => t.kind === kind && t.content_type === contentType).map((t) => String(t.slug));
    const gone: RemovedAddresses = {
      products: [...archive, ...archived].map((r) => String(r.handle)),
      pages: drop.filter((r) => r.type === "page").map((r) => String(r.slug)),
      articles: drop.filter((r) => r.type === "article").map((r) => String(r.slug)),
      categories: termSlugs("category", "product"),
      tags: termSlugs("tag", "product"),
      blogCategories: termSlugs("category", "article"),
    };
    const menus = await tx.execute<Row>(sql`select id, items from commerce.menus where store_id = ${storeId}::uuid for update`);
    for (const menu of menus) {
      const items = Array.isArray(menu.items) ? (menu.items as { depth: number; link?: unknown }[]) : [];
      const left = withoutItems(
        items.map((item) => ({ ...item, depth: Number.isInteger(item.depth) ? item.depth : 0 })),
        (item) => linksToRemoved(item.link, gone),
      );
      if (left.length !== items.length) {
        await tx.execute(sql`
          update commerce.menus set items = ${JSON.stringify(left)}::jsonb, updated_at = now(), updated_by = ${accountId}::uuid
          where id = ${String(menu.id)}::uuid
        `);
      }
    }

    // What stayed is the owner's now.
    await tx.execute(sql`delete from commerce.store_demo_items where store_id = ${storeId}::uuid`);
    const removed: DemoCounts = {
      products: archive.length,
      pages: gone.pages.length,
      articles: gone.articles.length,
      categories: unterm.filter((t) => t.kind === "category").length,
      tags: unterm.filter((t) => t.kind === "tag").length,
    };
    return { removed, kept, gone };
  });
  if (result.gone) {
    await audit(accountId, storeId, "store.demo_removed", { ...result.removed, kept: result.kept.length });
  }
  return { removed: result.removed, kept: result.kept };
}
