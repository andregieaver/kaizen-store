import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { CreditNoteSnapshot } from "@/lib/credit-allocation";
import { creditNoteCsv, invoiceCsv } from "@/lib/invoice-csv";
import type { OrderInvoiceSnapshot } from "@/lib/invoice-snapshot";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * The accountant's CSV of invoices or credit notes (D159, `docs/wave-1b-invoices.md` 2.3): one row per document in a period of store days,
 * the VAT per rate, the VAT in the seller's currency, the treatment. It holds personal data (a buyer's name and VAT number), so it is for
 * `orders:write` and every export is written to the activity log as `invoice.exported` (the period and the count, never a name). Text
 * cells are made formula-safe by `toCsv()`. Bounded: a period with more documents than `MAX_ROWS` is cut and says so.
 */

export const MAX_ROWS = 20_000;
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export type ExportResult =
  | { ok: true; csv: string; count: number; truncated: boolean; fileName: string }
  | { ok: false; problem: string };

export async function exportDocuments(membership: Membership, type: "invoices" | "credit_notes", from: unknown, to: unknown): Promise<ExportResult> {
  const { store, account } = membership;
  if (!memberCan(membership, "orders:write")) return { ok: false, problem: "You do not have access to this." };
  if (!isDay(from) || !isDay(to) || from > to) return { ok: false, problem: "Choose a period: a first and a last day, the first not after the last." };
  const rows =
    type === "invoices"
      ? await db().execute<Row>(sql`
          select i.document_number, o.number as order_number, i.snapshot from commerce.invoices i
          join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
          where i.store_id = ${store.id}::uuid and i.issued_on >= ${from}::date and i.issued_on <= ${to}::date
          order by i.issued_on, i.number limit ${MAX_ROWS + 1}
        `)
      : await db().execute<Row>(sql`
          select c.document_number, o.number as order_number, c.snapshot from commerce.credit_notes c
          join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
          join commerce.orders o on o.store_id = i.store_id and o.id = i.order_id
          where c.store_id = ${store.id}::uuid and c.issued_on >= ${from}::date and c.issued_on <= ${to}::date
          order by c.issued_on, c.number limit ${MAX_ROWS + 1}
        `);
  const truncated = rows.length > MAX_ROWS;
  const kept = rows.slice(0, MAX_ROWS);
  const csv =
    type === "invoices"
      ? invoiceCsv(kept.map((r) => ({ documentNumber: String(r.document_number), orderNumber: String(r.order_number), snapshot: r.snapshot as OrderInvoiceSnapshot })))
      : creditNoteCsv(kept.map((r) => ({ documentNumber: String(r.document_number), orderNumber: String(r.order_number), snapshot: r.snapshot as CreditNoteSnapshot })));
  await audit(account.id, store.id, "invoice.exported", { type, from, to, count: kept.length, truncated });
  return { ok: true, csv, count: kept.length, truncated, fileName: `${type === "invoices" ? "invoices" : "credit-notes"}-${from}-${to}.csv` };
}
