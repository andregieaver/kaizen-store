import { documentText } from "@/lib/invoice-text";
import { dayText, printLocale } from "@/lib/work-invoice-print";

/**
 * The documents of an order on the shopper's pages (D159, `docs/wave-1b-invoices.md` 2.2 point 3 and 5.3): the invoice and each credit note as a
 * line with a link to the hosted page and one to the PDF, or "Test order: no invoice" (in the market's language) for an order paid in Stripe's test mode. An order with
 * nothing to show (copied, a host's, invoicing off, an invoice still waiting) draws nothing and no error: the shopper is told nothing about a
 * waiting invoice. The wording is `invoice-text.ts`'s (nb, sv, da, en by hand, flagged for review; English for every other language).
 *
 * Presentational and server-rendered: no hook, no cookie, no storage. It sits on the order page, a pay route, so it imports nothing the pay
 * routes forbid (`src/lib/pay-routes.ts`). The hosted page and its PDF are outside the pay routes and are reached by full page loads.
 */

/** What a document line needs: the shape of `DocumentLink` in `src/server/invoices.ts`, without importing that server module. */
export type OrderDocumentLink = {
  id: string;
  documentNumber: string;
  issuedOn: string;
  /** The hosted page's token; null once the document is anonymised (then it is listed without links). */
  token: string | null;
};

export type OrderDocumentsProps = {
  /** The market's language (`nb`, `sv`, `da`, `en`; any other shows English). */
  lang: string;
  /** The market's locale, for the dates. */
  locale: string;
  /** The market's address (`marketPath(store, market)`), which the document addresses hang from. */
  base: string;
  invoice: OrderDocumentLink | null;
  creditNotes: readonly OrderDocumentLink[];
  /** An order paid in Stripe's test mode (no invoice, and the shopper is told so in their language); false for every other order without one. */
  testOrder: boolean;
  /** Wrapper classes: the order page's frame. */
  className?: string;
};

/** The hosted page's address and its PDF's; one token, either kind of document. */
export const documentHref = (base: string, token: string) => `${base}/account/documents/${token}`;
export const documentPdfHref = (base: string, token: string) => `${base}/account/documents/${token}/pdf`;

export function OrderDocuments({ lang, locale, base, invoice, creditNotes, testOrder, className }: OrderDocumentsProps) {
  const t = documentText(lang);
  const loc = printLocale(locale);
  const items = [
    ...(invoice ? [{ link: invoice, label: t.invoiceLink(invoice.documentNumber, dayText(invoice.issuedOn, loc)), key: `i:${invoice.id}` }] : []),
    ...creditNotes.map((link) => ({ link, label: t.creditNoteLink(link.documentNumber, dayText(link.issuedOn, loc)), key: `c:${link.id}` })),
  ];
  if (items.length === 0 && !testOrder) return null;
  return (
    <section aria-labelledby="documents-heading" className={className ?? "rounded-lg border border-border p-4"}>
      <h2 id="documents-heading" className="mb-2 font-medium">
        {t.documents}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t.testOrder}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map(({ link, label, key }) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
              <span>{label}</span>
              {link.token && (
                <span className="flex flex-wrap items-center gap-x-4 text-sm">
                  <a href={documentHref(base, link.token)} className="underline">
                    {t.view}
                    <span className="sr-only">: {label}</span>
                  </a>
                  <a href={documentPdfHref(base, link.token)} className="underline">
                    {t.pdf}
                    <span className="sr-only">: {label}</span>
                  </a>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
