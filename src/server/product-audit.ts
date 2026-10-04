import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { measureFromColumns } from "@/lib/unit-price";

import { auditChange, type AuditActor } from "./audit";

type Row = Record<string, unknown>;

/**
 * The activity log's entries for products and their prices (wave 1, 1f, docs/wave-1-trust.md 2.10). `saveProduct()` wrote no entry at all
 * and `commerce.set_price` is called without one, so the criterion "product and price changes write an entry" needs these. They are
 * read around the save (the product as it stood and as it is), so the save's own transaction is untouched: a price that changed is the
 * difference between two reads of the current prices, never a second place that works out what a price is. Stock is not audited (it has
 * its own history), and nothing here carries text beyond the title.
 */

export type ProductFacts = {
  title: string;
  status: string;
  handle: string;
  kind: string;
  vatCategory: string;
  categoryIds: string[];
  tagIds: string[];
  variantCount: number;
  /** Unit price (D160): sold by measure, and each variant's content as "SKU: 250 g" (no price, no secret). */
  soldByMeasure: boolean;
  measures: string[];
};

/** One current price: a variant's in a market, in minor units of that market's own currency. */
export type PriceFact = { sku: string; market: string; currency: string; amountMinor: number };

export type ProductSnapshot = { facts: ProductFacts; prices: PriceFact[] };

/** The product as it stands now, for the audit's before and after; null for one the store does not have. Every query carries the store id. */
export async function productSnapshot(storeId: string, productId: string, primaryLocale: string): Promise<ProductSnapshot | null> {
  const [product] = await db().execute<Row>(sql`
    select p.handle, p.status, p.kind, p.vat_category, p.sold_by_measure,
      coalesce((select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id and t.locale = ${primaryLocale}),
               (select t.title from commerce.product_translations t where t.store_id = p.store_id and t.product_id = p.id order by t.locale limit 1), p.handle) as title,
      (select count(*)::int from commerce.product_variants v where v.store_id = p.store_id and v.product_id = p.id and v.active) as variant_count
    from commerce.products p where p.store_id = ${storeId}::uuid and p.id = ${productId}::uuid
  `);
  if (!product) return null;
  const terms = await db().execute<Row>(sql`
    select pt.term_id, tm.kind from commerce.product_terms pt join commerce.terms tm on tm.id = pt.term_id
    where pt.store_id = ${storeId}::uuid and pt.product_id = ${productId}::uuid order by pt.term_id
  `);
  const contents = await db().execute<Row>(sql`
    select v.sku, v.measure_amount, v.measure_unit, v.measure_base from commerce.product_variants v
    where v.store_id = ${storeId}::uuid and v.product_id = ${productId}::uuid and v.active and v.measure_amount is not null
    order by v.sku
  `);
  const prices = await db().execute<Row>(sql`
    select v.sku, pr.market_code, pr.amount_minor, m.currency
    from commerce.prices pr
    join commerce.product_variants v on v.id = pr.variant_id and v.store_id = ${storeId}::uuid
    join commerce.markets m on m.store_id = v.store_id and m.code = pr.market_code
    where v.product_id = ${productId}::uuid and pr.valid_to is null
    order by v.sku, pr.market_code
  `);
  return {
    facts: {
      title: String(product.title),
      status: String(product.status),
      handle: String(product.handle),
      kind: String(product.kind),
      vatCategory: String(product.vat_category),
      categoryIds: terms.filter((t) => t.kind === "category").map((t) => String(t.term_id)),
      tagIds: terms.filter((t) => t.kind === "tag").map((t) => String(t.term_id)),
      variantCount: Number(product.variant_count),
      soldByMeasure: Boolean(product.sold_by_measure),
      measures: contents.map((c) => {
        const measure = measureFromColumns(c.measure_amount, c.measure_unit);
        return `${String(c.sku)}: ${measure ? `${measure.amount} ${measure.unit}` : "?"}${c.measure_base ? ` per ${String(c.measure_base)}` : ""}`;
      }),
    },
    prices: prices.map((p) => ({ sku: String(p.sku), market: String(p.market_code), currency: String(p.currency).trim(), amountMinor: Number(p.amount_minor) })),
  };
}

/** The price entries between two snapshots: each (SKU, market) whose current price differs, a new price from null and an ended one to null. */
export function priceChanges(before: readonly PriceFact[], after: readonly PriceFact[]): { sku: string; market: string; currency: string; from: number | null; to: number | null }[] {
  const key = (p: Pick<PriceFact, "sku" | "market">) => `${p.sku}\u0000${p.market}`;
  const was = new Map(before.map((p) => [key(p), p]));
  const now = new Map(after.map((p) => [key(p), p]));
  const changes: { sku: string; market: string; currency: string; from: number | null; to: number | null }[] = [];
  for (const [k, p] of now) {
    const old = was.get(k);
    if (!old || old.amountMinor !== p.amountMinor) changes.push({ sku: p.sku, market: p.market, currency: p.currency, from: old ? old.amountMinor : null, to: p.amountMinor });
  }
  for (const [k, p] of was) if (!now.has(k)) changes.push({ sku: p.sku, market: p.market, currency: p.currency, from: p.amountMinor, to: null });
  return changes;
}

/**
 * Writes what a save of a product did: `product.created`, `product.updated` or `product.archived` with the changed fields, and a
 * `product.price_changed` for each price that changed. Never throws: the product is already saved.
 */
export async function auditProductSave(actor: AuditActor, productId: string, before: ProductSnapshot | null, after: ProductSnapshot | null): Promise<void> {
  if (!after) return;
  const archived = after.facts.status === "archived" && before?.facts.status !== "archived";
  const action = before === null ? "product.created" : archived ? "product.archived" : "product.updated";
  await auditChange(actor, action, { type: "product", id: productId, label: after.facts.title }, before && { ...before.facts }, { ...after.facts }, "product");
  for (const change of priceChanges(before?.prices ?? [], after.prices)) {
    await auditChange(
      actor,
      "product.price_changed",
      { type: "product", id: productId, label: `${after.facts.title} (${change.sku})` },
      { priceMinor: change.from },
      { priceMinor: change.to },
      "price",
      { sku: change.sku, market: change.market, currency: change.currency },
    );
  }
}
