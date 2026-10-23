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
import { workBase } from "@/lib/work-paths";
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { workText } from "@/lib/work-text";


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
  const tw = workText().invoicesList;
  const base = `${workBase(storeSlug)}/invoices`;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (change: Partial<InvoiceListParams>) => `${base}${invoiceListQuery(params, change)}`;
  const empty = tabCount("all", list.counts) === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={tw.invoices} />
        <div className="flex flex-wrap items-center gap-2">
          <InvoiceExportSlot storeSlug={storeSlug} query={invoiceListQuery(params)} />
          <NewInvoiceButton storeSlug={storeSlug} choices={choices} defaultOpen={openNew} />
        </div>
      </div>

      <nav aria-label={tw.invoiceStatus} className="flex flex-wrap gap-2">
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

      <form
        method="get"
        action={base}
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label={tw.filterInvoices}
      >
        {params.show !== "all" && <input type="hidden" name="show" value={params.show} />}
        <label className="flex min-w-40 flex-col gap-1 text-sm font-medium">
          {tw.client}
          <select name="client" defaultValue={params.clientId} className={`${control} font-normal`}>
            <option value="">{tw.allClients}</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {tw.issuedFrom}
          <input type="date" name="from" defaultValue={params.from} className={`${control} font-normal`} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {tw.issuedTo}
          <input type="date" name="to" defaultValue={params.to} className={`${control} font-normal`} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          {tw.search}
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder={tw.numberClientOrReference}
            className={`${control} font-normal`}
          />
        </label>
        <div className="flex gap-2">
          <button type="submit" className={secondaryButton}>
            {tw.filter}
          </button>
          {hasListFilters(params) && (
            <Link href={link({ clientId: "", from: "", to: "", q: "" })} className={secondaryButton}>
              {tw.clear}
            </Link>
          )}
        </div>
      </form>

      {list.rows.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {empty
            ? tw.noInvoicesYetStart
            : tw.noInvoiceMatchesTry}
        </p>
      ) : (
        <Card compact>
          <List label={tw.invoices}>
            {list.rows.map((row) => (
              <InvoiceRow key={row.id} row={row} base={base} locale={locale} today={list.today} />
            ))}
          </List>
        </Card>
      )}

      {pages > 1 && (
        <nav aria-label={tw.pages} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">
            Page {list.page} of {pages}, {list.total} invoices
          </span>
          <span className="flex gap-2">
            {list.page > 1 ? (
              <Link href={link({ page: list.page - 1 })} rel="prev" className={smallButton}>
                {tw.previous}
              </Link>
            ) : null}
            {list.page < pages ? (
              <Link href={link({ page: list.page + 1 })} rel="next" className={smallButton}>
                {tw.next}
              </Link>
            ) : null}
          </span>
        </nav>
      )}
    </div>
  );
}

function InvoiceRow({ row, base, locale, today }: { row: InvoiceListRow; base: string; locale: string; today: string }) {
  const tw = workText().invoicesList;
  const money = (minor: number) => formatMoney(minor, row.currency, locale);
  return (
    <ListRow>
      <RowLead
        title={row.documentNumber ?? "Draft"}
        href={`${base}/${row.id}`}
        sub={
          <>
            {row.clientName}
            {row.assignmentName && ` · ${row.assignmentName}`}
          </>
        }
      />
      <RowFact className="hidden sm:block" sub={row.dueOn ? `Due ${formatDay(row.dueOn, locale)}` : undefined}>
        {row.issuedOn ? `Issued ${formatDay(row.issuedOn, locale)}` : tw.notIssued}
      </RowFact>
      <InvoiceStatusChip status={row.status} dueOn={row.dueOn} today={today} showNote />
      <RowAmount>
        {money(row.totalMinor)}
        {row.creditedMinor > 0 && <span className="block text-caption text-muted">{money(row.creditedMinor)} credited</span>}
        {row.status === "sent" && <span className="block text-caption text-muted">{money(row.outstandingMinor)} outstanding</span>}
      </RowAmount>
    </ListRow>
  );
}
