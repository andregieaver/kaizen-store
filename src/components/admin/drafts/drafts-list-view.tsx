import Link from "next/link";

import { hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { DRAFTS_OPEN_MAX } from "@/lib/order-limits";
import { DRAFT_STATUSES, DRAFT_STATUS_LABELS, type DraftStatus } from "@/lib/draft-status";
import { formatMoney } from "@/lib/money";
import type { DraftListRow } from "@/server/draft-orders";

/** What the drafts list says under a draft's status, in words. */
function statusNote(row: DraftListRow, when: (iso: string) => string): string | null {
  if (row.status === "sent" && row.expiresAt) return `Link valid until ${when(row.expiresAt)}`;
  if (row.status === "expired") return "The link ran out and the order was cancelled";
  if (row.status === "cancelled") return "Cancelled";
  return null;
}

/**
 * The list of draft orders (wave 3, D173, `docs/wave-3-orders.md` 2.4): newest first, with the number, the customer, what it is worth, where it stands and when its link ends, a filter by
 * status and the count of open drafts against the limit of 500. Presentational: the page reads `listDrafts()`. A draft's total is what the server works out from its lines (or the order's
 * total once it was sent), in the draft's own currency: no sum across currencies is made.
 */
export function DraftsListView({
  slug,
  rows,
  status,
  nextCursor,
  hasCursor,
  openCount,
  canWrite,
  locale,
  timeZone,
}: {
  slug: string;
  rows: DraftListRow[];
  status: DraftStatus | null;
  nextCursor: string | null;
  hasCursor: boolean;
  openCount: number;
  canWrite: boolean;
  locale: string;
  timeZone: string;
}) {
  const base = `/admin/${slug}/orders/drafts`;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  const href = (change: { status?: DraftStatus | null; after?: string | null }) => {
    const q = new URLSearchParams();
    const next = { status, after: null as string | null, ...change };
    if (next.status) q.set("status", next.status);
    if (next.after) q.set("after", next.after);
    const text = q.toString();
    return text === "" ? base : `${base}?${text}`;
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Draft status" className="flex flex-wrap gap-1 border-b border-border pb-2 text-sm">
          <Link href={href({ status: null })} aria-current={status === null ? "page" : undefined} className="rounded-md px-3 py-1.5 text-muted hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
            All
          </Link>
          {DRAFT_STATUSES.map((s) => (
            <Link key={s} href={href({ status: s })} aria-current={status === s ? "page" : undefined} className="rounded-md px-3 py-1.5 text-muted hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
              {DRAFT_STATUS_LABELS[s]}
            </Link>
          ))}
        </nav>
        {canWrite && (
          <Link href={`${base}/new`} className={primary}>
            New draft order
          </Link>
        )}
      </div>
      <p className={hint}>
        {openCount} of {DRAFTS_OPEN_MAX} open drafts. A draft holds no stock and takes no order number until it is sent; a sent draft holds its stock until its link ends.
      </p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-8 text-sm">
          <p>{status ? `No ${DRAFT_STATUS_LABELS[status].toLowerCase()} drafts.` : "No draft orders yet. A draft is an order you make for a customer, who pays it through a link."}</p>
          {status ? (
            <Link href={base} className={secondary}>
              Show all drafts
            </Link>
          ) : (
            canWrite && (
              <Link href={`${base}/new`} className={primary}>
                Make the first draft
              </Link>
            )
          )}
        </div>
      ) : (
        <div className={tableShell}>
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  Draft
                </th>
                <th scope="col" className={th}>
                  Customer
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  Made
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const note = statusNote(row, when);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className={td}>
                      <Link href={`${base}/${row.id}`} className="font-medium underline-offset-2 hover:underline">
                        {row.number}
                      </Link>
                      <span className="block text-xs text-muted">
                        {row.lineCount} {row.lineCount === 1 ? "line" : "lines"}
                      </span>
                    </td>
                    <td className={td}>{row.customer ?? row.email ?? <span className="text-muted">No customer yet</span>}</td>
                    <td className={td}>
                      {DRAFT_STATUS_LABELS[row.status]}
                      {note && <span className="block text-xs text-muted">{note}</span>}
                      {row.orderId && row.orderNumber && (row.status === "sent" || row.status === "paid") && (
                        <Link href={`/admin/${slug}/orders/${row.orderId}`} className="block text-xs underline underline-offset-2">
                          Order #{row.orderNumber}
                        </Link>
                      )}
                    </td>
                    <td className={`${td} hidden sm:table-cell`}>
                      <time dateTime={row.createdAt}>{when(row.createdAt)}</time>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{row.totalMinor === null ? <span className="text-muted">–</span> : formatMoney(row.totalMinor, row.currency, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(hasCursor || nextCursor) && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-4 text-sm">
          {hasCursor && (
            <Link href={href({ after: null })} className="underline underline-offset-2">
              Back to the first page
            </Link>
          )}
          {nextCursor && (
            <Link href={href({ after: nextCursor })} className="underline underline-offset-2">
              Next 50 drafts
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
