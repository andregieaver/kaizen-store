import { z } from "zod";

import { invoiceFileName } from "@/lib/invoice-eligibility";
import { ensureInvoicePdf } from "@/server/invoice-pdf";
import { requirePermission } from "@/server/permissions";

/**
 * An invoice's PDF for staff (D159, `docs/wave-1b-invoices.md` 2.3 and 4.9): the stored file, which is the same one the shopper gets, made
 * on the first request and kept. If the renderer is busy or fails, the staff member is sent to the printable view instead, where the
 * browser saves a PDF; nothing is lost. Another store's invoice, or one that is anonymised, is a 404.
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/invoices/[invoiceId]/pdf">) {
  const { store: slug, invoiceId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(invoiceId).success) return new Response("Not found", { status: 404 });
  const pdf = await ensureInvoicePdf(store.id, invoiceId);
  if (!pdf.ok) {
    if (pdf.reason === "not_found" || pdf.reason === "anonymised") return new Response("Not found", { status: 404 });
    return Response.redirect(new URL(`/admin/${slug}/invoices/${invoiceId}/print?auto=1`, request.url), 303);
  }
  return new Response(new Blob([pdf.bytes as BlobPart], { type: "application/pdf" }), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${invoiceFileName(pdf.fileName)}"`, "Cache-Control": "private, no-store" },
  });
}
