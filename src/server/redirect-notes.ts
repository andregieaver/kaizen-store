import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { productAddressChange, termAddressChange, type AddressChange } from "@/lib/redirect-admin";

import { refreshRedirects } from "./redirect-live";

type Row = Record<string, unknown>;

/**
 * What the product editor and the category and tag editor say when a save changed an address (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.2.6): the
 * old address now redirects to the new one. The redirect itself is made by the database's triggers (`commerce.products_leave_redirect()`,
 * `commerce.terms_leave_redirect()`), so these only READ: before a save, the address the thing has; after it, whether the address changed AND a redirect from the
 * old one exists (a product that was never live leaves none, since nobody has the address, and the editor must not claim one). Every statement carries the store
 * id. Nothing here writes `commerce.redirects`.
 */

export type AddressBefore = { kind: "product"; id: string; handle: string } | { kind: "category" | "tag"; id: string; slug: string };

/** The address a product or a term has now, for the editor to compare after its save; null when there is none (a new thing, another store's). */
export async function addressBefore(storeId: string, thing: { product: string } | { term: string }): Promise<AddressBefore | null> {
  if ("product" in thing) {
    const [row] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${storeId}::uuid and id = ${thing.product}::uuid`);
    return row ? { kind: "product", id: thing.product, handle: String(row.handle) } : null;
  }
  const [row] = await db().execute<Row>(sql`select kind, slug from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and id = ${thing.term}::uuid`);
  return row ? { kind: String(row.kind) as "category" | "tag", id: thing.term, slug: String(row.slug) } : null;
}

/**
 * The pair of addresses a save changed, or null when the address did not change or no redirect was left. A cached lookup of a missing address is refreshed
 * when there is one, so an address that was a cached not-found a moment ago redirects at once.
 */
export async function addressChangedAfter(storeId: string, before: AddressBefore | null): Promise<AddressChange | null> {
  if (!before) return null;
  if (before.kind === "product") {
    const [now] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${storeId}::uuid and id = ${before.id}::uuid`);
    if (!now || String(now.handle) === before.handle) return null;
    const [found] = await db().execute<Row>(sql`
      select 1 as x from commerce.redirects where store_id = ${storeId}::uuid and kind = 'product' and product_id = ${before.id}::uuid and source = ${`/p/${before.handle}`}
    `);
    const change = productAddressChange(before.handle, String(now.handle), Boolean(found));
    if (change) refreshRedirects(storeId);
    return change;
  }
  const [now] = await db().execute<Row>(sql`select slug from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and id = ${before.id}::uuid`);
  if (!now || String(now.slug) === before.slug) return null;
  const [found] = await db().execute<Row>(sql`
    select 1 as x from commerce.redirects where store_id = ${storeId}::uuid and kind = ${before.kind} and term_id = ${before.id}::uuid and source = ${`/${before.kind}/${before.slug}`}
  `);
  const change = termAddressChange(before.kind, before.slug, String(now.slug), Boolean(found));
  if (change) refreshRedirects(storeId);
  return change;
}
