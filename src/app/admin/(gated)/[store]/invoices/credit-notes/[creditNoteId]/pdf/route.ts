import { z } from "zod";

import { invoiceFileName } from "@/lib/invoice-eligibility";
import { ensureCreditNotePdf } from "@/server/invoice-pdf";
import { requirePermission } from "@/server/permissions";

/** A credit note's PDF for staff (D159): as the invoice's, made on the first request and stored once. */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/invoices/credit-notes/[creditNoteId]/pdf">) {
  const { store: slug, creditNoteId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(creditNoteId).success) return new Response("Not found", { status: 404 });
  const pdf = await ensureCreditNotePdf(store.id, creditNoteId);
  if (!pdf.ok) {
    if (pdf.reason === "not_found" || pdf.reason === "anonymised") return new Response("Not found", { status: 404 });
    return Response.redirect(new URL(`/admin/${slug}/invoices/credit-notes/${creditNoteId}/print?auto=1`, request.url), 303);
  }
  return new Response(new Blob([pdf.bytes as BlobPart], { type: "application/pdf" }), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${invoiceFileName(pdf.fileName)}"`, "Cache-Control": "private, no-store" },
  });
}
