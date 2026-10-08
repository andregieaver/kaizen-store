import { isDocumentToken } from "@/lib/document-token";
import { invoiceFileName } from "@/lib/invoice-eligibility";
import { marketPath } from "@/lib/paths";
import { ensureDocumentPdf } from "@/server/invoice-pdf";
import { findDocumentByToken } from "@/server/invoices";
import { resolveAfterSaleShop } from "@/server/shop";

/**
 * The PDF of a hosted invoice or credit note (D159, `docs/wave-1b-invoices.md` 2.2 point 5). The token is the whole access: a token of another
 * store, a malformed one and an anonymised document are the same 404. The first request makes the file with Chromium from the same view the
 * hosted page draws and stores it once in the private bucket; every later request, and a staff reprint, gets the stored file. When the file
 * cannot be made now (Chromium fails, or another request is making it) the shopper is sent to the hosted page with `?print=1`, where the
 * browser's own print dialog saves a PDF; nothing else is lost. No cookie is read or set. Chromium is imported here, in the staff's PDF routes
 * and in the document job only, and each is in `outputFileTracingIncludes`.
 */
export async function GET(_request: Request, { params }: RouteContext<"/s/[store]/[market]/account/documents/[token]/pdf">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop || !isDocumentToken(token)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const found = await findDocumentByToken(shop.store.id, token);
  if (!found) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const made = await ensureDocumentPdf(shop.store.id, found.kind, found.id);
  if (!made.ok) {
    if (made.reason === "not_found" || made.reason === "anonymised") return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${marketPath(shop.store.slug, shop.market.slug, `/account/documents/${token}`)}?print=1`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return new Response(new Uint8Array(made.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoiceFileName(made.fileName)}"`,
      "Content-Length": String(made.bytes.length),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
