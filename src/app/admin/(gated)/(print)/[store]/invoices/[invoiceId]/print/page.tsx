import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DocumentPage, NoDocument } from "@/components/admin/work/document-page";
import { OrderDocumentView } from "@/components/documents/order-document-view";
import { getInvoice } from "@/server/invoices";
import { requirePermission } from "@/server/permissions";
import { adminText } from "@/lib/admin-text";
import { workWords } from "@/server/work-words";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * An issued invoice to look at, print or save as PDF (D159, `docs/wave-1b-invoices.md` 2.3), drawn from its frozen snapshot in the order's
 * language and without the admin around it (the route group `(print)` has no store layout; the gated layout above it still checks the
 * session). `?auto=1` opens the print dialog by itself: it is where the PDF route sends staff when the renderer is not available. The
 * document is the same component the shopper's hosted page and the PDF draw.
 */
export default async function InvoicePrintPage({ params, searchParams }: PageProps<"/admin/[store]/invoices/[invoiceId]/print">) {
  const { store: slug, invoiceId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  // The print button's words are Work's (`DocumentPage`), in the account's language once `workWords()` has set it.
  const { lang } = await workWords();
  const w = adminText(lang, "invoices").print;
  if (!z.uuid().safeParse(invoiceId).success) notFound();
  const doc = await getInvoice(store.id, invoiceId);
  if (!doc) notFound();
  const back = `/admin/${store.slug}/invoices`;
  if (doc.anonymised) {
    return (
      <NoDocument
        title={w.invoiceGone}
        message={w.invoiceGoneText}
        href={back}
        linkLabel={w.backInvoices}
      />
    );
  }
  const auto = (await searchParams).auto === "1";
  return (
    <DocumentPage backHref={back} backLabel={w.backInvoices} documentTitle={doc.documentNumber} auto={auto}>
      <OrderDocumentView snapshot={doc.snapshot} />
    </DocumentPage>
  );
}
