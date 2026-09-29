import Link from "next/link";

import { addCalendarDays, startOfMonth } from "@/lib/work-dates";
import { TIME_BILLING_OPTIONS, activeFilterCount, timeFilterQuery, type TimeFilters } from "@/lib/work-ui";

import { control, secondaryButton } from "./work-parts";

type Option = { id: string; label: string };

/**
 * What the Time page narrows its entries by, all in the address (a plain form,
 * it works without scripts): client, assignment, who worked (owners), the days,
 * billable or not, whether it is on an invoice, and a search of task titles and
 * notes. Links for today, the last 7 days and this month set the days.
 */
export function TimeFiltersForm({
  base,
  filters,
  clients,
  assignments,
  people,
  today,
}: {
  /** `/admin/{store}/work`. */
  base: string;
  filters: TimeFilters;
  clients: Option[];
  assignments: Option[];
  /** Owners choose who; others see their own time only. */
  people: Option[] | null;
  today: string;
}) {
  const count = activeFilterCount(filters);
  const range = (from: string, to: string) => `${base}/time${timeFilterQuery({ ...filters, from, to })}`;
  return (
    <form
      method="get"
      role="search"
      aria-label="Filter time"
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <label className="flex flex-col gap-1 text-sm font-medium">
          Assignment
          <select name="assignment" defaultValue={filters.assignmentId} className={control}>
            <option value="">All assignments</option>
            {assignments.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
          <Link href={`${base}/time`} className="underline">
            Clear {count === 1 ? "the filter" : `${count} filters`}
          </Link>
        )}
      </div>
    </form>
  );
}
