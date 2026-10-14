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
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

import { InvoiceStatusChip } from "./invoice-status";
import { CurrencyNote, StoreFilter } from "./owner-common";
import { NewInStoreButton } from "./owner-parts";
import { control, secondaryButton, smallButton } from "./work-parts";


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
        <PageHeader title="Invoices" />
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
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border border-edge px-3 text-sm ${
                current ? "bg-brand text-brand-ink" : "bg-card"
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
              <li key={total.currency} className="rounded-lg border border-line bg-card px-4 py-3 text-sm">
                <span className="block text-xs text-muted">
                  {total.currency}, {total.count} {total.count === 1 ? "invoice" : "invoices"}
                </span>
                <span className="font-medium tabular-nums">
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
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {empty
            ? "No invoices yet. Start one with New invoice, or from a client's unbilled time."
            : "No invoice matches. Try another tab or clear the filters."}
        </p>
      ) : (
        <Card compact>
          <List label="Invoices">
            {list.rows.map((row) => (
              <InvoiceRow key={`${row.storeId}:${row.id}`} row={row} many={many} />
            ))}
          </List>
        </Card>
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

function InvoiceRow({ row, many }: { row: OwnerInvoiceRow; many: boolean }) {
  const money = (minor: number) => formatMoney(minor, row.currency, WORK_LOCALE);
  return (
    <ListRow>
      <RowLead
        title={row.documentNumber ?? "Draft"}
        href={`${workBase(row.storeSlug)}/invoices/${row.id}`}
        sub={
          <>
            {many && (
              <>
                <Link href={workBase(row.storeSlug)} className="underline-offset-2 hover:underline">
                  {row.storeName}
                </Link>
                {" · "}
              </>
            )}
            {row.clientName}
            {row.assignmentName && ` · ${row.assignmentName}`}
          </>
        }
      />
      <RowFact className="hidden sm:block" sub={row.dueOn ? `Due ${formatDay(row.dueOn, WORK_LOCALE)}` : undefined}>
        {row.issuedOn ? `Issued ${formatDay(row.issuedOn, WORK_LOCALE)}` : "Not issued"}
      </RowFact>
      <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={row.today} showNote />
      <RowAmount>
        {money(row.totalMinor)}
        {row.creditedMinor > 0 && <span className="block text-caption text-muted">{money(row.creditedMinor)} credited</span>}
        {row.status === "sent" && <span className="block text-caption text-muted">{money(row.outstandingMinor)} outstanding</span>}
      </RowAmount>
    </ListRow>
  );
}
