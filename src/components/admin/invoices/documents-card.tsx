import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { invoicesEn, type InvoicesMessages } from "@/lib/admin-messages/invoices.en";
import { dayLabel, documentPdfHref, documentPrintHref, invoicesHref } from "@/lib/invoice-admin";
import { WAITING_WORDS } from "@/lib/invoice-readiness";
import { formatMoney } from "@/lib/money";
import type { DocumentLink, OrderDocuments } from "@/server/invoices";
import { Card } from "@/components/admin/ui";

import { SendAgainForm } from "./waiting-actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * The *Documents* card on a staff member's order page (D159, `docs/wave-1b-invoices.md` 2.3): the order's invoice and each credit note with
 * their date, total and links, or, when there is no invoice, the reason in words and what to do. A staff member who may change orders can
 * send a document again, to the order's own address (never an address typed here). Nothing on the card changes a document.
 */
export function DocumentsCard({
  base,
  documents,
  canWrite,
  sendAgain,
  locale = "en-GB",
  words: w = invoicesEn,
}: {
  /** `/admin/{store}` */
  base: string;
  documents: OrderDocuments;
  /** `orders:write`. */
  canWrite: boolean;
  /** A bound action for a document: `(type, id) => action`, made where the card is drawn. */
  sendAgain: (type: "invoice" | "credit_note", id: string) => Action;
  locale?: string;
  /** The reader's words (D312 A4); English unless given. */
  words?: InvoicesMessages;
}) {
  const c = w.card;
  const { invoice, creditNotes } = documents;
  // An unpaid order has nothing to say yet.
  if (!invoice && creditNotes.length === 0 && documents.eligibility === "not_paid") return null;
  return (
    <Card title={c.title} compact>
      {invoice ? (
        <ul className="flex flex-col gap-3 text-sm">
          <DocumentRow base={base} link={invoice} label={c.invoice} canWrite={canWrite} sendAgain={sendAgain} locale={locale} w={w} />
          {creditNotes.map((note) => (
            <DocumentRow key={note.id} base={base} link={note} label={c.creditNote} canWrite={canWrite} sendAgain={sendAgain} locale={locale} w={w} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {documents.waiting ? (
            <>
              <p className="font-medium">{fillWords(c.waiting, { reason: w.labels.waiting[documents.waiting].toLocaleLowerCase(w.labels.countryLanguage) })}</p>
              <p className="text-muted">{documents.staffNote}</p>
              <p className="flex flex-wrap gap-x-4 gap-y-1">
                {WAITING_WORDS[documents.waiting].fixAt && (
                  <Link href={`${base}${WAITING_WORDS[documents.waiting].fixAt}`} className="underline">
                    {c.fixIt}
                  </Link>
                )}
                <Link href={invoicesHref(`${base}/invoices`, { tab: "waiting" })} className="underline">
                  {c.seeWaiting}
                </Link>
              </p>
            </>
          ) : (
            <p className="text-muted">{documents.staffNote ?? c.none}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function DocumentRow({
  base,
  link,
  label,
  canWrite,
  sendAgain,
  locale,
  w,
}: {
  base: string;
  link: DocumentLink;
  label: string;
  canWrite: boolean;
  sendAgain: (type: "invoice" | "credit_note", id: string) => Action;
  locale: string;
  w: InvoicesMessages;
}) {
  return (
    <li className="flex flex-col gap-2 border-b border-line pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="font-medium">
          {label} {link.documentNumber}
        </p>
        <p className="text-muted">
          <time dateTime={link.issuedOn}>{dayLabel(link.issuedOn, w)}</time> · {formatMoney(link.totalMinor, link.currency, locale)}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <Link href={documentPrintHref(base, link.type, link.id)} className="underline" prefetch={false}>
            {w.card.view}
          </Link>
          <a href={documentPdfHref(base, link.type, link.id)} className="underline">
            {w.card.pdf}
          </a>
        </p>
      </div>
      {canWrite && <SendAgainForm action={sendAgain(link.type, link.id)} label={w.card.sendAgain} />}
    </li>
  );
}
