import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isDialect, type Cell, type DialectId } from "@/lib/csv";
import { productColumns, productRowsOf } from "@/lib/product-csv";
import type { Store } from "./stores";

import type { ExportReader } from "./data-export-run";
import { csvContextFor, getEditorContext, inBatches, loadStored } from "./product-data";

type Row = Record<string, unknown>;

/**
 * The product export (D165, `docs/wave-2-data.md` 2.1): one row per variant of the store's products, in the Kaizen layout of 4.1 that an
 * import reads back as it is. The rows come from `getProductForEdit()` (the editor's own door), a product at a time in handle order, so the
 * export holds exactly what the editor shows; the columns and cells are `src/lib/product-csv.ts`'s. The store id is on every statement.
 */

export type ProductExportOptions = {
  /** Every product, the products of one status, or the products of a category or tag. */
  scope: "all" | "status" | "term";
  status?: "active" | "draft" | "archived";
  termId?: string;
  dialect: DialectId;
  /** Include the pictures' addresses (the store's own library addresses). */
  pictures: boolean;
};

const optionsSchema = z.object({
  scope: z.enum(["all", "status", "term"]).default("all"),
  status: z.enum(["active", "draft", "archived"]).optional(),
  termId: z.uuid().optional(),
  dialect: z.string().default("standard"),
  pictures: z.union([z.boolean(), z.enum(["true", "false", "on", "off", "1", "0"])]).default(true),
});

/** The options a form or a job holds, checked: a scope that needs a status or a term has one. */
export function parseProductExportOptions(raw: unknown): { ok: true; options: ProductExportOptions } | { ok: false; problem: string } {
  const parsed = optionsSchema.safeParse(typeof raw === "object" && raw !== null ? raw : {});
  if (!parsed.success) return { ok: false, problem: "The choices for the export could not be read." };
  const o = parsed.data;
  if (o.scope === "status" && !o.status) return { ok: false, problem: "Choose a status." };
  if (o.scope === "term" && !o.termId) return { ok: false, problem: "Choose a category or tag." };
  if (!isDialect(o.dialect)) return { ok: false, problem: "Choose a file format." };
  const pictures = o.pictures === true || o.pictures === "true" || o.pictures === "on" || o.pictures === "1";
  return { ok: true, options: { scope: o.scope, ...(o.scope === "status" ? { status: o.status } : {}), ...(o.scope === "term" ? { termId: o.termId } : {}), dialect: o.dialect, pictures } };
}

/** The picture columns, left out of the file when the member asked for no pictures. */
export const PICTURE_COLUMNS: readonly string[] = ["image_url", "image_position", "image_alt", "variant_image_url"];

const filterOf = (storeId: string, o: ProductExportOptions) => sql`
  p.store_id = ${storeId}::uuid
  ${o.scope === "status" ? sql`and p.status = ${o.status}` : sql``}
  ${o.scope === "term" ? sql`and exists (select 1 from commerce.product_terms pt where pt.store_id = p.store_id and pt.product_id = p.id and pt.term_id = ${o.termId}::uuid)` : sql``}
`;

/** The rows the file will have (a row per variant, and the extra picture rows), for the choice between a download and a job and for the limit. */
export async function countProductExportRows(storeId: string, o: ProductExportOptions): Promise<{ products: number; rows: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as products,
      coalesce(sum(greatest(v.n, 1) + ${o.pictures ? sql`greatest(0, m.n - greatest(v.n, 1))` : sql`0`}), 0)::bigint as rows
    from commerce.products p
    left join lateral (select count(*) as n from commerce.product_variants v where v.product_id = p.id) v on true
    left join lateral (select count(*) as n from commerce.product_media m where m.product_id = p.id) m on true
    where ${filterOf(storeId, o)}
  `);
  return { products: Number(row?.products ?? 0), rows: Number(row?.rows ?? 0) };
}

/** The reader of an export of the store's products. */
export async function productExportReader(store: Store, o: ProductExportOptions): Promise<ExportReader> {
  const editor = await getEditorContext(store);
  const ctx = await csvContextFor(store, editor);
  const header = productColumns(ctx);
  const keep = header.map((name, i) => (o.pictures || !PICTURE_COLUMNS.includes(name) ? i : -1)).filter((i) => i >= 0);
  const pick = (cells: readonly Cell[]): Cell[] => keep.map((i) => cells[i] ?? null);
  return {
    header: pick(header),
    dialect: o.dialect,
    fileBase: "products",
    total: async () => (await countProductExportRows(store.id, o)).products,
    async read(position, limit) {
      const after = typeof position === "string" ? position : null;
      // The rows are read in the number the job asks for, products at a time: a product is many cells.
      const take = Math.min(limit, 50);
      const ids = await db().execute<Row>(sql`
        select p.id, p.handle from commerce.products p
        where ${filterOf(store.id, o)} ${after === null ? sql`` : sql`and p.handle > ${after}`}
        order by p.handle limit ${take + 1}
      `);
      const page = ids.slice(0, take);
      const stored = await inBatches(page, 8, (r) => loadStored(store, editor, ctx, String(r.id)));
      const rows: Cell[][] = [];
      for (const product of stored) {
        if (!product) continue;
        for (const cells of productRowsOf(product, ctx)) rows.push(pick(cells));
      }
      const last = page.at(-1);
      return { rows, position: last ? String(last.handle) : after, more: ids.length > take, units: page.length };
    },
  };
}
