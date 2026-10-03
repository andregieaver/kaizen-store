import Link from "next/link";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { countsSentence, dayText, KIND_FILTERS, queueHref, STATUS_FILTERS } from "@/lib/return-admin";
import type { ReturnQueueFilter } from "@/lib/return-input";
import type { Queue, ReturnCounts } from "@/server/returns";

import { DueMark, KindBadge, StatusBadge } from "./ui";

const control = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

/**
 * The returns queue (D153): what is open, oldest first, with what is overdue, what waits for an answer and what
 * acknowledgement was not sent. Drawn from its data alone, so every state can be seen without a browser or a database.
 */
export function ReturnsQueueView({
  base,
  filter,
  queue,
  counts,
  timeZone,
  locale = "en-GB",
}: {
  /** `/admin/{store}/returns` */
  base: string;
  filter: ReturnQueueFilter;
  queue: Queue;
  counts: ReturnCounts;
  timeZone: string;
  locale?: string;
}) {
  const filtered = filter.status !== "open" || filter.kind !== "all" || filter.q !== "" || filter.overdue;
  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));
  const orders = base.replace(/\/returns$/, "/orders");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Returns</h1>
        <p className="text-sm text-muted">
          Withdrawals are the customer&apos;s legal right to change their mind: you cannot refuse them, and the refund is due within 14 days of
          being told. Return requests are inside your own longer window, and you may approve or decline them.
        </p>
        <p className="mt-1 text-sm text-muted">
          A customer who withdrew by email, letter or phone, or whose statement the form could not match to an order, has still withdrawn: open the order
          from Orders and register it under Returns and withdrawals.
        </p>
        <p role="status" className="mt-1 text-sm">
          {countsSentence(counts)}
        </p>
      </div>

      <StatGrid>
        <Stat label="Open" value={counts.open} href={base} />
        <Stat label="To approve" value={counts.requested} href={queueHref(base, { status: "requested" })} />
        <Stat label="Past the refund deadline" value={counts.overdue} sub={counts.overdue > 0 ? "The law gives 14 days" : undefined} href={queueHref(base, { overdue: true })} />
        <Stat label="Acknowledgement not sent" value={counts.acknowledgementPending} sub={counts.acknowledgementPending > 0 ? "Open it and send it again" : undefined} />
      </StatGrid>

      <form method="get" action={base} className="flex flex-wrap items-end gap-3" aria-label="Filter the returns">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Status
          <select name="status" defaultValue={filter.status} className={control}>
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Kind
          <select name="kind" defaultValue={filter.kind} className={control}>
            {KIND_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          Search
          <input name="q" type="search" defaultValue={filter.q} placeholder="Return, order, name or email" maxLength={100} className={`${control} w-full`} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="overdue" value="1" defaultChecked={filter.overdue} className="size-4" />
          Past the refund deadline
        </label>
        <button type="submit" className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background">
          Filter
        </button>
        {filtered && (
          <Link href={base} className="flex min-h-10 items-center text-sm underline">
            Clear
          </Link>
        )}
      </form>

      {queue.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-8 text-center text-sm">
          {filtered
            ? "No returns match. Change the filter or clear it."
            : "No returns are open. Withdrawals and return requests appear here as customers make them: they use the Withdraw from the contract link in the order emails and the store's withdrawal page."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] rounded-lg border border-border bg-background text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Return</th>
                <th scope="col" className="px-4 py-2 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Units</th>
                <th scope="col" className="px-4 py-2 font-medium">Made</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 font-medium">Refund</th>
              </tr>
            </thead>
            <tbody>
              {queue.rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-2">
                    <Link href={`${base}/${row.id}`} className="font-medium underline-offset-2 hover:underline">
                      {row.number}
                    </Link>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <KindBadge kind={row.kind} />
                      {row.acknowledgementPending && <span className="text-xs font-medium text-red-700 dark:text-red-400">Acknowledgement not sent</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="block">{row.name || row.email || "–"}</span>
                    <Link href={`${orders}/${row.orderId}`} className="text-xs text-muted underline-offset-2 hover:underline">
                      Order #{row.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.units}</td>
                  <td className="px-4 py-2">
                    <time dateTime={row.createdAt}>{dayText(row.createdAt, timeZone)}</time>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2">
                    {row.refundMinor !== null ? (
                      <span className="tabular-nums">{formatMoney(row.refundMinor, row.currency, locale)}</span>
                    ) : (
                      <DueMark due={row.due} timeZone={timeZone} />
                    )}
                    {row.refundMinor === null && row.status === "requested" && <span className="text-sm text-muted">Waiting for your answer</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Pages of returns" className="flex items-center gap-3 text-sm">
          {queue.page > 1 ? (
            <Link href={queueHref(base, { ...filter, page: queue.page - 1 })} className="underline">
              Previous
            </Link>
          ) : (
            <span className="text-muted">Previous</span>
          )}
          <span className="text-muted">
            Page {queue.page} of {pages} · {queue.total} returns
          </span>
          {queue.page < pages ? (
            <Link href={queueHref(base, { ...filter, page: queue.page + 1 })} className="underline">
              Next
            </Link>
          ) : (
            <span className="text-muted">Next</span>
          )}
        </nav>
      )}
    </div>
  );
}
