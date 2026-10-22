import Link from "next/link";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { DRAFTS_OPEN_MAX } from "@/lib/order-limits";
import { DRAFT_STATUSES, type DraftStatus } from "@/lib/draft-status";
import { draftsEn, type DraftsMessages } from "@/lib/admin-messages/drafts.en";
import { countWords, fillWords } from "@/lib/drafts-words";
import { formatMoney } from "@/lib/money";
import type { DraftListRow } from "@/server/draft-orders";
import { Card, Chip, List, ListRow, RowAmount, RowDate, RowLead } from "@/components/admin/ui";


const DRAFT_SIGNAL = { open: "insight", sent: "warning", paid: "positive", expired: "neutral", cancelled: "neutral" } as const;

/** What the drafts list says under a draft's status, in words. */
function statusNote(row: DraftListRow, when: (iso: string) => string, w: DraftsMessages["list"]): string | null {
  if (row.status === "sent" && row.expiresAt) return fillWords(w.linkUntil, { when: when(row.expiresAt) });
  if (row.status === "expired") return w.ranOut;
  if (row.status === "cancelled") return w.cancelled;
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
  words = draftsEn,
  dateLocale = locale,
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
  /** The `drafts` catalogue in the account's language (English unless given). */
  words?: DraftsMessages;
  /** The locale dates are written in (the market's unless given). */
  dateLocale?: string;
}) {
  const w = words.list;
  const labels = words.status;
  const base = `/admin/${slug}/orders/drafts`;
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone });
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
        <nav aria-label={w.statusNav} className="flex flex-wrap gap-1 border-b border-line pb-2 text-sm">
          <Link href={href({ status: null })} aria-current={status === null ? "page" : undefined} className="rounded-pill px-3 py-1.5 text-muted hover:text-ink aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:text-ink">
            {w.all}
          </Link>
          {DRAFT_STATUSES.map((s) => (
            <Link key={s} href={href({ status: s })} aria-current={status === s ? "page" : undefined} className="rounded-pill px-3 py-1.5 text-muted hover:text-ink aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:text-ink">
              {labels[s]}
            </Link>
          ))}
        </nav>
        {canWrite && (
          <Link href={`${base}/new`} className={primary}>
            {w.newDraft}
          </Link>
        )}
      </div>
      <p className={hint}>{fillWords(w.openCount, { count: openCount, max: DRAFTS_OPEN_MAX })}</p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel bg-sunken p-8 text-sm">
          <p>{status ? fillWords(w.noneOfStatus, { status: labels[status].toLowerCase() }) : w.none}</p>
          {status ? (
            <Link href={base} className={secondary}>
              {w.showAll}
            </Link>
          ) : (
            canWrite && (
              <Link href={`${base}/new`} className={primary}>
                {w.first}
              </Link>
            )
          )}
        </div>
      ) : (
        <Card compact>
          <List label={w.listLabel}>
            {rows.map((row) => {
              const note = statusNote(row, when, w);
              return (
                <ListRow key={row.id}>
                  <RowLead
                    title={row.number}
                    href={`${base}/${row.id}`}
                    sub={
                      <>
                        {row.customer ?? row.email ?? w.noCustomer} · {countWords(row.lineCount, w.lines)}
                        {note && ` · ${note}`}
                        {row.orderId && row.orderNumber && (row.status === "sent" || row.status === "paid") && (
                          <>
                            {" · "}
                            <Link href={`/admin/${slug}/orders/${row.orderId}`} className="underline underline-offset-2">
                              {fillWords(w.order, { number: row.orderNumber })}
                            </Link>
                          </>
                        )}
                      </>
                    }
                  />
                  <RowDate>
                    <time dateTime={row.createdAt}>{when(row.createdAt)}</time>
                  </RowDate>
                  <Chip signal={DRAFT_SIGNAL[row.status]} dot>
                    {labels[row.status]}
                  </Chip>
                  <RowAmount>{row.totalMinor === null ? <span className="text-muted">–</span> : formatMoney(row.totalMinor, row.currency, locale)}</RowAmount>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}

      {(hasCursor || nextCursor) && (
        <nav aria-label={w.pages} className="flex flex-wrap items-center gap-4 text-sm">
          {hasCursor && (
            <Link href={href({ after: null })} className="underline underline-offset-2">
              {w.firstPage}
            </Link>
          )}
          {nextCursor && (
            <Link href={href({ after: nextCursor })} className="underline underline-offset-2">
              {w.nextPage}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
