import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { countWords, fillWords } from "@/lib/admin-fill";
import { invoicesEn, type InvoicesMessages } from "@/lib/admin-messages/invoices.en";
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
  vatKindLabel,
  type InvoiceQuery,
  type InvoiceTab,
} from "@/lib/invoice-admin";
import { formatMoney } from "@/lib/money";
import type { DocumentListRow, DocumentPage, FailingPdf, InvoiceCounts, WaitingCreditNote, WaitingInvoice } from "@/server/invoices";
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowActions, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

import { CheckAgainForm, RetryPdfForm } from "./waiting-actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
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
  words: w = invoicesEn,
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
  words?: InvoicesMessages;
}) {
  const v = w.view;
  const here = `${base}/invoices`;
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const waitingTotal = waiting.length + waitingNotes.length + failing.length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader
          title={v.title}
          description={v.description}
        />
        <p role="status" className="mt-1 text-sm">
          {countsSentence(counts, w)}
        </p>
      </div>

      {!invoicingOn && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {v.off}{" "}
          {canSettings ? (
            <Link href={`${base}/settings/invoices`} className="underline">
              {v.openSettings}
            </Link>
          ) : (
            v.ownerCan
          )}
        </p>
      )}

      {exportProblem && (
        <p role="alert" className="rounded-lg border border-danger-text p-4 text-sm text-danger-text">
          {exportProblem}
        </p>
      )}

      <StatGrid>
        <Stat label={v.invoices} value={counts.invoices} href={here} />
        <Stat label={v.creditNotes} value={counts.creditNotes} href={invoicesHref(here, { tab: "credit-notes", all: true })} />
        <Stat label={v.waitingFor} value={counts.waiting} sub={counts.overdue > 0 ? fillWords(v.pastDeadline, { n: counts.overdue }) : undefined} href={invoicesHref(here, { tab: "waiting" })} />
        <Stat label={v.pdfNotMade} value={counts.pdfFailing} sub={counts.pdfFailing > 0 ? v.tryOnWaiting : undefined} href={counts.pdfFailing > 0 ? invoicesHref(here, { tab: "waiting" }) : undefined} />
      </StatGrid>

      <nav aria-label={v.documents} className="flex flex-wrap gap-1 border-b border-line">
        {INVOICE_TABS.map((tab) => (
          <TabLink key={tab} here={here} tab={tab} current={query.tab} badge={tab === "waiting" && waitingTotal > 0 ? waitingTotal : null} label={w.labels.tabs[tab]} />
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
          w={w}
        />
      ) : (
        documents && <ListTab base={base} here={here} query={query} today={today} documents={documents} canWrite={canWrite} money={money} w={w} />
      )}
    </div>
  );
}

function TabLink({ here, tab, current, badge, label }: { here: string; tab: InvoiceTab; current: InvoiceTab; badge: number | null; label: string }) {
  const active = tab === current;
  return (
    <Link
      href={invoicesHref(here, { tab })}
      aria-current={active ? "page" : undefined}
      className={`-mb-px flex min-h-10 items-center gap-2 border-b-2 px-3 text-sm ${active ? "border-brand font-medium" : "border-transparent text-muted hover:text-ink"}`}
    >
      {label}
      {badge !== null && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-text">{badge}</span>}
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
  w,
}: {
  base: string;
  here: string;
  query: InvoiceQuery;
  today: string;
  documents: DocumentPage;
  canWrite: boolean;
  money: (minor: number, currency: string) => string;
  w: InvoicesMessages;
}) {
  const v = w.view;
  const credit = query.tab === "credit-notes";
  const count = (n: number) => countWords(n, credit ? v.creditNoteCount : v.invoiceCount);
  const pages = Math.max(1, Math.ceil(documents.total / DOCUMENTS_PER_PAGE));
  const orders = `${base}/orders`;
  const filtered = query.q !== "" || query.all || query.from !== `${today.slice(0, 7)}-01` || query.to !== today;
  const from = query.from ?? "";
  const to = query.to ?? today;
  return (
    <div className="flex flex-col gap-6">
      <form method="get" action={here} className="flex flex-wrap items-end gap-3" aria-label={credit ? v.filterCreditNotes : v.filterInvoices}>
        {credit && <input type="hidden" name="tab" value="credit-notes" />}
        <label className="flex flex-col gap-1 text-sm font-medium">
          {v.from}
          <input type="date" name="from" defaultValue={query.from ?? ""} className={control} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {v.to}
          <input type="date" name="to" defaultValue={query.to ?? ""} className={control} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          {v.search}
          <input name="q" type="search" defaultValue={query.q} placeholder={credit ? v.searchCreditNotes : v.searchInvoices} maxLength={100} className={`${control} w-full`} />
        </label>
        <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          {v.filter}
        </button>
        {!query.all && (
          <Link href={invoicesHref(here, { tab: query.tab, all: true, q: query.q })} className="flex min-h-10 items-center text-sm underline">
            {v.allPeriods}
          </Link>
        )}
        {filtered && (
          <Link href={invoicesHref(here, { tab: query.tab })} className="flex min-h-10 items-center text-sm underline">
            {v.thisMonth}
          </Link>
        )}
      </form>
      <p className="text-sm text-muted">
        {query.all ? v.allPeriods : fillWords(v.period, { from: dayLabel(query.from, w), to: dayLabel(query.to, w) })} · {count(documents.total)}
      </p>

      {documents.rows.length === 0 ? (
        <p className={`p-8 text-center text-sm ${CARD_CLASS}`}>
          {filtered
            ? credit
              ? v.noCreditNotesMatch
              : v.noInvoicesMatch
            : credit
              ? v.noCreditNotes
              : v.noInvoices}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] rounded-panel border border-line bg-card text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>{credit ? v.creditNote : v.invoice}</th>
                <th scope="col" className={th}>{v.date}</th>
                <th scope="col" className={th}>{v.order}</th>
                <th scope="col" className={th}>{v.buyer}</th>
                <th scope="col" className={`${th} text-right`}>{v.net}</th>
                <th scope="col" className={`${th} text-right`}>{v.vat}</th>
                <th scope="col" className={`${th} text-right`}>{v.total}</th>
                <th scope="col" className={th}>{v.document}</th>
              </tr>
            </thead>
            <tbody>
              {documents.rows.map((row) => (
                <Row key={row.id} base={base} orders={orders} row={row} credit={credit} money={money} w={w} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label={credit ? v.pagesCreditNotes : v.pagesInvoices} className="flex items-center gap-3 text-sm">
          {query.page > 1 ? (
            <Link href={invoicesHref(here, { ...query, page: query.page - 1 }, today)} className="underline">
              {v.previous}
            </Link>
          ) : (
            <span className="text-muted">{v.previous}</span>
          )}
          <span className="text-muted">{fillWords(v.pageOf, { page: query.page, pages, count: count(documents.total) })}</span>
          {query.page < pages ? (
            <Link href={invoicesHref(here, { ...query, page: query.page + 1 }, today)} className="underline">
              {v.next}
            </Link>
          ) : (
            <span className="text-muted">{v.next}</span>
          )}
        </nav>
      )}

      {canWrite ? (
        <Card title={v.csvTitle} compact>
          <p className="mb-3 text-sm text-muted">{credit ? v.csvCreditNotes : v.csvInvoices}</p>
          <form method="post" action={`${here}/export`} className="flex flex-wrap items-end gap-3" aria-label={v.downloadLabel}>
            <input type="hidden" name="type" value={credit ? "credit_notes" : "invoices"} />
            <label className="flex flex-col gap-1 text-sm font-medium">
              {v.from}
              <input type="date" name="from" required defaultValue={from || `${today.slice(0, 7)}-01`} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {v.to}
              <input type="date" name="to" required defaultValue={to} className={control} />
            </label>
            <button type="submit" className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
              {v.download}
            </button>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-muted">{v.csvNoAccess}</p>
      )}
    </div>
  );
}

function Row({
  base,
  orders,
  row,
  credit,
  money,
  w,
}: {
  base: string;
  orders: string;
  row: DocumentListRow;
  credit: boolean;
  money: (minor: number, currency: string) => string;
  w: InvoicesMessages;
}) {
  const v = w.view;
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className={td}>
        <span className="font-medium">{row.documentNumber}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {credit ? (
            <>
              <span>{fillWords(v.credits, { number: row.invoiceNumber ?? v.theInvoice })}</span>
              <span>· {sourceLabel(row.source, w)}</span>
            </>
          ) : (
            <span>{vatKindLabel(row.vatKind, w)}</span>
          )}
        </span>
      </td>
      <td className={td}>
        <time dateTime={row.issuedOn}>{dayLabel(row.issuedOn, w)}</time>
      </td>
      <td className={td}>
        <Link href={`${orders}/${row.orderId}`} className="underline-offset-2 hover:underline">
          #{row.orderNumber}
        </Link>
      </td>
      <td className={td}>
        {row.anonymised ? (
          <span className="text-muted">{v.removed}</span>
        ) : (
          <>
            <span className="block">{row.buyerName ?? "–"}</span>
            <span className="text-xs text-muted">{countryName(row.buyerCountry, w.labels.countryLanguage)}</span>
          </>
        )}
      </td>
      <td className={`${td} text-right tabular-nums`}>{money(row.netMinor, row.currency)}</td>
      <td className={`${td} text-right tabular-nums`}>{money(row.vatMinor, row.currency)}</td>
      <td className={`${td} text-right tabular-nums font-medium`}>{money(row.totalMinor, row.currency)}</td>
      <td className={td}>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <Link href={documentPrintHref(base, row.type, row.id)} className="underline" prefetch={false}>
            {v.viewDoc}
          </Link>
          {/* A PDF route redirects to the print page when the renderer is not available; the link is always offered. */}
          <a href={documentPdfHref(base, row.type, row.id)} className="underline">
            {v.pdf}
          </a>
        </span>
        {!row.hasPdf && !row.anonymised && <span className="block text-xs text-muted">{v.firstDownload}</span>}
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
  w,
}: {
  base: string;
  today: string;
  waiting: WaitingInvoice[];
  waitingNotes: WaitingCreditNote[];
  failing: FailingPdf[];
  canWrite: boolean;
  actions: { checkAgain: Action; retryPdf: Action };
  money: (minor: number, currency: string) => string;
  w: InvoicesMessages;
}) {
  const v = w.view;
  const orders = `${base}/orders`;
  const nothing = waiting.length === 0 && waitingNotes.length === 0 && failing.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <div className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
        <p className="max-w-3xl text-sm text-muted">
          {v.waitingIntro} <strong className="font-medium text-ink">{v.checkAgainName}</strong>
          {v.checkAgainEnd}
        </p>
        {canWrite ? <CheckAgainForm action={actions.checkAgain} /> : <p className="text-sm text-muted">{v.checkAgainNoAccess}</p>}
      </div>

      {nothing && <p className={`p-8 text-center text-sm ${CARD_CLASS}`}>{v.nothingWaits}</p>}

      {waiting.length > 0 && (
        <Card title={v.ordersWaiting} count={waiting.length} compact>
          <List label={v.ordersWaiting}>
            {waiting.map((one) => (
              <ListRow key={one.orderId}>
                <RowLead
                  title={`#${one.orderNumber}`}
                  href={`${orders}/${one.orderId}`}
                  sub={
                    <>
                      <span className="text-ink-2">{w.labels.waiting[one.reason]}</span> · {one.words}
                      {one.overdue && one.deadline && (
                        <span className="block text-danger-text">{fillWords(v.overdueLine, { deadline: dayLabel(one.deadline, w), today: dayLabel(today, w) })}</span>
                      )}
                      {one.fixAt && (
                        <Link href={`${base}${one.fixAt}`} className="block underline">
                          {v.fixIt}
                        </Link>
                      )}
                    </>
                  }
                />
                <RowFact className="hidden sm:block" sub={vatKindLabel(one.vatKind, w)}>
                  {v.paid} <time dateTime={one.paidOn}>{dayLabel(one.paidOn, w)}</time>
                </RowFact>
                <RowAmount>{money(one.totalMinor, one.currency)}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      {waitingNotes.length > 0 && (
        <Card
          title={v.refundsTitle}
          count={waitingNotes.length}
          description={v.refundsText}
          compact
        >
          <List label={v.refundsTitle}>
            {waitingNotes.map((n) => (
              <ListRow key={`${n.refundId ?? n.returnId}-${n.state}`}>
                <RowLead
                  title={`#${n.orderNumber}`}
                  href={`${orders}/${n.orderId}`}
                  sub={n.state === "missing" ? v.noCreditNoteYet : v.creditedInPart}
                />
                <RowAmount>
                  {money(n.amountMinor, n.currency)}
                  <span className="block text-caption text-muted">{n.state === "missing" ? v.theRefund : v.leftUncredited}</span>
                </RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      {failing.length > 0 && (
        <Card
          title={v.pdfNotMade}
          count={failing.length}
          description={v.pdfText}
          compact
        >
          <List label={v.pdfNotMade}>
            {failing.map((f) => (
              <ListRow key={`${f.type}-${f.id}`}>
                <RowLead
                  title={f.documentNumber}
                  sub={
                    <>
                      <Link href={documentPrintHref(base, f.type, f.id)} className="underline" prefetch={false}>
                        {v.viewDoc}
                      </Link>
                      {" · "}
                      <Link href={`${orders}/${f.orderId}`} className="underline-offset-2 hover:underline">
                        {fillWords(v.orderNumber, { number: f.orderNumber })}
                      </Link>
                      {" · "}
                      {countWords(f.attempts, v.tries)}
                      {f.lastError && <span className="block [overflow-wrap:anywhere]">{f.lastError}</span>}
                    </>
                  }
                />
                <RowActions>
                  {canWrite ? <RetryPdfForm action={actions.retryPdf} type={f.type} id={f.id} /> : <span className="text-body text-muted">{v.needsWriter}</span>}
                </RowActions>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
