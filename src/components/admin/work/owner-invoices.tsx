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
import { WORK_LOCALE, withStore, type WorkStore } from "@/lib/work-owner";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import type { OwnerInvoiceList, OwnerInvoiceRow } from "@/server/work-owner";

import { InvoiceStatusChip } from "./invoice-status";
import { CurrencyNote, StoreFilter } from "./owner-common";
import { NewInStoreButton } from "./owner-parts";
import { control, secondaryButton, smallButton } from "./work-parts";

const th = "px-3 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";

function tabCount(show: InvoiceShow, counts: OwnerInvoiceList["counts"]): number {
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
 * The invoices of all the account's stores (D123): the status tabs of a store's list with counts over all stores,
 * a filter for the store, the issue dates and a search, the invoices as a table (stacked cards on a phone) with
 * each amount in its own currency, and totals per currency for what the filter matches (never added across
 * currencies). Each row leads to the invoice in its store. "New invoice" asks which store first.
 */
export function OwnerInvoicesView({
  stores,
  list,
  params,
  storeSlug,
  defaultStore,
}: {
  stores: WorkStore[];
  list: OwnerInvoiceList;
  params: InvoiceListParams;
  storeSlug: string;
  defaultStore: string;
}) {
  const many = stores.length > 1;
  const base = `${WORK_ROOT}/invoices`;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (change: Partial<InvoiceListParams>) => `${base}${withStore(invoiceListQuery(params, change), storeSlug)}`;
  const empty = tabCount("all", list.counts) === 0;
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <NewInStoreButton
          kind="invoice"
          stores={stores.map(({ slug, name }) => ({ slug, name }))}
          defaultSlug={defaultStore}
        />
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

      <form method="get" action={base} className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter invoices">
        {params.show !== "all" && <input type="hidden" name="show" value={params.show} />}
        <StoreFilter stores={stores} value={storeSlug} />
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
          {(hasListFilters(params) || storeSlug !== "") && (
            <Link href={`${base}${params.show !== "all" ? `?show=${params.show}` : ""}`} className={secondaryButton}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {list.totals.length > 0 && (
        <section aria-label="Totals of these invoices" className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-3">
            {list.totals.map((total) => (
              <li key={total.currency} className="rounded-lg border border-border bg-background px-4 py-3 text-sm">
                <span className="block text-xs text-muted">
                  {total.currency}, {total.count} {total.count === 1 ? "invoice" : "invoices"}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(total.totalMinor, total.currency, WORK_LOCALE)}
                </span>
                {total.outstandingMinor > 0 && (
                  <span className="block text-xs text-muted">
                    {formatMoney(total.outstandingMinor, total.currency, WORK_LOCALE)} still owed
                  </span>
                )}
              </li>
            ))}
          </ul>
          {(many || list.totals.length > 1) && <CurrencyNote />}
        </section>
      )}

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
              <InvoiceCard key={`${row.storeId}:${row.id}`} row={row} many={many} />
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
                  {many && (
                    <th scope="col" className={th}>
                      Store
                    </th>
                  )}
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
                  const money = (minor: number) => formatMoney(minor, row.currency, WORK_LOCALE);
                  return (
                    <tr key={`${row.storeId}:${row.id}`} className="border-t border-border align-top">
                      <td className="px-3 py-3 font-medium">
                        <Link href={`${workBase(row.storeSlug)}/invoices/${row.id}`} className="underline">
                          {row.documentNumber ?? "Draft"}
                        </Link>
                      </td>
                      {many && (
                        <td className="px-3 py-3">
                          <Link href={workBase(row.storeSlug)} className="underline">
                            {row.storeName}
                          </Link>
                        </td>
                      )}
                      <td className="px-3 py-3">
                        {row.clientName}
                        {row.assignmentName && <span className="block text-xs text-muted">{row.assignmentName}</span>}
                      </td>
                      <td className="px-3 py-3 tabular-nums">{row.issuedOn ? formatDay(row.issuedOn, WORK_LOCALE) : "–"}</td>
                      <td className="px-3 py-3 tabular-nums">{row.dueOn ? formatDay(row.dueOn, WORK_LOCALE) : "–"}</td>
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
                        <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={row.today} showNote />
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

function InvoiceCard({ row, many }: { row: OwnerInvoiceRow; many: boolean }) {
  const money = (minor: number) => formatMoney(minor, row.currency, WORK_LOCALE);
  return (
    <li className="rounded-lg border border-border bg-background p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={`${workBase(row.storeSlug)}/invoices/${row.id}`} className="font-medium underline">
          {row.documentNumber ?? "Draft"}
        </Link>
        <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={row.today} />
      </div>
      <p className="mt-1">{row.clientName}</p>
      {many && <p className="text-xs text-muted">{row.storeName}</p>}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted">Issued</dt>
        <dd className="text-right tabular-nums">{row.issuedOn ? formatDay(row.issuedOn, WORK_LOCALE) : "–"}</dd>
        <dt className="text-muted">Due</dt>
        <dd className="text-right tabular-nums">{row.dueOn ? formatDay(row.dueOn, WORK_LOCALE) : "–"}</dd>
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
