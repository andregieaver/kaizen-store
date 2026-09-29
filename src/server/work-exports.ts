import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { isDay, type Day } from "@/lib/work-dates";

import { listWorkInvoices, type InvoiceListFilter } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * What Work's spreadsheet exports read (docs/work.md 1.9, 7.2 WP7b): the invoice register for the accountant and the
 * payments received. Read only, and only the store's own rows (every query takes the store id). The register goes
 * through `listWorkInvoices()`, so it is exactly the list the person is looking at (same filters), one page at a time
 * up to `EXPORT_MAX`; drafts are left out (they have no number and are not accounting documents). The text is turned
 * into CSV by `src/lib/work-csv.ts` (formula-safe); amounts here are integers in minor units.
 */

export const EXPORT_MAX = 5000;
const PAGE = 100;

export type RegisterRow = {
  documentNumber: string;
  clientName: string;
  status: string;
  issuedOn: Day;
  dueOn: Day;
  currency: string;
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  paidMinor: number;
};

/** The issued invoices the list's filter finds, oldest first, with their frozen subtotal and VAT. */
export async function invoiceRegister(storeId: string, filter: InvoiceListFilter): Promise<RegisterRow[]> {
  const rows: Awaited<ReturnType<typeof listWorkInvoices>>["rows"] = [];
  for (let page = 1; rows.length < EXPORT_MAX; page++) {
    const list = await listWorkInvoices(storeId, { ...filter, sort: "oldest", page, pageSize: PAGE });
    rows.push(...list.rows.filter((r) => r.status !== "draft" && r.documentNumber && r.issuedOn && r.dueOn));
    if (page * PAGE >= list.total) break;
  }
  const kept = rows.slice(0, EXPORT_MAX);
  if (kept.length === 0) return [];
  const frozen = await readDb().execute<Row>(sql`
    select id, subtotal_minor, vat_minor from commerce.work_invoices
    where store_id = ${storeId}::uuid and id in (${sql.join(
      kept.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    )})
  `);
  const byId = new Map(frozen.map((r) => [String(r.id), r]));
  return kept.map((r) => ({
    documentNumber: r.documentNumber as string,
    clientName: r.clientName,
    status: r.status,
    issuedOn: r.issuedOn as Day,
    dueOn: r.dueOn as Day,
    currency: r.currency,
    subtotalMinor: Number(byId.get(r.id)?.subtotal_minor ?? 0),
    vatMinor: Number(byId.get(r.id)?.vat_minor ?? 0),
    totalMinor: r.totalMinor,
    paidMinor: r.paidMinor,
  }));
}

export type PaymentRow = {
  receivedOn: Day;
  documentNumber: string;
  clientName: string;
  method: string;
  amountMinor: number;
  currency: string;
  reference: string | null;
};

/** The store's payments (reversals and refunds as negative amounts), by the day they were received, optionally between two days. */
export async function paymentRegister(storeId: string, range: { from?: string; to?: string } = {}): Promise<PaymentRow[]> {
  const where = [sql`p.store_id = ${storeId}::uuid`];
  if (range.from && isDay(range.from)) where.push(sql`p.received_on >= ${range.from}::date`);
  if (range.to && isDay(range.to)) where.push(sql`p.received_on <= ${range.to}::date`);
  const rows = await readDb().execute<Row>(sql`
    select p.received_on::text as received_on, i.document_number, c.name as client_name, p.method, p.amount_minor,
           p.currency::text as currency, p.reference
    from commerce.work_invoice_payments p
    join commerce.work_invoices i on i.store_id = p.store_id and i.id = p.invoice_id
    join commerce.work_clients c on c.store_id = i.store_id and c.id = i.client_id
    where ${sql.join(where, sql` and `)}
    order by p.received_on, p.created_at, p.id
    limit ${EXPORT_MAX * 4}
  `);
  return rows.map((r) => ({
    receivedOn: String(r.received_on) as Day,
    documentNumber: String(r.document_number ?? ""),
    clientName: String(r.client_name),
    method: String(r.method),
    amountMinor: Number(r.amount_minor),
    currency: String(r.currency),
    reference: r.reference ? String(r.reference) : null,
  }));
}
