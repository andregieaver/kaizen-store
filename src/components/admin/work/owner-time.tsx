import Link from "next/link";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { addCalendarDays, formatDay, startOfMonth } from "@/lib/work-dates";
import { WORK_LOCALE, withStore, type WorkStore } from "@/lib/work-owner";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import { formatDuration } from "@/lib/work-time";
import { TIME_BILLING_OPTIONS, activeFilterCount, timeFilterQuery, type TimeFilters } from "@/lib/work-ui";
import type { OwnerTimeList } from "@/server/work-owner";

import { StoreFilter } from "./owner-common";
import { Badge, control, secondaryButton } from "./work-parts";

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
      <div>
        <h1 className="text-2xl font-semibold">Time</h1>
        <p className="text-sm text-muted">
          Time logged{stores.length > 1 ? " in all your stores" : ""}. Change an entry in its store: each row leads there.
        </p>
      </div>

      <form
        method="get"
        role="search"
        aria-label="Filter time"
        className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StoreFilter stores={stores} value={storeSlug} />
          {clients.length > 0 && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Client
              <select name="client" defaultValue={filters.clientId} className={control}>
                <option value="">All clients</option>
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
              Person
              <select name="person" defaultValue={filters.accountId} className={control}>
                <option value="">Everyone</option>
                {people.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Search
            <input
              type="search"
              name="q"
              defaultValue={filters.query}
              maxLength={100}
              placeholder="Task or note"
              className={control}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            From
            <input type="date" name="from" defaultValue={filters.from} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            To
            <input type="date" name="to" defaultValue={filters.to} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Billable
            <select name="billable" defaultValue={filters.billable} className={control}>
              <option value="all">Billable and not</option>
              <option value="yes">Billable</option>
              <option value="no">Not billable</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Invoicing
            <select name="billing" defaultValue={filters.billing} className={control}>
              {TIME_BILLING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <button type="submit" className={secondaryButton}>
            Apply filters
          </button>
          <span className="text-muted">Days:</span>
          <Link href={range(today, today)} className="underline">
            Today
          </Link>
          <Link href={range(addCalendarDays(today, -6), today)} className="underline">
            Last 7 days
          </Link>
          <Link href={range(startOfMonth(today), today)} className="underline">
            This month
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
          Logged time
        </h2>
        <StatGrid>
          <Stat label="Entries" value={totals.count} />
          <Stat label="Time" value={formatDuration(totals.minutes)} />
          <Stat label="Billable" value={formatDuration(totals.billableMinutes)} />
          <Stat
            label="Not invoiced"
            value={totals.unbilledMinutes > 0 ? formatDuration(totals.unbilledMinutes) : "Nothing"}
          />
        </StatGrid>
        {list.truncated && (
          <p role="status" className="text-sm text-muted">
            There is more time than can be counted here. Narrow the days to see all of it.
          </p>
        )}
        {list.entries.length === 0 ? (
          <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">
            {totals.count === 0 && page === 1
              ? "No time matches. Log time in a store's Time page, or change the filters."
              : "There is no time on this page."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {list.entries.map((entry) => (
              <li key={`${entry.storeId}:${entry.id}`} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">{formatDay(entry.workDate, WORK_LOCALE)}</span>
                  <span className="tabular-nums">{formatDuration(entry.minutes)}</span>
                  {!entry.billable && <Badge>Not billable</Badge>}
                  {entry.invoiceStatus === "draft" && <Badge tone="warn">On a draft invoice</Badge>}
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
          <nav aria-label="Pages of time" className="flex items-center justify-between gap-3 text-sm">
            {page > 1 ? (
              <Link href={link(page - 1)} className="underline">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={link(page + 1)} className="underline">
                Older
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
