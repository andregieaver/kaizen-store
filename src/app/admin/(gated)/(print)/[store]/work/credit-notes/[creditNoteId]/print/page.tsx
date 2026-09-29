import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DocumentPage } from "@/components/admin/work/document-page";
import { WorkOff } from "@/components/admin/work/work-off";
import { CreditNoteDocumentView } from "@/components/work/invoice-document";
import { documentFileName } from "@/lib/work-invoice-print";
import { requireMember } from "@/server/auth";
import { creditNoteDocumentData } from "@/server/work-invoices";

export const metadata: Metadata = { title: "Print credit note", robots: { index: false, follow: false } };

/**
 * A credit note to print or save as PDF (docs/work.md 4.7), from what was frozen
 * on it when it was issued. Credit notes are only ever made numbered, so there
 * is no draft state. Like the invoice's, it is drawn without the admin around it.
 */
export default async function CreditNotePrintPage({
  params,
  searchParams,
}: PageProps<"/admin/[store]/work/credit-notes/[creditNoteId]/print">) {
  const { store: slug, creditNoteId } = await params;
  const { store } = await requireMember(slug);
  if (!store.workOn) {
    return (
      <div className="p-8">
        <WorkOff storeSlug={store.slug} title="Credit note" />
      </div>
    );
  }
  if (!z.uuid().safeParse(creditNoteId).success) notFound();
  const doc = await creditNoteDocumentData(store.id, creditNoteId);
  if (!doc) notFound();
  const auto = (await searchParams).auto === "1";
  return (
    <DocumentPage
      backHref={`/admin/${store.slug}/work/invoices/${doc.invoiceId}`}
      backLabel="Back to the invoice"
      documentTitle={documentFileName(doc.wording.title, doc.documentNumber)}
      auto={auto}
    >
      <CreditNoteDocumentView doc={doc} />
    </DocumentPage>
  );
}
