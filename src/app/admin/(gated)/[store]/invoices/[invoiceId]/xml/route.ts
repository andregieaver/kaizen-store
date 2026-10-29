import { z } from "zod";

import { documentUbl, einvoiceResponse } from "@/server/einvoices";
import { requirePermission } from "@/server/permissions";

/** An invoice as EN 16931 UBL for staff (D403): the frozen snapshot put in the format; another store's or an anonymised one is a 404. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/invoices/[invoiceId]/xml">) {
  const { store: slug, invoiceId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(invoiceId).success) return new Response("Not found", { status: 404 });
  return einvoiceResponse(await documentUbl(store.id, "invoice", invoiceId));
}
