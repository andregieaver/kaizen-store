import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { Stat, StatGrid } from "@/components/admin/overview-parts";
import {
  countryName,
  countsSentence,
  dayLabel,
  documentPdfHref,
  documentPrintHref,
  DOCUMENTS_PER_PAGE,
  INVOICE_TABS,
  invoicesHref,
  sourceLabel,
  TAB_LABELS,
  vatKindLabel,
  WAITING_TITLES,
  type InvoiceQuery,
  type InvoiceTab,
} from "@/lib/invoice-admin";
import { formatMoney } from "@/lib/money";
import type { DocumentListRow, DocumentPage, FailingPdf, InvoiceCounts, WaitingCreditNote, WaitingInvoice } from "@/server/invoices";

import { CheckAgainForm, RetryPdfForm } from "./waiting-actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const control = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";
const th = "px-4 py-2 font-medium";
const td = "px-4 py-2";

/**
 * The store's invoices and credit notes (D159, `docs/wave-1b-invoices.md` 2.3): what was issued, in three tabs, and what is still waiting
 * for a person. Drawn from its data alone, so every state can be seen without a browser or a database. The documents themselves are
 * frozen when they are issued: this page can open, print and download them, and nothing here changes one.
 */
export function InvoicesView({
  base,
  query,
  today,
  counts,
  invoicingOn,
  canWrite,
  canSettings,
  documents,
  waiting,
  waitingNotes,
  failing,
  actions,
  exportProblem = null,
  locale = "en-GB",
}: {
  /** `/admin/{store}` */
  base: string;
  query: InvoiceQuery;
  /** The store's day today (YYYY-MM-DD). */
  today: string;
  counts: InvoiceCounts;
  invoicingOn: boolean;
  /** `orders:write`: *Check again*, *Try again* and the CSV. */
  canWrite: boolean;
  /** The owner: the link to the settings. */
  canSettings: boolean;
  /** The page of the open list tab; null on the Waiting tab. */
  documents: DocumentPage | null;
  waiting: WaitingInvoice[];
  waitingNotes: WaitingCreditNote[];
  failing: FailingPdf[];
  actions: { checkAgain: Action; retryPdf: Action };
  /** What the CSV route sent the person back for, as a fixed sentence. */
  exportProblem?: string | null;
  locale?: string;
}) {
  const here = `${base}/invoices`;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const waitingTotal = waiting.length + waitingNotes.length + failing.length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <p className="max-w-3xl text-sm text-muted">
          Every paid order gets an invoice in the store&apos;s own numbered series, and every refund that succeeds gets a credit note. They are made by the
          system when the payment or the refund is recorded and cannot be changed afterwards. This is not tax or accounting advice: have your accountant read
          what the documents say.
        </p>
        <p role="status" className="mt-1 text-sm">
          {countsSentence(counts)}
        </p>
      </div>

      {!invoicingOn && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          Invoicing is switched off for this store, so new orders get no invoice.{" "}
          {canSettings ? (
            <Link href={`${base}/settings/invoices`} className="underline">
              Open the invoicing settings
            </Link>
          ) : (
            "An owner can switch it on in the invoicing settings."
          )}
        </p>
      )}

      {exportProblem && (
        <p role="alert" className="rounded-lg border border-red-700 p-4 text-sm text-red-700 dark:border-red-400 dark:text-red-400">
          {exportProblem}
        </p>
      )}

      <StatGrid>
        <Stat label="Invoices" value={counts.invoices} href={here} />
        <Stat label="Credit notes" value={counts.creditNotes} href={invoicesHref(here, { tab: "credit-notes", all: true })} />
        <Stat label="Waiting for an invoice" value={counts.waiting} sub={counts.overdue > 0 ? `${counts.overdue} past the deadline` : undefined} href={invoicesHref(here, { tab: "waiting" })} />
        <Stat label="PDF not made" value={counts.pdfFailing} sub={counts.pdfFailing > 0 ? "Try again on the Waiting tab" : undefined} href={counts.pdfFailing > 0 ? invoicesHref(here, { tab: "waiting" }) : undefined} />
      </StatGrid>

      <nav aria-label="Documents" className="flex flex-wrap gap-1 border-b border-border">
        {INVOICE_TABS.map((tab) => (
          <TabLink key={tab} here={here} tab={tab} current={query.tab} badge={tab === "waiting" && waitingTotal > 0 ? waitingTotal : null} />
        ))}
      </nav>

      {query.tab === "waiting" ? (
        <WaitingTab
          base={base}
          today={today}
          waiting={waiting}
          waitingNotes={waitingNotes}
          failing={failing}
          canWrite={canWrite}
          actions={actions}
          money={money}
        />
      ) : (
        documents && <ListTab base={base} here={here} query={query} today={today} documents={documents} canWrite={canWrite} money={money} />
      )}
    </div>
  );
}

function TabLink({ here, tab, current, badge }: { here: string; tab: InvoiceTab; current: InvoiceTab; badge: number | null }) {
  const active = tab === current;
  return (
    <Link
      href={invoicesHref(here, { tab })}
      aria-current={active ? "page" : undefined}
      className={`-mb-px flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm ${active ? "border-foreground font-medium" : "border-transparent text-muted hover:text-foreground"}`}
    >
      {TAB_LABELS[tab]}
      {badge !== null && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{badge}</span>}
    </Link>
  );
}

function ListTab({
  base,
  here,
  query,
  today,
  documents,
  canWrite,
  money,
}: {
  base: string;
  here: string;
  query: InvoiceQuery;
  today: string;
  documents: DocumentPage;
  canWrite: boolean;
  money: (minor: number, currency: string) => string;
}) {
  const credit = query.tab === "credit-notes";
  const noun = credit ? "credit notes" : "invoices";
  const pages = Math.max(1, Math.ceil(documents.total / DOCUMENTS_PER_PAGE));
  const orders = `${base}/orders`;
  const filtered = query.q !== "" || query.all || query.from !== `${today.slice(0, 7)}-01` || query.to !== today;
  const from = query.from ?? "";
  const to = query.to ?? today;
  return (
    <div className="flex flex-col gap-6">
      <form method="get" action={here} className="flex flex-wrap items-end gap-3" aria-label={`Filter the ${noun}`}>
        {credit && <input type="hidden" name="tab" value="credit-notes" />}
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <input type="date" name="from" defaultValue={query.from ?? ""} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          To
          <input type="date" name="to" defaultValue={query.to ?? ""} className={control} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          Search
          <input name="q" type="search" defaultValue={query.q} placeholder={credit ? "Credit note, invoice, order or email" : "Invoice, order or email"} maxLength={100} className={`${control} w-full`} />
        </label>
        <button type="submit" className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
          Filter
        </button>
        {!query.all && (
          <Link href={invoicesHref(here, { tab: query.tab, all: true, q: query.q })} className="flex min-h-10 items-center text-sm underline">
            All periods
          </Link>
        )}
        {filtered && (
          <Link href={invoicesHref(here, { tab: query.tab })} className="flex min-h-10 items-center text-sm underline">
            This month
          </Link>
        )}
      </form>
      <p className="text-sm text-muted">
        {query.all ? "All periods" : `${dayLabel(query.from)} to ${dayLabel(query.to)}`} · {documents.total} {documents.total === 1 ? (credit ? "credit note" : "invoice") : noun}
      </p>

      {documents.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-8 text-center text-sm">
          {filtered
            ? `No ${noun} match. Change the period or the search.`
            : credit
              ? "No credit notes this month. One is made for every refund that succeeds on an order that has an invoice."
              : "No invoices this month. One is made when an order is paid, from the day invoicing is switched on."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] rounded-lg border border-border bg-background text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>{credit ? "Credit note" : "Invoice"}</th>
                <th scope="col" className={th}>Date</th>
                <th scope="col" className={th}>Order</th>
                <th scope="col" className={th}>Buyer</th>
                <th scope="col" className={`${th} text-right`}>Net</th>
                <th scope="col" className={`${th} text-right`}>VAT</th>
                <th scope="col" className={`${th} text-right`}>Total</th>
                <th scope="col" className={th}>Document</th>
              </tr>
            </thead>
            <tbody>
              {documents.rows.map((row) => (
                <Row key={row.id} base={base} orders={orders} row={row} credit={credit} money={money} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label={`Pages of ${noun}`} className="flex items-center gap-3 text-sm">
          {query.page > 1 ? (
            <Link href={invoicesHref(here, { ...query, page: query.page - 1 }, today)} className="underline">
              Previous
            </Link>
          ) : (
            <span className="text-muted">Previous</span>
          )}
          <span className="text-muted">
            Page {query.page} of {pages} · {documents.total} {noun}
          </span>
          {query.page < pages ? (
            <Link href={invoicesHref(here, { ...query, page: query.page + 1 }, today)} className="underline">
              Next
            </Link>
          ) : (
            <span className="text-muted">Next</span>
          )}
        </nav>
      )}

      {canWrite ? (
        <section aria-labelledby="export" className="rounded-lg border border-border bg-background p-5">
          <h2 id="export" className="font-medium">
            CSV for your accountant
          </h2>
          <p className="mb-3 text-sm text-muted">
            One row for each {credit ? "credit note" : "invoice"} issued in the period: number, dates, order, the buyer&apos;s name, country and VAT number,
            amounts, the VAT for each rate, the VAT in the seller&apos;s currency where the document has it, and the VAT treatment. It holds personal data, so
            keep it safe; each download is written to the activity log.
          </p>
          <form method="post" action={`${here}/export`} className="flex flex-wrap items-end gap-3" aria-label="Download a CSV">
            <input type="hidden" name="type" value={credit ? "credit_notes" : "invoices"} />
            <label className="flex flex-col gap-1 text-sm font-medium">
              From
              <input type="date" name="from" required defaultValue={from || `${today.slice(0, 7)}-01`} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              To
              <input type="date" name="to" required defaultValue={to} className={control} />
            </label>
            <button type="submit" className="min-h-10 rounded-md border border-border bg-background px-4 text-sm">
              Download CSV
            </button>
          </form>
        </section>
      ) : (
        <p className="text-sm text-muted">The CSV for the accountant is for members who may change orders.</p>
      )}
    </div>
  );
}

function Row({ base, orders, row, credit, money }: { base: string; orders: string; row: DocumentListRow; credit: boolean; money: (minor: number, currency: string) => string }) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className={td}>
        <span className="font-medium">{row.documentNumber}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {credit ? (
            <>
              <span>Credits {row.invoiceNumber ?? "the invoice"}</span>
              <span>· {sourceLabel(row.source)}</span>
            </>
          ) : (
            <span>{vatKindLabel(row.vatKind)}</span>
          )}
        </span>
      </td>
      <td className={td}>
        <time dateTime={row.issuedOn}>{dayLabel(row.issuedOn)}</time>
      </td>
      <td className={td}>
        <Link href={`${orders}/${row.orderId}`} className="underline-offset-2 hover:underline">
          #{row.orderNumber}
        </Link>
      </td>
      <td className={td}>
        {row.anonymised ? (
          <span className="text-muted">Removed after the retention period</span>
        ) : (
          <>
            <span className="block">{row.buyerName ?? "–"}</span>
            <span className="text-xs text-muted">{countryName(row.buyerCountry)}</span>
          </>
        )}
      </td>
      <td className={`${td} text-right tabular-nums`}>{money(row.netMinor, row.currency)}</td>
      <td className={`${td} text-right tabular-nums`}>{money(row.vatMinor, row.currency)}</td>
      <td className={`${td} text-right tabular-nums font-medium`}>{money(row.totalMinor, row.currency)}</td>
      <td className={td}>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <Link href={documentPrintHref(base, row.type, row.id)} className="underline" prefetch={false}>
            View
          </Link>
          {/* A PDF route redirects to the print page when the renderer is not available; the link is always offered. */}
          <a href={documentPdfHref(base, row.type, row.id)} className="underline">
            PDF
          </a>
        </span>
        {!row.hasPdf && !row.anonymised && <span className="block text-xs text-muted">Made on first download</span>}
      </td>
    </tr>
  );
}

function WaitingTab({
  base,
  today,
  waiting,
  waitingNotes,
  failing,
  canWrite,
  actions,
  money,
}: {
  base: string;
  today: string;
  waiting: WaitingInvoice[];
  waitingNotes: WaitingCreditNote[];
  failing: FailingPdf[];
  canWrite: boolean;
  actions: { checkAgain: Action; retryPdf: Action };
  money: (minor: number, currency: string) => string;
}) {
  const orders = `${base}/orders`;
  const nothing = waiting.length === 0 && waitingNotes.length === 0 && failing.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <p className="max-w-3xl text-sm text-muted">
          A paid order waits for its invoice when something the invoice must state is missing, for example the business details or the VAT registration. The
          payment is never held back. Once the cause is put right the invoice is made within five minutes, dated that day, and still says the payment day as
          the date of supply. <strong className="font-medium text-foreground">Check again</strong> does it now.
        </p>
        {canWrite ? <CheckAgainForm action={actions.checkAgain} /> : <p className="text-sm text-muted">Members who may change orders can press Check again.</p>}
      </div>

      {nothing && <p className="rounded-lg border border-border bg-background p-8 text-center text-sm">Nothing is waiting. Every paid order has its invoice and every refund its credit note.</p>}

      {waiting.length > 0 && (
        <section aria-labelledby="waiting-invoices" className="flex flex-col gap-2">
          <h2 id="waiting-invoices" className="font-medium">
            Orders waiting for an invoice
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] rounded-lg border border-border bg-background text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>Order</th>
                  <th scope="col" className={th}>Paid</th>
                  <th scope="col" className={`${th} text-right`}>Total</th>
                  <th scope="col" className={th}>Why it waits</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((w) => (
                  <tr key={w.orderId} className="border-b border-border align-top last:border-0">
                    <td className={td}>
                      <Link href={`${orders}/${w.orderId}`} className="font-medium underline-offset-2 hover:underline">
                        #{w.orderNumber}
                      </Link>
                      <span className="block text-xs text-muted">{vatKindLabel(w.vatKind)}</span>
                    </td>
                    <td className={td}>
                      <time dateTime={w.paidOn}>{dayLabel(w.paidOn)}</time>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{money(w.totalMinor, w.currency)}</td>
                    <td className={td}>
                      <span className="block font-medium">{WAITING_TITLES[w.reason]}</span>
                      <span className="block text-muted">{w.words}</span>
                      {w.overdue && w.deadline && (
                        <span className="mt-1 block font-medium text-red-700 dark:text-red-400">
                          Past the deadline: a reverse-charge invoice is due by {dayLabel(w.deadline)}. Today is {dayLabel(today)}.
                        </span>
                      )}
                      {w.fixAt && (
                        <Link href={`${base}${w.fixAt}`} className="mt-1 inline-block underline">
                          Fix it
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {waitingNotes.length > 0 && (
        <section aria-labelledby="waiting-notes" className="flex flex-col gap-2">
          <h2 id="waiting-notes" className="font-medium">
            Refunds with no or only a partial credit note
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            A credit note never goes above what its invoice has left, per VAT rate. A refund with no credit note yet is tried again every five minutes. A
            refund larger than what was left on the invoice, such as a fee charged after the sale, is credited in part; the rest is not an invoiced amount.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] rounded-lg border border-border bg-background text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>Order</th>
                  <th scope="col" className={th}>State</th>
                  <th scope="col" className={`${th} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {waitingNotes.map((n) => (
                  <tr key={`${n.refundId ?? n.returnId}-${n.state}`} className="border-b border-border last:border-0">
                    <td className={td}>
                      <Link href={`${orders}/${n.orderId}`} className="font-medium underline-offset-2 hover:underline">
                        #{n.orderNumber}
                      </Link>
                    </td>
                    <td className={td}>{n.state === "missing" ? "No credit note yet" : "Credited in part: the invoice had less left"}</td>
                    <td className={`${td} text-right tabular-nums`}>
                      {money(n.amountMinor, n.currency)}
                      <span className="block text-xs text-muted">{n.state === "missing" ? "the refund" : "left uncredited"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {failing.length > 0 && (
        <section aria-labelledby="failing-pdfs" className="flex flex-col gap-2">
          <h2 id="failing-pdfs" className="font-medium">
            PDF not made
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            The document exists and is correct; only its PDF file could not be made after several tries. The hosted page and the print view still work, and
            the browser can save a PDF from them.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] rounded-lg border border-border bg-background text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={th}>Document</th>
                  <th scope="col" className={th}>Order</th>
                  <th scope="col" className={th}>Tries</th>
                  <th scope="col" className={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {failing.map((f) => (
                  <tr key={`${f.type}-${f.id}`} className="border-b border-border align-top last:border-0">
                    <td className={td}>
                      <span className="font-medium">{f.documentNumber}</span>
                      <Link href={documentPrintHref(base, f.type, f.id)} className="block text-xs underline" prefetch={false}>
                        View
                      </Link>
                    </td>
                    <td className={td}>
                      <Link href={`${orders}/${f.orderId}`} className="underline-offset-2 hover:underline">
                        #{f.orderNumber}
                      </Link>
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {f.attempts}
                      {f.lastError && <span className="block max-w-xs text-xs text-muted [overflow-wrap:anywhere]">{f.lastError}</span>}
                    </td>
                    <td className={td}>{canWrite ? <RetryPdfForm action={actions.retryPdf} type={f.type} id={f.id} /> : <span className="text-muted">Needs a member who may change orders</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
