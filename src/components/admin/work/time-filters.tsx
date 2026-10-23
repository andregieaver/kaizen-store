import Link from "next/link";

import { addCalendarDays, startOfMonth } from "@/lib/work-dates";
import { TIME_BILLING_OPTIONS, activeFilterCount, timeFilterQuery, type TimeFilters } from "@/lib/work-ui";

import { control, secondaryButton } from "./work-parts";
import { CARD_CLASS } from "@/components/admin/ui";
import { workText } from "@/lib/work-text";

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
  /** `workBase(store)`. */
  base: string;
  filters: TimeFilters;
  clients: Option[];
  assignments: Option[];
  /** Owners choose who; others see their own time only. */
  people: Option[] | null;
  today: string;
}) {
  const tw = workText().timeFilters;
  const count = activeFilterCount(filters);
  const range = (from: string, to: string) => `${base}/time${timeFilterQuery({ ...filters, from, to })}`;
  return (
    <form
      method="get"
      role="search"
      aria-label={tw.filterTime}
      className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <label className="flex flex-col gap-1 text-sm font-medium">
          {tw.assignment}
          <select name="assignment" defaultValue={filters.assignmentId} className={control}>
            <option value="">{tw.allAssignments}</option>
            {assignments.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
          <Link href={`${base}/time`} className="underline">
            Clear {count === 1 ? "the filter" : `${count} filters`}
          </Link>
        )}
      </div>
    </form>
  );
}
