import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DocumentPage, NoDocument } from "@/components/admin/work/document-page";
import { OrderDocumentView } from "@/components/documents/order-document-view";
import { getCreditNote } from "@/server/invoices";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Credit note", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** A credit note to look at, print or save as PDF (D159): as the invoice's print page, drawn from the credit note's own snapshot. */
export default async function CreditNotePrintPage({ params, searchParams }: PageProps<"/admin/[store]/invoices/credit-notes/[creditNoteId]/print">) {
  const { store: slug, creditNoteId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(creditNoteId).success) notFound();
  const doc = await getCreditNote(store.id, creditNoteId);
  if (!doc) notFound();
  const back = `/admin/${store.slug}/invoices?tab=credit-notes`;
  if (doc.anonymised) {
    return (
      <NoDocument
        title="This credit note has been anonymised"
        message="The retention period has passed, so the buyer's details were removed from this credit note. Its number, date and amounts are kept."
        href={back}
        linkLabel="Back to the credit notes"
      />
    );
  }
  const auto = (await searchParams).auto === "1";
  return (
    <DocumentPage backHref={back} backLabel="Back to the credit notes" documentTitle={doc.documentNumber} auto={auto}>
      <OrderDocumentView snapshot={doc.snapshot} />
    </DocumentPage>
  );
}
