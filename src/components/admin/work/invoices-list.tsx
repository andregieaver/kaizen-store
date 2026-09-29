import Link from "next/link";

import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import {
  INVOICE_SHOWS,
  SHOW_LABELS,
  hasListFilters,
  invoiceListQuery,
  type InvoiceListParams,
  type InvoiceShow,
} from "@/lib/work-invoice-ui";
import type { InvoiceList, InvoiceListRow } from "@/server/work-invoices";
import type { NewInvoiceChoices } from "@/server/work-invoice-screens";

import { NewInvoiceButton } from "./invoice-create-dialog";
import { InvoiceExportSlot } from "./invoice-export-slot";
import { InvoiceStatusChip } from "./invoice-status";
import { control, secondaryButton, smallButton } from "./work-parts";

const th = "px-3 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";

export type InvoicesListProps = {
  storeSlug: string;
  locale: string;
  list: InvoiceList;
  params: InvoiceListParams;
  clients: { id: string; name: string }[];
  choices: NewInvoiceChoices;
  /** Open the New invoice dialog at once (`?new=1`, where the overview's "Invoice time" leads). */
  openNew?: boolean;
};

/** The count each status tab shows: what is in the store, whatever the filters say. */
export function tabCount(show: InvoiceShow, counts: InvoiceList["counts"]): number {
  switch (show) {
    case "all":
      return counts.draft + counts.sent + counts.paid + counts.void;
    case "drafts":
      return counts.draft;
    case "sent":
      return counts.sent;
    case "overdue":
      return counts.overdue;
    case "paid":
      return counts.paid;
    case "void":
      return counts.void;
  }
}

/**
 * The invoices (docs/work.md 5.2): status tabs with their counts (all, drafts, issued, overdue, paid, void), a filter
 * for the client, the issue dates and a search of number, client and reference, the invoices as a table (stacked cards
 * on a phone) with amounts in their own currency, and a pager. Everything is in the address, so a view can be linked
 * to and the overview's "overdue" and "drafts" lead here. Overdue and due soon are derived in the store's time zone.
 */
export function InvoicesListView({
  storeSlug,
  locale,
  list,
  params,
  clients,
  choices,
  openNew = false,
}: InvoicesListProps) {
  const base = `/admin/${storeSlug}/work/invoices`;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (change: Partial<InvoiceListParams>) => `${base}${invoiceListQuery(params, change)}`;
  const empty = tabCount("all", list.counts) === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex flex-wrap items-center gap-2">
          <InvoiceExportSlot storeSlug={storeSlug} query={invoiceListQuery(params)} />
          <NewInvoiceButton storeSlug={storeSlug} choices={choices} defaultOpen={openNew} />
        </div>
      </div>

      <nav aria-label="Invoice status" className="flex flex-wrap gap-2">
        {INVOICE_SHOWS.map((show) => {
          const current = params.show === show;
          return (
            <Link
              key={show}
              href={link({ show })}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-3 text-sm ${
                current ? "bg-foreground text-background" : "bg-background"
              }`}
            >
              {SHOW_LABELS[show]}
              <span className={`text-xs tabular-nums ${current ? "" : "text-muted"}`}>
                {tabCount(show, list.counts)}
              </span>
            </Link>
          );
        })}
      </nav>

      <form
        method="get"
        action={base}
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter invoices"
      >
        {params.show !== "all" && <input type="hidden" name="show" value={params.show} />}
        <label className="flex min-w-40 flex-col gap-1 text-sm font-medium">
          Client
          <select name="client" defaultValue={params.clientId} className={`${control} font-normal`}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Issued from
          <input type="date" name="from" defaultValue={params.from} className={`${control} font-normal`} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Issued to
          <input type="date" name="to" defaultValue={params.to} className={`${control} font-normal`} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          Search
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="Number, client or reference"
            className={`${control} font-normal`}
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={secondaryButton}>
            Filter
          </button>
          {hasListFilters(params) && (
            <Link href={link({ clientId: "", from: "", to: "", q: "" })} className={secondaryButton}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {list.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
          {empty
            ? "No invoices yet. Start one with New invoice, or from a client's unbilled time."
            : "No invoice matches. Try another tab or clear the filters."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden" aria-label="Invoices">
            {list.rows.map((row) => (
              <InvoiceCard key={row.id} row={row} base={base} locale={locale} today={list.today} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-background md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Number
                  </th>
                  <th scope="col" className={th}>
                    Client
                  </th>
                  <th scope="col" className={th}>
                    Issued
                  </th>
                  <th scope="col" className={th}>
                    Due
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Total
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Outstanding
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => {
                  const money = (minor: number) => formatMoney(minor, row.currency, locale);
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="px-3 py-3 font-medium">
                        <Link href={`${base}/${row.id}`} className="underline">
                          {row.documentNumber ?? "Draft"}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        {row.clientName}
                        {row.assignmentName && <span className="block text-xs text-muted">{row.assignmentName}</span>}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{row.issuedOn ? formatDay(row.issuedOn, locale) : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{row.dueOn ? formatDay(row.dueOn, locale) : "–"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {money(row.totalMinor)}
                        {row.creditedMinor > 0 && (
                          <span className="block text-xs text-muted">{money(row.creditedMinor)} credited</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.status === "sent" ? money(row.outstandingMinor) : "–"}
                      </td>
                      <td className="px-3 py-3">
                        <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={list.today} showNote />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            Page {list.page} of {pages}, {list.total} invoices
          </span>
          <span className="flex gap-2">
            {list.page > 1 ? (
              <Link href={link({ page: list.page - 1 })} rel="prev" className={smallButton}>
                Previous
              </Link>
            ) : null}
            {list.page < pages ? (
              <Link href={link({ page: list.page + 1 })} rel="next" className={smallButton}>
                Next
              </Link>
            ) : null}
          </span>
        </nav>
      )}
    </div>
  );
}

function InvoiceCard({
  row,
  base,
  locale,
  today,
}: {
  row: InvoiceListRow;
  base: string;
  locale: string;
  today: string;
}) {
  const money = (minor: number) => formatMoney(minor, row.currency, locale);
  return (
    <li className="rounded-lg border border-border bg-background p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`${base}/${row.id}`} className="font-medium underline">
          {row.documentNumber ?? "Draft"}
        </Link>
        <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={today} />
      </div>
      <p className="mt-1">{row.clientName}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted">Issued</dt>
        <dd className="text-right tabular-nums">{row.issuedOn ? formatDay(row.issuedOn, locale) : "–"}</dd>
        <dt className="text-muted">Due</dt>
        <dd className="text-right tabular-nums">{row.dueOn ? formatDay(row.dueOn, locale) : "–"}</dd>
        <dt className="text-muted">Total</dt>
        <dd className="text-right font-medium tabular-nums">{money(row.totalMinor)}</dd>
        {row.status === "sent" && (
          <>
            <dt className="text-muted">Outstanding</dt>
            <dd className="text-right tabular-nums">{money(row.outstandingMinor)}</dd>
          </>
        )}
      </dl>
    </li>
  );
}
