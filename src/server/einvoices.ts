import "server-only";

import { creditNoteUbl, invoiceUbl, type Einvoice } from "@/lib/einvoice";

import { getCreditNote, getInvoice } from "./invoices";
import { log } from "./log";

/**
 * A store's invoice or credit note as EN 16931 UBL (wave 13 unit C, D403), from its frozen snapshot only (`src/lib/einvoice.ts`). Null for
 * another store's document or an anonymised one (whose buyer is gone); a document the format cannot carry says why.
 */
export async function documentUbl(storeId: string, kind: "invoice" | "credit_note", id: string): Promise<Einvoice | null> {
  const doc = kind === "invoice" ? await getInvoice(storeId, id) : await getCreditNote(storeId, id);
  if (!doc || doc.anonymised) return null;
  const out = kind === "invoice" ? invoiceUbl(doc.snapshot as Parameters<typeof invoiceUbl>[0]) : creditNoteUbl(doc.snapshot as Parameters<typeof creditNoteUbl>[0]);
  if (!out.ok) log("info", "einvoice.refused", { storeId, kind, problems: out.problems.join(",") });
  return out;
}

/** The answer of a route that serves one: the file, a 404, or the reasons as JSON (422). */
export function einvoiceResponse(out: Einvoice | null): Response {
  if (!out) return new Response("Not found", { status: 404 });
  if (!out.ok) return Response.json({ problems: out.problems }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  return new Response(out.xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${out.fileName}"`, "Cache-Control": "private, no-store" },
  });
}
