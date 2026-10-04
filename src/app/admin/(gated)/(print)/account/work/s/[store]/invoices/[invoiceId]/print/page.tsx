import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DocumentPage, NoDocument } from "@/components/admin/work/document-page";
import { WorkOff } from "@/components/admin/work/work-off";
import { InvoiceDocumentView } from "@/components/work/invoice-document";
import { documentFileName, printableState } from "@/lib/work-invoice-print";
import { invoiceDocumentData } from "@/server/work-invoices";
import { workBase } from "@/lib/work-paths";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Print invoice", robots: { index: false, follow: false } };

/**
 * An issued invoice to print or save as PDF (docs/work.md 4.7), drawn from its
 * frozen snapshot in the client's language and without the admin around it (the
 * route group `(print)` has no store layout, so no header, menu or assistant;
 * the gated layout above it still checks the session). `?auto=1` opens the
 * print dialog by itself. Only an issued invoice prints: a draft gets a page
 * that says so, never a preview.
 */
export default async function InvoicePrintPage({
  params,
  searchParams,
}: PageProps<"/admin/account/work/s/[store]/invoices/[invoiceId]/print">) {
  const { store: slug, invoiceId } = await params;
  const { store } = await requirePermission(slug, "settings:read");
  if (!store.workOn) {
    return (
      <div className="p-8">
        <WorkOff storeSlug={store.slug} title="Invoice" />
      </div>
    );
  }
  if (!z.uuid().safeParse(invoiceId).success) notFound();
  const doc = await invoiceDocumentData(store.id, invoiceId);
  if (!doc) notFound();
  const back = `${workBase(store.slug)}/invoices/${invoiceId}`;
  const state = printableState(doc);
  if (!state.printable) {
    return (
      <NoDocument
        title="This invoice is not issued"
        message="Only an issued invoice can be printed or saved as a PDF. A draft has no number yet, and what it says can still change. Issue the invoice first."
        href={back}
        linkLabel="Back to the invoice"
      />
    );
  }
  const auto = (await searchParams).auto === "1";
  return (
    <DocumentPage
      backHref={back}
      backLabel="Back to the invoice"
      documentTitle={documentFileName(doc.labels.invoice, doc.documentNumber)}
      auto={auto}
    >
      <InvoiceDocumentView doc={doc} />
    </DocumentPage>
  );
}
