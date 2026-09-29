import { notFound } from "next/navigation";

import { CSV_CONTENT_TYPE, csvFileName, invoiceListToCsv, withBom } from "@/lib/work-csv";
import { invoiceListFilter, parseInvoiceListParams } from "@/lib/work-invoice-ui";
import { audit, requireMember } from "@/server/auth";
import { invoiceRegister } from "@/server/work-exports";

/**
 * The invoice register as a spreadsheet file (docs/work.md 1.9, WP7b): the issued invoices the list is showing (same
 * `?show`, `client`, `from`, `to` and `q` in the address), one row each with the frozen amounts, for the accountant.
 * For owners and admins of a store with Work on; anyone else gets a 404. Drafts are not in it. The text is quoted
 * and safe from spreadsheet formulas by `toCsv()`; the download is logged.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/work/invoices/export">) {
  const { store: slug } = await params;
  const { store, account } = await requireMember(slug);
  if (!store.workOn) notFound();
  const query = parseInvoiceListParams(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await invoiceRegister(store.id, invoiceListFilter(query, 100));
  await audit(account.id, store.id, "work.invoices_exported", { show: query.show, rows: rows.length });
  return new Response(withBom(invoiceListToCsv(rows)), {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${csvFileName(store.slug, "invoices", query.from, query.to)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
