import Link from "next/link";

import { CHIP_ITEM, CHIP_STRIP } from "@/lib/chip-strip";
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
  const plain = filter.kind === "all" && exchange === null && filter.q === "";
  const chips: { label: string; n: number | null; href: string; on: boolean }[] = [
    { label: q.open, n: counts.open, href: base, on: plain && filter.status === "open" && !filter.overdue },
    { label: q.toApprove, n: counts.requested, href: queueHref(base, { status: "requested" }), on: plain && filter.status === "requested" && !filter.overdue },
    { label: q.pastDeadline, n: counts.overdue, href: queueHref(base, { overdue: true }), on: plain && filter.overdue },
    { label: q.all, n: null, href: queueHref(base, { status: "all" }), on: plain && filter.status === "all" && !filter.overdue },
  ];
  const showFilters = filtered || counts.open > 0 || queue.total > 0;
  return (
    <div className="flex flex-col gap-6">
      {/* Round 12 (D637): what waits, in the header's sentence; the rules one fold away; zeros and filters only when there is something. */}
      <PageHeader title={q.title} meta={[<span key="lead" role="status" className="text-ink">{countsSentence(counts, w)}</span>]} />

      {/* Round 18 (D657): chips with their counts, the search on one line, every other filter one fold away. */}
      {showFilters && (
        <nav aria-label={q.filterLabel} className={CHIP_STRIP}>
          {chips.map((c) => (
            <Link key={c.label} href={c.href} aria-current={c.on ? "page" : undefined} className={`${CHIP_ITEM} inline-flex min-h-9 items-center rounded-pill px-4 text-sm ${c.on ? "bg-inverse text-inverse-ink" : "border border-edge bg-card text-ink hover:bg-sunken"}`}>
              {c.n === null ? c.label : fillWords(q.chip, { label: c.label, n: c.n })}
            </Link>
          ))}
          {counts.acknowledgementPending > 0 && (
            <span className={`${CHIP_ITEM} inline-flex min-h-9 items-center rounded-pill bg-danger-soft px-4 text-sm text-danger-text`}>
              {fillWords(q.chip, { label: q.notSent, n: counts.acknowledgementPending })}
            </span>
          )}
        </nav>
      )}

      {showFilters && (
        <form method="get" action={base} role="search" className="flex items-center gap-2">
          {filter.status !== "open" && <input type="hidden" name="status" value={filter.status} />}
          {filter.kind !== "all" && <input type="hidden" name="kind" value={filter.kind} />}
          {exchange && <input type="hidden" name="exchange" value={exchange} />}
          {filter.overdue && <input type="hidden" name="overdue" value="1" />}
          <label className="flex min-w-0 flex-1">
            <span className="sr-only">{q.search}</span>
            <input name="q" type="search" defaultValue={filter.q} placeholder={q.searchPlaceholder} maxLength={100} className="min-h-11 w-full rounded-pill border border-edge bg-card px-4 text-sm" />
          </label>
          {filtered && (
            <Link href={base} className="flex min-h-10 shrink-0 items-center text-sm underline">
              {q.clear}
            </Link>
          )}
        </form>
      )}

      {showFilters && (
        <details open={filter.kind !== "all" || exchange !== null || !["open", "requested", "all"].includes(filter.status)} className={`px-6 py-3 ${CARD_CLASS}`}>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-ink">{q.moreFilters}</summary>
        <form method="get" action={base} className="mt-3 flex flex-wrap items-end gap-3">
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
        </form>
        </details>
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
