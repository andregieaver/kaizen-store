import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { withoutVat } from "@/lib/b2b";
import { LOW_STOCK_AT } from "@/lib/control-center";
import { LIST_PAGE_SIZE } from "@/lib/list-page";
import { FEATURES_BY_ID, featureOn, kindFeature } from "@/lib/store-features";

import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's products as the admin lists them (round 2, D597; code review 1.13, D834): a page at a time with the count of all a filter
 * finds, its views by state and stock, a search by name, handle or SKU, and the figures of each view. The bulk tools' *Choose all that
 * match* reads the same filter and order (`matchingProductIds()`), so what it chooses is what the list shows on all its pages.
 */

/** The list's views: every current product, those on sale, the drafts, those that need stock (`LOW_STOCK_AT` or fewer), the archived. */
export const PRODUCT_SHOWS = ["all", "active", "draft", "stock", "archived"] as const;
export type ProductShow = (typeof PRODUCT_SHOWS)[number];
export type ProductListFilter = { show?: ProductShow; q?: string };

export type AdminProductRow = {
  id: string;
  handle: string;
  title: string;
  status: "draft" | "active" | "archived";
  image: string | null;
  variants: number;
  /** Units on hand across shipped variants. */
  stock: number;
  /** Active variants that are downloaded, which have no stock (D24). */
  digitalVariants: number;
  price: { min: number; max: number; currency: string } | null;
  /** The feature that is off and keeps the product from shoppers (D178: an appointment with Appointments off), or null. */
  hiddenBy: string | null;
};

/**
 * The products a filter finds, each with its variants, downloads and stock, and whether it keeps stock, is sold out or needs stock: the
 * `marked` rows of a `with`. A bundle's stock (D322) is what its components allow, worked out by the one reader of stock.
 */
function marked(storeId: string, { show = "all", q = "" }: ProductListFilter): SQL {
  const search = q.trim().toLowerCase().slice(0, 100);
  const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const state = show === "archived" ? sql`p.status = 'archived'` : show === "active" || show === "draft" ? sql`p.status = ${show}` : sql`p.status <> 'archived'`;
  return sql`
    listed as (
      select p.id, p.handle, p.status, p.kind, p.subscription_only, p.vat_category, p.updated_at,
        (select count(*)::int from commerce.product_variants v where v.product_id = p.id and v.active) as variants,
        (select count(*)::int from commerce.product_variants v where v.product_id = p.id and v.active and v.delivery = 'digital') as digital_variants,
        case when p.kind = 'bundle' then (
          select coalesce(sum(va.in_stock), 0)::int from commerce.variant_availability va
          join commerce.product_variants v on v.store_id = va.store_id and v.id = va.variant_id
          where v.product_id = p.id and v.active
        ) else (
          select coalesce(sum(greatest(l.on_hand, 0)), 0)::int
           from commerce.inventory_levels l
           join commerce.product_variants v on v.id = l.variant_id
          where v.product_id = p.id and v.active
        ) end as stock
      from commerce.products p
      where p.store_id = ${storeId}::uuid and ${state}
        ${search ? sql`and (lower(p.handle) like ${like}
          or exists (select 1 from commerce.product_translations t where t.product_id = p.id and lower(t.title) like ${like})
          or exists (select 1 from commerce.product_variants v where v.product_id = p.id and lower(v.sku) like ${like}))` : sql``}
    ),
    kept as (
      select l.*, not (l.digital_variants > 0 and l.digital_variants = l.variants) as keeps_stock from listed l
    ),
    marked as (
      select k.*, (k.keeps_stock and k.stock <= 0 and k.status <> 'archived') as sold_out,
        (k.keeps_stock and k.stock <= ${LOW_STOCK_AT} and k.status <> 'archived') as needs_stock
      from kept k
    )`;
}

/** The view's own condition over `marked`: only Needs stock asks more than `marked()` already did. */
const viewWhere = (show: ProductShow): SQL => (show === "stock" ? sql`needs_stock` : sql`true`);

/**
 * The list's order over the rows aliased `a`: in All, what costs sales first (sold out, then drafts, round 8, D626), then the most recently
 * changed; the handle and the id last, so a page's edge never loses or repeats a product.
 */
function order(a: string, show: ProductShow, soldOutFirst: boolean): SQL {
  const t = sql.raw(a);
  const first = soldOutFirst && show === "all" ? sql`${t}.sold_out desc, (${t}.status = 'draft') desc, ` : sql``;
  return sql`${first}${t}.updated_at desc, ${t}.handle, ${t}.id`;
}

const IDS_ROW = z.object({ id: col.uuid, total: col.int });

/** The ids of a filter's products in the list's order, at most `limit` of them, and how many it finds in all. */
export async function productIdsOf(storeId: string, filter: ProductListFilter, limit: number): Promise<{ ids: string[]; total: number }> {
  const rows = await typedRows(IDS_ROW, sql`
    with ${marked(storeId, filter)}
    select m.id, count(*) over ()::int as total from marked m where ${viewWhere(filter.show ?? "all")}
    order by ${order("m", filter.show ?? "all", true)}
    limit ${limit}
  `);
  return { ids: rows.map((r) => r.id), total: rows[0]?.total ?? 0 };
}

const PRODUCT_ROW = z.object({
  id: col.uuid,
  handle: col.text,
  status: z.enum(["draft", "active", "archived"]),
  kind: col.text,
  subscription_only: col.bool,
  title: col.text,
  image: col.textOrNull,
  variants: col.int,
  digital_variants: col.int,
  stock: col.int,
  min_amount: col.minorOrNull,
  max_amount: col.minorOrNull,
  currency: col.currency.nullable(),
  vat_rate: col.decimal.nullable(),
  /** How many the filter finds in all, on every page. */
  total: col.int,
});

/**
 * A page of the store's products for the admin list: `limit` from `offset` (a hundred unless said; `null` for every one), with the price in
 * the store's first market, and how many the filter finds in all.
 */
export async function adminProductPage(
  store: Store,
  { show = "all", q = "", limit = LIST_PAGE_SIZE, offset = 0, soldOutFirst = true }: ProductListFilter & { limit?: number | null; offset?: number; soldOutFirst?: boolean } = {},
): Promise<{ rows: AdminProductRow[]; total: number }> {
  const market = store.markets[0];
  const locale = market?.locale ?? "en";
  const rows = await typedRows(PRODUCT_ROW, sql`
    with ${marked(store.id, { show, q })},
    page as (
      select m.*, count(*) over ()::int as total from marked m where ${viewWhere(show)}
      order by ${order("m", show, soldOutFirst)}
      ${limit === null ? sql`` : sql`limit ${limit} offset ${offset}`}
    )
    select pg.id, pg.handle, pg.status, pg.kind, pg.subscription_only, pg.variants, pg.digital_variants, pg.stock, pg.total,
      coalesce(tl.title, tf.title, pg.handle) as title,
      (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m where m.product_id = pg.id order by m.position limit 1) as image,
      pr.min_amount, pr.max_amount, pr.currency,
      commerce.vat_rate(${market?.code ?? ""}, pg.vat_category) as vat_rate
    from page pg
    left join commerce.product_translations tl on tl.product_id = pg.id and tl.locale = ${locale}
    left join lateral (
      select title from commerce.product_translations where product_id = pg.id order by locale limit 1
    ) tf on true
    left join lateral (
      select min(c.amount_minor) as min_amount, max(c.amount_minor) as max_amount, min(c.currency) as currency
      from commerce.kept_prices c
      join commerce.product_variants v on v.id = c.variant_id and v.active
      where v.product_id = pg.id and c.market_code = ${market?.code ?? ""}
    ) pr on true
    order by ${order("pg", show, soldOutFirst)}
  `);
  // A store selling only to businesses sees its prices as it types them: without VAT (B2B).
  const shown = (amount: number, rate: number | null) => (store.audience === "businesses" ? withoutVat(amount, rate ?? 0) : amount);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      handle: row.handle,
      title: row.title,
      status: row.status,
      image: row.image,
      variants: row.variants,
      stock: row.stock,
      digitalVariants: row.digital_variants,
      price:
        row.min_amount === null || row.max_amount === null
          ? null
          : { min: shown(row.min_amount, row.vat_rate), max: shown(row.max_amount, row.vat_rate), currency: row.currency ?? "" },
      hiddenBy: hiddenBy(store, row.kind, row.subscription_only),
    })),
    total: rows[0]?.total ?? 0,
  };
}

/** Every current (or archived) product, most recently changed first: for the AI manager's tool, which filters for itself. */
export async function listAdminProducts(store: Store, { archived = false }: { archived?: boolean } = {}): Promise<AdminProductRow[]> {
  return (await adminProductPage(store, { show: archived ? "archived" : "all", limit: null, soldOutFirst: false })).rows;
}

const COUNTS_ROW = z.object({ current: col.int, active: col.int, draft: col.int, stock: col.int, sold_out: col.int });

export type ProductCounts = { all: number; active: number; draft: number; stock: number; soldOut: number };

/** The figures of the list's views over the current products, whatever the search: All, On sale, Drafts, Needs stock, and how many are sold out. */
export async function adminProductCounts(storeId: string): Promise<ProductCounts> {
  const row = await typedRow(COUNTS_ROW, sql`
    with ${marked(storeId, {})}
    select count(*)::int as current,
      (count(*) filter (where status = 'active'))::int as active,
      (count(*) filter (where status = 'draft'))::int as draft,
      (count(*) filter (where needs_stock))::int as stock,
      (count(*) filter (where sold_out))::int as sold_out
    from marked
  `);
  return { all: row?.current ?? 0, active: row?.active ?? 0, draft: row?.draft ?? 0, stock: row?.stock ?? 0, soldOut: row?.sold_out ?? 0 };
}

/** The label of the feature that keeps a product of this kind from shoppers while it is off (D178), or null when it is offered. */
function hiddenBy(store: Store, kind: string, subscriptionOnly: boolean): string | null {
  const needed = kindFeature(kind);
  if (needed && !featureOn(store, needed)) return FEATURES_BY_ID[needed].label;
  if (subscriptionOnly && !featureOn(store, "subscriptions")) return FEATURES_BY_ID.subscriptions.label;
  return null;
}
