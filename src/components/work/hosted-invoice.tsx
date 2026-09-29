import Link from "next/link";

import { PrintButton } from "@/components/admin/work/print-button";
import { CreditNoteDocumentView, InvoiceDocumentView } from "@/components/work/invoice-document";
import { t } from "@/lib/i18n";
import { documentFileName, dayText, moneyText, printLocale } from "@/lib/work-invoice-print";
import type { CreditNoteDocument, InvoiceDocument } from "@/server/work-invoices";

/**
 * The hosted invoice page's body (docs/work.md 4.7, WP7b): what the client sees at
 * `/s/{store}/{market}/account/invoice/{token}` (or the credit note at `?credit=`). The
 * frozen document as the print page draws it, with a short frame in the document's own
 * language (the language it was issued in, not the market's) and "Print or save as PDF".
 * The document is on purpose black on white; only the frame follows the store's theme.
 * Server-rendered; the store's header and footer are kept out of the print.
 */
const PRINT_ONLY_DOCUMENT = `
@media print {
  body header:not(.wd header), body footer:not(.wd footer), body nav { display: none !important; }
}
`;

export type HostedInvoiceProps = {
  doc: InvoiceDocument;
  /** The credit note shown instead of the invoice, when the address asks for one that belongs to it. */
  credit: CreditNoteDocument | null;
  /** The page's own address without a query, for "back to the invoice". */
  invoiceHref: string;
  /** The store's contact address, when it has one. */
  contactEmail: string | null;
};

export function HostedInvoice({ doc, credit, invoiceHref, contactEmail }: HostedInvoiceProps) {
  const m = t(doc.language).workInvoice;
  const locale = printLocale(doc.locale);
  const title = credit
    ? documentFileName(credit.labels.creditNote, credit.documentNumber)
    : documentFileName(doc.labels.invoice, doc.documentNumber);
  const note = credit
    ? null
    : doc.status === "paid"
      ? m.paidNote
      : doc.status === "void"
        ? m.creditedNote
        : doc.payment.amountDueMinor > 0 && doc.dueOn
          ? m.openNote(moneyText(doc.payment.amountDueMinor, doc.currency, locale), dayText(doc.dueOn, locale))
          : null;
  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4" lang={doc.language}>
      <style>{PRINT_ONLY_DOCUMENT}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl tracking-tight">{title}</h1>
          {note && <p role="status">{note}</p>}
          {credit && (
            <Link href={invoiceHref} className="underline">
              {m.seeInvoice}
            </Link>
          )}
        </div>
        <PrintButton label={m.print} documentTitle={title} />
      </div>
      <div className="rounded-lg bg-[#f3f4f6] p-2 sm:p-4">
        {credit ? <CreditNoteDocumentView doc={credit} /> : <InvoiceDocumentView doc={doc} />}
      </div>
      {!credit && doc.creditNotes.length > 0 && (
        <section aria-labelledby="hosted-credit-notes" className="flex flex-col gap-2 print:hidden">
          <h2 id="hosted-credit-notes" className="text-lg font-medium">
            {m.creditNotes}
          </h2>
          <ul className="flex flex-col gap-1">
            {doc.creditNotes.map((note) => (
              <li key={note.id}>
                <Link href={`${invoiceHref}?credit=${note.id}`} className="underline">
                  {m.creditNoteLine(note.documentNumber, moneyText(note.totalMinor, note.currency, locale))}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {contactEmail && <p className="text-sm print:hidden">{m.questions(contactEmail)}</p>}
    </div>
  );
}
