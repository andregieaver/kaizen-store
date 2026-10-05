import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { FieldData } from "@/lib/custom-fields";
import type { ProductCsvContext, StoredProduct } from "@/lib/product-csv";
import type { PublishContext } from "@/lib/product-input";

import { getFieldData, getVariantFieldData, listFieldGroups } from "./custom-fields";
import { pgTextArray } from "./pg-arrays";
import { getEditorContext, getProductForEdit, type EditorContext } from "./products";
import { getStore, type Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * What the product import, export and bulk editor share (D165): the store of a job, the context of the product file, and a product as the
 * file holds it. A product is always read by the editor's own `getProductForEdit()`, so what is exported is what the editor shows and what
 * an import compares with is what the editor would save (`docs/wave-2-data.md` 2.2 rule 4). Nothing here writes.
 */

/** A store by its id, for a job that runs with no request (the cron, `after()`): its slug, then the store as the admin reads it. */
export async function storeOf(storeId: string): Promise<Store | null> {
  const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  return row ? getStore(String(row.slug)) : null;
}

/** The product file's context from the editor's: languages, markets with their VAT, terms, plain custom fields of products and variants. */
export async function csvContextFor(store: Store, editor: EditorContext): Promise<ProductCsvContext> {
  const groups = (await listFieldGroups(store.id)).filter((g) => g.active);
  const fields: ProductCsvContext["fields"] = [];
  for (const entity of ["product", "variant"] as const) {
    for (const group of groups.filter((g) => g.entities.includes(entity))) for (const def of group.fields) fields.push({ def, entity });
  }
  return {
    locales: editor.locales,
    primaryLocale: editor.primaryLocale,
    markets: editor.markets.map((m) => ({ code: m.code, currency: m.currency, name: m.name, vatRates: { ...m.vatRates } })),
    mainCurrency: editor.mainCurrency,
    audience: editor.audience,
    terms: editor.terms,
    fields,
    vatCategories: editor.vatCategories.filter((c) => c.active).map((c) => c.code),
  };
}

/** The editor's checks of a finished product, for the plan: the same data `saveProduct()` reads. */
export async function publishContextFor(editor: EditorContext): Promise<PublishContext> {
  const eu = await db().execute<Row>(sql`select code from commerce.countries where in_eu`);
  return {
    markets: editor.markets.map((m) => ({ code: m.code, currency: m.currency })),
    mainCurrency: editor.mainCurrency,
    primaryLocale: editor.primaryLocale,
    operatorCountries: Object.fromEntries(editor.operators.map((o) => [o.id, o.country])),
    euCountries: new Set(eu.map((r) => String(r.code))),
  };
}

/** A product as the file holds it: the editor's product, its archived flag, and the plain custom field values when the store has such fields. */
export async function loadStored(store: Store, editor: EditorContext, ctx: ProductCsvContext, productId: string): Promise<StoredProduct | null> {
  const product = await getProductForEdit(store, editor, productId);
  if (!product) return null;
  const stored: StoredProduct = { ...product, id: productId };
  if (ctx.fields.length > 0) {
    const [own, variants]: [FieldData, Record<string, FieldData>] = await Promise.all([getFieldData(store.id, "product", productId), getVariantFieldData(store.id, productId)]);
    stored.fieldData = { product: own, variants };
  }
  return stored;
}

/** Runs `work` over `items` with at most `limit` at a time, keeping the order of the results. */
export async function inBatches<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/** The picture addresses that are the store's own: its library's, and its own folder of the public bucket. */
export function ownPictureTest(storeId: string, known: ReadonlySet<string>): (url: string) => boolean {
  let prefix: string | null = null;
  try {
    // The public bucket's address of the store's folder; a test or local setup may have none.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    prefix = base ? `${base}/storage/v1/object/public/product-media/${storeId}/` : null;
  } catch {
    prefix = null;
  }
  return (url) => known.has(url) || (prefix !== null && url.startsWith(prefix));
}

/** Which of these addresses are in the store's media library (a picture or its small copy). */
export async function libraryAddresses(storeId: string, urls: readonly string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const list = pgTextArray(urls);
  const rows = await db().execute<Row>(sql`
    select url, thumbnail_url from commerce.media
    where store_id = ${storeId}::uuid and (url = any(${list}::text[]) or thumbnail_url = any(${list}::text[]))
  `);
  const found = new Set<string>();
  for (const r of rows) {
    if (r.url) found.add(String(r.url));
    if (r.thumbnail_url) found.add(String(r.thumbnail_url));
  }
  return found;
}

export { getEditorContext };

export { pgTextArray, pgUuidArray } from "./pg-arrays";
