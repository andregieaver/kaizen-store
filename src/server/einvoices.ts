import "server-only";

import type { AdminLang } from "@/lib/admin-lang";
import { INVOICES_WORDS } from "@/lib/admin-words/invoices";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";
import { creditNoteUbl, einvoiceRefusedPage, invoiceUbl, type Einvoice } from "@/lib/einvoice";

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

/** Where the refusal page leads back: the admin page of this store the link was pressed on, else the store's invoices. */
export function einvoiceBack(request: Request, storeSlug: string): string {
  const fallback = `/admin/${storeSlug}/invoices`;
  const referer = request.headers.get("referer");
  if (!referer) return fallback;
  try {
    const from = new URL(referer);
    return from.origin === new URL(request.url).origin && from.pathname.startsWith(`/admin/${storeSlug}/`) ? `${from.pathname}${from.search}` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The answer of a route that serves one: the file, a 404, or (422) a short page saying why in the staff member's admin language, with a link
 * back to where they came from, since the route is opened by a link and a browser would show JSON as it is.
 */
export function einvoiceResponse(
  out: Einvoice | { ok: true; xml: string; fileName: string } | { ok: false; problems: readonly string[] } | null,
  page: { lang: AdminLang; back: string },
): Response {
  if (!out) return new Response("Not found", { status: 404 });
  if (!out.ok) {
    // A shop document's reasons, and those only Work's documents can have (D463).
    const words = INVOICES_WORDS[page.lang].einvoice;
    const more = SCREENS_WORDS[page.lang].einvoiceState.problems;
    const html = einvoiceRefusedPage(out.problems, { ...words, problems: { ...more, ...words.problems } }, page.back, page.lang);
    return new Response(html, { status: 422, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
  return new Response(out.xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${out.fileName}"`, "Cache-Control": "private, no-store" },
  });
}
