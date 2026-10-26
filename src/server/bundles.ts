import "server-only";

import { sql } from "drizzle-orm";

import type { Db } from "@/db/client";
import { variantLabel, type BundleInput, type ProductInput } from "@/lib/product-input";

import { OFFERED } from "./product-conditions";

type Row = Record<string, unknown>;
type Runner = Pick<Db, "execute">;

/**
 * Bundles (wave 6 unit D, D322, `docs/wave-6-catalogue.md` D.1): a bundle's components as the editor and the product page read them, the
 * writer `saveProduct()` calls for them, and the expansion `planRestock()` uses. The database holds the rules again (`bundle_problem()`), works
 * out a bundle's stock (`variant_availability`) and a computed price (`refresh_bundle_prices()`).
 */

/** A component as the editor shows it: what it is, how many are in stock and its prices per market (minor units, with VAT as kept). */
export type ComponentFacts = {
  variantId: string;
  productId: string;
  title: string;
  sku: string;
  kind: string;
  delivery: string;
  vatCategory: string;
  status: string;
  active: boolean;
  inStock: number;
  prices: Record<string, number>;
};

/** The facts of the given variants of the store, by id (a variant of another store is not found). */
export async function componentFacts(reader: Runner, storeId: string, variantIds: readonly string[], locale: string): Promise<Map<string, ComponentFacts>> {
  const out = new Map<string, ComponentFacts>();
  if (variantIds.length === 0) return out;
  const ids = sql.join([...new Set(variantIds)].map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await reader.execute<Row>(sql`
    select v.id, v.product_id, v.sku, v.options, v.delivery::text as delivery, v.active, p.kind, p.vat_category, p.status::text as status,
           coalesce(tl.title, tf.title, p.handle) as title, coalesce(va.in_stock, 0)::int as in_stock,
           coalesce((select jsonb_object_agg(pr.market_code, pr.amount_minor) from commerce.prices pr where pr.variant_id = v.id and pr.valid_to is null), '{}'::jsonb) as prices
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join commerce.variant_availability va on va.store_id = v.store_id and va.variant_id = v.id
    where v.store_id = ${storeId}::uuid and v.id in (${ids})
  `);
  for (const row of rows) {
    const options = (row.options ?? {}) as Record<string, string>;
    const named = Object.keys(options).length > 0 ? `${row.title} (${variantLabel(options)})` : String(row.title);
    out.set(String(row.id), {
      variantId: String(row.id),
      productId: String(row.product_id),
      title: named,
      sku: String(row.sku),
      kind: String(row.kind),
      delivery: String(row.delivery),
      vatCategory: String(row.vat_category),
      status: String(row.status),
      active: Boolean(row.active),
      inStock: Number(row.in_stock),
      prices: Object.fromEntries(Object.entries((row.prices ?? {}) as Record<string, number | string>).map(([code, amount]) => [code, Number(amount)])),
    });
  }
  return out;
}

/** Goods variants of the store a bundle can take, found by title or SKU (the editor's search): never a bundle's, never archived, at most 20. */
export async function searchComponents(reader: Runner, storeId: string, query: string, locale: string): Promise<ComponentFacts[]> {
  const words = query.trim().slice(0, 80);
  if (words.length < 1) return [];
  const like = `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await reader.execute<Row>(sql`
    select v.id
    from commerce.product_variants v
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
    where v.store_id = ${storeId}::uuid and p.kind = 'goods' and v.delivery = 'physical' and v.active and p.status <> 'archived'
      and (v.sku ilike ${like} or coalesce(tl.title, p.handle) ilike ${like})
    order by coalesce(tl.title, p.handle), v.sku
    limit 20
  `);
  const facts = await componentFacts(reader, storeId, rows.map((r) => String(r.id)), locale);
  return rows.map((r) => facts.get(String(r.id))).filter((f): f is ComponentFacts => f !== undefined);
}

/** A bundle's pricing and components as kept (D322), for the editor; null for a product that is not a bundle. */
export async function bundleForEdit(reader: Runner, storeId: string, productId: string): Promise<BundleInput | null> {
  const [product] = await reader.execute<Row>(sql`
    select bundle_pricing, bundle_percent_off from commerce.products where store_id = ${storeId}::uuid and id = ${productId}::uuid and kind = 'bundle'
  `);
  if (!product) return null;
  const rows = await reader.execute<Row>(sql`
    select bc.component_variant_id, bc.quantity
    from commerce.bundle_components bc
    join commerce.product_variants v on v.store_id = bc.store_id and v.id = bc.bundle_variant_id
    where bc.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid
    order by bc.position, bc.created_at
  `);
  return {
    pricing: product.bundle_pricing === "computed" ? "computed" : "fixed",
    percentOff: Number(product.bundle_percent_off ?? 0),
    components: rows.map((r) => ({ variantId: String(r.component_variant_id), quantity: Number(r.quantity) })),
  };
}

/**
 * Sentences for the components a save would keep that the database would refuse (D322): not the store's, not goods sent by post, archived,
 * or of another VAT category than the bundle. Empty when all can go in.
 */
export async function componentProblems(reader: Runner, storeId: string, input: ProductInput, locale: string): Promise<string[]> {
  const components = input.bundle?.components ?? [];
  if (input.kind !== "bundle" || components.length === 0) return [];
  const facts = await componentFacts(reader, storeId, components.map((c) => c.variantId), locale);
  const problems: string[] = [];
  for (const component of components) {
    const fact = facts.get(component.variantId);
    if (!fact) {
      problems.push("A component is no longer in the store: take it out of the bundle.");
    } else if (fact.kind !== "goods" || fact.delivery !== "physical") {
      problems.push(`${fact.title} cannot go in a bundle: only goods sent by post can.`);
    } else if (fact.status === "archived") {
      problems.push(`${fact.title} is archived: take it out of the bundle, or bring it back first.`);
    } else if (fact.vatCategory !== input.vatCategory) {
      problems.push(`${fact.title} takes another VAT category than the bundle: a bundle and its components take one.`);
    }
  }
  return problems;
}

/** Writes a bundle's components for its one variant (D322): the list as given, in its order; the database checks them and sets a computed price at commit. */
export async function saveBundleComponents(tx: Runner, storeId: string, productId: string, input: ProductInput): Promise<void> {
  const [variant] = await tx.execute<Row>(sql`
    select id from commerce.product_variants where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and active
    order by created_at limit 1
  `);
  await tx.execute(sql`
    delete from commerce.bundle_components bc
    using commerce.product_variants v
    where bc.store_id = ${storeId}::uuid and v.store_id = bc.store_id and v.id = bc.bundle_variant_id and v.product_id = ${productId}::uuid
  `);
  if (input.kind !== "bundle" || !input.bundle || !variant) return;
  const rows = input.bundle.components.map((c, position) => ({ variant_id: c.variantId, quantity: c.quantity, position }));
  if (rows.length === 0) return;
  await tx.execute(sql`
    insert into commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position)
    select ${storeId}::uuid, ${String(variant.id)}::uuid, r.variant_id, r.quantity, r.position
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(variant_id uuid, quantity integer, position integer)
  `);
}

/** What one bundle of a line was made of when it was sold (D322): its frozen components. */
export type SoldComponent = { variantId: string; sku: string; title: string; quantity: number };

/** The frozen components of an order's bundle lines, by the line's variant (a bundle is one line of an order). */
export async function soldComponentsByVariant(reader: Runner, storeId: string, orderId: string): Promise<Map<string, SoldComponent[]>> {
  const rows = await reader.execute<Row>(sql`
    select ol.variant_id as bundle_variant_id, ol.id as line_id, c.variant_id, c.sku, c.title, c.quantity
    from commerce.order_line_components c
    join commerce.order_lines ol on ol.store_id = c.store_id and ol.id = c.order_line_id
    where c.store_id = ${storeId}::uuid and ol.order_id = ${orderId}::uuid
    order by ol.variant_id, ol.id, c.position, c.sku
  `);
  const out = new Map<string, SoldComponent[]>();
  // One line per bundle; were there two of one variant, the first one's components stand for both.
  const lineOf = new Map<string, string>();
  for (const row of rows) {
    const key = String(row.bundle_variant_id);
    if ((lineOf.get(key) ?? String(row.line_id)) !== String(row.line_id)) continue;
    lineOf.set(key, String(row.line_id));
    const list = out.get(key) ?? [];
    list.push({ variantId: String(row.variant_id), sku: String(row.sku), title: String(row.title), quantity: Number(row.quantity) });
    out.set(key, list);
  }
  return out;
}

/**
 * Restock items with every bundle replaced by its components (D322): a bundle's units going back are its frozen components times them, at the
 * same chosen location. Items of plain variants are kept as they are.
 */
export async function expandBundleItems<T extends { variantId: string; sku: string; quantity: number; chosen?: string | null }>(
  reader: Runner,
  storeId: string,
  orderId: string,
  items: readonly T[],
): Promise<(T & { bundleSku?: string })[]> {
  if (items.length === 0) return [];
  const sold = await soldComponentsByVariant(reader, storeId, orderId);
  if (sold.size === 0) return [...items];
  return items.flatMap((item) => {
    const components = sold.get(item.variantId);
    if (!components) return [item];
    // Each component remembers the bundle it went back for, so the bundle's line counts the units and the components' own lines do not.
    return components.map((c) => ({ ...item, variantId: c.variantId, sku: c.sku, quantity: c.quantity * item.quantity, bundleSku: item.sku }));
  });
}

/**
 * What a bundle holds as its page shows it (D322): each component's title in the page's language (with its options), how many, and its own
 * product's address where that is offered to shoppers. Read inside the catalogue's cached `getProduct()`, so nothing here is per visitor.
 */
export async function bundleItemsOf(reader: Runner, storeId: string, productId: string, locale: string): Promise<{ title: string; quantity: number; handle: string | null }[]> {
  const rows = await reader.execute<Row>(sql`
    select bc.quantity, cv.options, p.handle, (p.status = 'active' and ${OFFERED}) as linked,
      coalesce((select t.title from commerce.product_translations t where t.product_id = p.id and t.locale = ${locale}),
               (select t.title from commerce.product_translations t where t.product_id = p.id order by t.locale limit 1), p.handle) as title
    from commerce.bundle_components bc
    join commerce.product_variants bv on bv.store_id = bc.store_id and bv.id = bc.bundle_variant_id and bv.product_id = ${productId}::uuid
    join commerce.product_variants cv on cv.store_id = bc.store_id and cv.id = bc.component_variant_id
    join commerce.products p on p.store_id = cv.store_id and p.id = cv.product_id
    where bc.store_id = ${storeId}::uuid
    order by bc.position, cv.sku
  `);
  return rows.map((row) => {
    const options = Object.values((row.options ?? {}) as Record<string, string>);
    const title = String(row.title);
    return { title: options.length > 0 ? `${title} (${options.join(" / ")})` : title, quantity: Number(row.quantity), handle: row.linked ? String(row.handle) : null };
  });
}
