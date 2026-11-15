import Link from "next/link";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { countWords, fillWords } from "@/lib/admin-fill";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { countsSentence, dayText, exchangeFilters, kindFilters, queueHref, statusFilters, type ExchangeMark } from "@/lib/return-admin";
import type { ReturnQueueFilter } from "@/lib/return-input";
import type { Queue, ReturnCounts } from "@/server/returns";
import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowAmount, RowLead } from "@/components/admin/ui";

import { DueMark, KindBadge, StatusBadge } from "./ui";

const control = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

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
  exchange = null,
  words: w = returnsEn,
}: {
  /** `/admin/{store}/returns` */
  base: string;
  filter: ReturnQueueFilter;
  /** The exchange mark filter (D239, `exchange=`): wished, proposed, confirmed, payment to collect. */
  exchange?: ExchangeMark | null;
  queue: Queue;
  counts: ReturnCounts;
  timeZone: string;
  locale?: string;
  words?: ReturnsMessages;
}) {
  const q = w.queue;
  const filtered = filter.status !== "open" || filter.kind !== "all" || filter.q !== "" || filter.overdue || exchange !== null;
  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));
  const orders = base.replace(/\/returns$/, "/orders");
  const stats = [
    { label: q.open, value: counts.open, href: base },
    { label: q.toApprove, value: counts.requested, href: queueHref(base, { status: "requested" }) },
    { label: q.pastDeadline, value: counts.overdue, sub: q.lawGives, href: queueHref(base, { overdue: true }) },
    { label: q.notSent, value: counts.acknowledgementPending, sub: q.sendAgainHint },
  ].filter((stat) => stat.value > 0);
  const showFilters = filtered || counts.open > 0 || queue.total > 0;
  return (
    <div className="flex flex-col gap-6">
      {/* Round 12 (D637): what waits, in the header's sentence; the rules one fold away; zeros and filters only when there is something. */}
      <PageHeader title={q.title} meta={[<span key="lead" role="status" className="text-ink">{countsSentence(counts, w)}</span>]} />

      {stats.length > 0 && (
        <StatGrid>
          {stats.map((stat) => (
            <Stat key={stat.label} {...stat} />
          ))}
        </StatGrid>
      )}

      {showFilters && (
        <form method="get" action={base} className="flex flex-wrap items-end gap-3" aria-label={q.filterLabel}>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {q.status}
            <select name="status" defaultValue={filter.status} className={control}>
              {statusFilters(w).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {q.kind}
            <select name="kind" defaultValue={filter.kind} className={control}>
              {kindFilters(w).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {q.exchange}
            <select name="exchange" defaultValue={exchange ?? ""} className={control}>
              {exchangeFilters(w).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
            {q.search}
            <input name="q" type="search" defaultValue={filter.q} placeholder={q.searchPlaceholder} maxLength={100} className={`${control} w-full`} />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="overdue" value="1" defaultChecked={filter.overdue} className="size-4" />
            {q.pastDeadline}
          </label>
          <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
            {q.filter}
          </button>
          {filtered && (
            <Link href={base} className="flex min-h-10 items-center text-sm underline">
              {q.clear}
            </Link>
          )}
        </form>
      )}

      {queue.rows.length === 0 ? (
        filtered ? (
          <p className={`p-8 text-center text-sm ${CARD_CLASS}`}>{q.noMatch}</p>
        ) : (
          <section aria-label={q.list} className={`flex flex-col items-start gap-3 px-6 py-8 ${CARD_CLASS}`}>
            <p className="text-body text-ink">{q.nothingWaits}</p>
            <p className="text-sm text-ink-2">{q.empty}</p>
            <p className="text-sm text-ink-2">{q.byHand}</p>
            <ButtonLink kind="secondary" href={orders}>
              {q.findOrder}
            </ButtonLink>
          </section>
        )
      ) : (
        <Card compact>
          <List label={q.list}>
            {queue.rows.map((row) => (
              <ListRow key={row.id}>
                <RowLead
                  title={row.number}
                  href={`${base}/${row.id}`}
                  sub={
                    <>
                      {row.name || row.email || "–"} ·{" "}
                      <Link href={`${orders}/${row.orderId}`} className="underline-offset-2 hover:underline">
                        {fillWords(q.order, { number: row.orderNumber })}
                      </Link>
                      {" · "}
                      {countWords(row.units, q.units)} · {q.made} <time dateTime={row.createdAt}>{dayText(row.createdAt, timeZone, locale)}</time>
                      {row.acknowledgementPending && <span className="block text-danger-text">{q.notSent}</span>}
                      {row.labelFailed && <span className="block text-warning-text">{q.labelNotBooked}</span>}
                    </>
                  }
                />
                {row.exchange && <Chip signal={row.exchange === "waiting_payment" ? "warning" : row.exchange === "confirmed" ? "positive" : "insight"}>{w.labels.exchangeMarks[row.exchange]}</Chip>}
                <KindBadge kind={row.kind} words={w} />
                <StatusBadge status={row.status} words={w} />
                <RowAmount>
                  {row.refundMinor !== null ? (
                    formatMoney(row.refundMinor, row.currency, locale)
                  ) : (
                    <>
                      <DueMark due={row.due} timeZone={timeZone} words={w} locale={locale} />
                      {row.status === "requested" && <span className="block text-body text-muted">{q.waitingAnswer}</span>}
                    </>
                  )}
                </RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      {pages > 1 && (
        <nav aria-label={q.pages} className="flex items-center gap-3 text-sm">
          {queue.page > 1 ? (
            <Link href={queueHref(base, { ...filter, exchange, page: queue.page - 1 })} className="underline">
              {q.previous}
            </Link>
          ) : (
            <span className="text-muted">{q.previous}</span>
          )}
          <span className="text-muted">
            {fillWords(q.pageOf, { page: queue.page, pages, total: queue.total })}
          </span>
          {queue.page < pages ? (
            <Link href={queueHref(base, { ...filter, exchange, page: queue.page + 1 })} className="underline">
              {q.next}
            </Link>
          ) : (
            <span className="text-muted">{q.next}</span>
          )}
        </nav>
      )}
      <details className={`px-6 py-3 ${CARD_CLASS}`}>
        <summary className="flex min-h-10 cursor-pointer items-center text-body text-ink">{q.rules}</summary>
        <p className="mt-2 text-sm text-ink-2">{q.description}</p>
        <p className="mt-2 text-sm text-ink-2">{q.outside}</p>
      </details>
    </div>
  );
}
