import Link from "next/link";
import { Suspense } from "react";

import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import { requireMember } from "@/server/auth";
import { listWorkInvoices } from "@/server/work-invoices";

import { BillUnbilledButton } from "./bill-unbilled-button";
import { NewInvoiceButton } from "./invoice-create-dialog";
import { InvoiceStatusChip } from "./invoice-status";

export { BillUnbilledButton };

/**
 * The invoice parts of the client and assignment pages (docs/work.md 5.2, 7.2 WP6): a client's or an assignment's
 * invoices with "New invoice", and "Bill unbilled time", which opens or makes the draft and fills it from the time
 * nothing has invoiced in one step. The pages already know the figures, so what is drawn at once needs no read: the
 * buttons and the sums; the list of invoices streams in behind a `<Suspense>`, read with the store's id.
 */

const button =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm disabled:opacity-40";

// --- A client's invoices ---------------------------------------------------------------------------------------------

export type ClientInvoicesPanelProps = {
  storeSlug: string;
  clientId: string;
  clientName: string;
  currency: string;
  locale: string;
  /** Archived clients take no new invoices. */
  archived: boolean;
  /** Billable minutes no invoice line has taken yet, less what prepaid hours covered. */
  unbilledMinutes: number;
};

/** A client's invoices, void and credited ones included, with "New invoice". */
export function ClientInvoicesPanel({ storeSlug, clientId, clientName, locale, archived }: ClientInvoicesPanelProps) {
  return (
    <section aria-labelledby="client-invoices-heading" className="flex flex-col gap-3" data-slot="client-invoices">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="client-invoices-heading" className="text-lg font-semibold">
          Invoices
        </h2>
        {archived ? null : <NewInvoiceButton storeSlug={storeSlug} clientId={clientId} className={button} />}
      </div>
      <Suspense fallback={<p className="text-sm text-muted">Reading the invoices …</p>}>
        <InvoiceList
          storeSlug={storeSlug}
          locale={locale}
          filter={{ clientId }}
          empty={`No invoice has been made for ${clientName} yet.`}
        />
      </Suspense>
      <p className="text-sm">
        <Link href={`/admin/${storeSlug}/work/invoices?client=${clientId}`} className="underline">
          Open the invoices list for this client
        </Link>
      </p>
    </section>
  );
}

// --- An assignment's invoices ------------------------------------------------------------------------------------------

export type AssignmentInvoicesPanelProps = {
  storeSlug: string;
  assignmentId: string;
  assignmentName: string;
  clientId: string;
  currency: string;
  locale: string;
  /** The draft invoice its time goes on, if it has one. */
  draftInvoiceId: string | null;
  /** How many issued (sent or paid) invoices bill it. */
  issuedInvoices: number;
  unbilledMinutes: number;
  /** What the unbilled time comes to, net, in the client's currency. */
  unbilledAmountMinor: number;
};

/** An assignment's invoices: its draft (there is one at a time) and the invoices that bill it, with "New invoice". */
export function AssignmentInvoicesPanel({
  storeSlug,
  assignmentId,
  assignmentName,
  clientId,
  locale,
  draftInvoiceId,
}: AssignmentInvoicesPanelProps) {
  return (
    <section
      aria-labelledby="assignment-invoices-heading"
      className="flex flex-col gap-3"
      data-slot="assignment-invoices"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="assignment-invoices-heading" className="text-lg font-semibold">
          Invoices
        </h2>
        {draftInvoiceId ? (
          <Link href={`/admin/${storeSlug}/work/invoices/${draftInvoiceId}`} className={button}>
            Open the draft
          </Link>
        ) : (
          <NewInvoiceButton storeSlug={storeSlug} clientId={clientId} assignmentId={assignmentId} className={button} />
        )}
      </div>
      {draftInvoiceId && (
        <p className="text-sm text-muted">
          The time you log goes on this assignment&apos;s draft invoice. There is one draft at a time.
        </p>
      )}
      <Suspense fallback={<p className="text-sm text-muted">Reading the invoices …</p>}>
        <InvoiceList
          storeSlug={storeSlug}
          locale={locale}
          filter={{ assignmentId }}
          empty={`${assignmentName} has no invoice yet.`}
        />
      </Suspense>
    </section>
  );
}

// --- Bill unbilled time -------------------------------------------------------------------------------------------------

export type BillUnbilledPanelProps = {
  storeSlug: string;
  scope: { clientId: string; assignmentId?: undefined } | { assignmentId: string; clientId?: undefined };
  currency: string;
  locale: string;
  unbilledMinutes: number;
  /** What it comes to, net, at the rates. */
  unbilledAmountMinor: number;
};

/** "Bill unbilled time" with what would be billed; nothing when there is none. */
export function BillUnbilledPanel({
  storeSlug,
  scope,
  currency,
  locale,
  unbilledMinutes,
  unbilledAmountMinor,
}: BillUnbilledPanelProps) {
  if (unbilledMinutes <= 0) return null;
  return (
    <section
      aria-label="Bill unbilled time"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4"
      data-slot="bill-unbilled"
    >
      <p className="text-sm">
        <strong className="font-medium">{formatDuration(unbilledMinutes)}</strong> of billable time is not on an invoice
        yet
        {unbilledAmountMinor > 0 ? `, about ${formatMoney(unbilledAmountMinor, currency, locale)} without VAT` : ""}.
      </p>
      <BillUnbilledButton
        storeSlug={storeSlug}
        clientId={scope.clientId}
        assignmentId={scope.assignmentId}
        className={button}
      />
    </section>
  );
}

// --- The list ---------------------------------------------------------------------------------------------------------------

/** The invoices, read for the store: each a link with its number, date, status and amount. */
async function InvoiceList({
  storeSlug,
  locale,
  filter,
  empty,
}: {
  storeSlug: string;
  locale: string;
  filter: { clientId?: string; assignmentId?: string };
  empty: string;
}) {
  const { store } = await requireMember(storeSlug);
  const list = await listWorkInvoices(store.id, { ...filter, pageSize: 50 });
  const base = `/admin/${storeSlug}/work/invoices`;
  if (list.rows.length === 0)
    return <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">{empty}</p>;
  return (
    <ul
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background px-4"
      aria-label="Invoices"
    >
      {list.rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`${base}/${row.id}`} className="font-medium underline">
              {row.documentNumber ?? "Draft"}
            </Link>
            <span className="text-muted">{row.issuedOn ? formatDay(row.issuedOn, locale) : "not issued"}</span>
            <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={list.today} showNote />
          </span>
          <span className="tabular-nums">
            {formatMoney(row.totalMinor, row.currency, locale)}
            {row.status === "sent" && row.outstandingMinor !== row.totalMinor && (
              <span className="text-xs text-muted">
                {" "}
                ({formatMoney(row.outstandingMinor, row.currency, locale)} left)
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
