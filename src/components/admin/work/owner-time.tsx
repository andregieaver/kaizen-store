import Link from "next/link";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { addCalendarDays, formatDay, startOfMonth } from "@/lib/work-dates";
import { WORK_LOCALE, withStore, type WorkStore } from "@/lib/work-owner";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import { formatDuration } from "@/lib/work-time";
import { TIME_BILLING_OPTIONS, activeFilterCount, timeFilterQuery, type TimeFilters } from "@/lib/work-ui";
import type { OwnerTimeList } from "@/server/work-owner";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { StoreFilter } from "./owner-common";
import { Badge, control, secondaryButton } from "./work-parts";
import { workText } from "@/lib/work-text";

type Option = { id: string; label: string };

/**
 * The time logged across the account's stores (D123), newest first, narrowed by store, client (once a store is
 * chosen), person (in stores the account owns), days, billable, invoicing and a search. Owners see everyone's time
 * in their stores, anyone else only their own. Entries are changed in the store's own Time page, which each row
 * links to; the timer is the shell's, above.
 */
export function OwnerTimeView({
  stores,
  list,
  filters,
  storeSlug,
  clients,
  people,
  today,
  page,
  pageSize,
  showPerson,
}: {
  stores: WorkStore[];
  list: OwnerTimeList;
  filters: TimeFilters;
  storeSlug: string;
  /** The chosen store's clients, for the client filter; empty while all stores are shown. */
  clients: Option[];
  /** Who can be chosen: null when the account owns none of the stores shown. */
  people: Option[] | null;
  today: string;
  page: number;
  pageSize: number;
  showPerson: boolean;
}) {
  const tw = workText().ownerTime;
  const many = stores.length > 1 && storeSlug === "";
  const count = activeFilterCount(filters) + (storeSlug ? 1 : 0);
  const query = (change: TimeFilters, extra: Record<string, string> = {}) =>
    `${WORK_ROOT}/time${withStore(timeFilterQuery(change, extra), storeSlug)}`;
  const { totals } = list;
  const pages = Math.max(1, Math.ceil(totals.count / pageSize));
  const link = (n: number) => query(filters, n > 1 ? { page: String(n) } : {});
  const range = (from: string, to: string) => query({ ...filters, from, to });
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={tw.time}
        description={stores.length > 1 ? tw.timeLoggedAll : tw.timeLoggedOne}
      />

      <form
        method="get"
        role="search"
        aria-label={tw.filterTime}
        className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StoreFilter stores={stores} value={storeSlug} />
          {clients.length > 0 && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {tw.client}
              <select name="client" defaultValue={filters.clientId} className={control}>
                <option value="">{tw.allClients}</option>
                {clients.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {people && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {tw.person}
              <select name="person" defaultValue={filters.accountId} className={control}>
                <option value="">{tw.everyone}</option>
                {people.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.search}
            <input
              type="search"
              name="q"
              defaultValue={filters.query}
              maxLength={100}
              placeholder={tw.taskOrNote}
              className={control}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.from}
            <input type="date" name="from" defaultValue={filters.from} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.to}
            <input type="date" name="to" defaultValue={filters.to} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.billable}
            <select name="billable" defaultValue={filters.billable} className={control}>
              <option value="all">{tw.billableAndNot}</option>
              <option value="yes">{tw.billable}</option>
              <option value="no">{tw.notBillable}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.invoicing}
            <select name="billing" defaultValue={filters.billing} className={control}>
              {TIME_BILLING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {workText().labels.timeBilling[option.value]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <button type="submit" className={secondaryButton}>
            {tw.applyFilters}
          </button>
          <span className="text-muted">{tw.days}</span>
          <Link href={range(today, today)} className="underline">
            {tw.today}
          </Link>
          <Link href={range(addCalendarDays(today, -6), today)} className="underline">
            {tw.last7Days}
          </Link>
          <Link href={range(startOfMonth(today), today)} className="underline">
            {tw.thisMonth}
          </Link>
          {count > 0 && (
            <Link href={`${WORK_ROOT}/time`} className="underline">
              Clear {count === 1 ? "the filter" : `${count} filters`}
            </Link>
          )}
        </div>
      </form>

      <section aria-labelledby="entries-heading" className="flex flex-col gap-3">
        <h2 id="entries-heading" className="sr-only">
          {tw.loggedTime}
        </h2>
        <StatGrid>
          <Stat label={tw.entries} value={totals.count} />
          <Stat label={tw.time} value={formatDuration(totals.minutes)} />
          <Stat label={tw.billable} value={formatDuration(totals.billableMinutes)} />
          <Stat
            label={tw.notInvoiced}
            value={totals.unbilledMinutes > 0 ? formatDuration(totals.unbilledMinutes) : "Nothing"}
          />
        </StatGrid>
        {list.truncated && (
          <p role="status" className="text-sm text-muted">
            {tw.thereIsMoreTime}
          </p>
        )}
        {list.entries.length === 0 ? (
          <p className={`p-4 text-sm text-muted ${CARD_CLASS}`}>
            {totals.count === 0 && page === 1
              ? tw.noTimeMatchesLog
              : tw.thereIsNoTime}
          </p>
        ) : (
          <ul className={`divide-y divide-line ${CARD_CLASS}`}>
            {list.entries.map((entry) => (
              <li key={`${entry.storeId}:${entry.id}`} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">{formatDay(entry.workDate, WORK_LOCALE)}</span>
                  <span className="tabular-nums">{formatDuration(entry.minutes)}</span>
                  {!entry.billable && <Badge>{tw.notBillable}</Badge>}
                  {entry.invoiceStatus === "draft" && <Badge tone="warn">{tw.onADraftInvoice}</Badge>}
                  {entry.locked && (
                    <Badge tone="good">Invoiced{entry.invoiceNumber ? ` ${entry.invoiceNumber}` : ""}</Badge>
                  )}
                  {entry.taskTitle && <span className="min-w-0 text-muted [overflow-wrap:anywhere]">{entry.taskTitle}</span>}
                  {showPerson && <span className="text-muted">{entry.accountName}</span>}
                </div>
                <p className="[overflow-wrap:anywhere]">
                  <Link href={`${workBase(entry.storeSlug)}/assignments/${entry.assignmentId}`} className="underline">
                    {entry.assignmentName}
                  </Link>{" "}
                  <span className="text-muted">
                    for{" "}
                    <Link href={`${workBase(entry.storeSlug)}/clients/${entry.clientId}`} className="underline">
                      {entry.clientName}
                    </Link>
                    {many && (
                      <>
                        {" "}
                        in{" "}
                        <Link href={`${workBase(entry.storeSlug)}/time`} className="underline">
                          {entry.storeName}
                        </Link>
                      </>
                    )}
                  </span>
                </p>
                {entry.note && <p className="text-muted [overflow-wrap:anywhere]">{entry.note}</p>}
              </li>
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label={tw.pagesOfTime} className="flex items-center justify-between gap-3 text-sm">
            {page > 1 ? (
              <Link href={link(page - 1)} className="underline">
                {tw.newer}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={link(page + 1)} className="underline">
                {tw.older}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
