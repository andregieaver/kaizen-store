import Link from "next/link";

import { CHIP_ITEM, CHIP_STRIP } from "@/lib/chip-strip";
import { formatMoney } from "@/lib/money";
import { countWords, fillWords } from "@/lib/admin-fill";
import { kitEn } from "@/lib/admin-messages/kit.en";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
import { countsSentence, dayText, exchangeFilters, kindFilters, queueHref, queueQuery, statusFilters, type ExchangeMark } from "@/lib/return-admin";
import type { ReturnQueueFilter } from "@/lib/return-input";
import type { Queue, ReturnCounts } from "@/server/returns";
import { ButtonLink, Card, CARD_CLASS, Chip, EmptyState, List, ListRow, ListSearch, PageHeader, Pager, RowAmount, RowLead, Select, TextInput } from "@/components/admin/ui";
import type { PagerWords } from "@/components/admin/ui/pager";

import { DueMark, KindBadge, StatusBadge } from "./ui";

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
  pagerWords = kitEn.pager,
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
  /** The kit's pager words (`KIT_WORDS[lang].pager`, D834). */
  pagerWords?: PagerWords;
}) {
  const q = w.queue;
  const filtered = filter.status !== "open" || filter.kind !== "all" || filter.q !== "" || filter.overdue || exchange !== null;
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
        // The kit's search (code review 1.13, D834): the queue's other filters ride along as hidden values.
        <ListSearch
          action={base}
          value={filter.q}
          label={q.search}
          placeholder={q.searchPlaceholder}
          maxLength={100}
          words={{ label: q.search, button: q.search }}
          button="hidden"
          keep={queueQuery({ ...filter, q: "", exchange })}
          aside={
            filtered && (
              <Link href={base} className="flex min-h-10 shrink-0 items-center text-sm underline">
                {q.clear}
              </Link>
            )
          }
        />
      )}

      {showFilters && (
        <details open={filter.kind !== "all" || exchange !== null || !["open", "requested", "all"].includes(filter.status)} className={`px-6 py-3 ${CARD_CLASS}`}>
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-ink">{q.moreFilters}</summary>
        <form method="get" action={base} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {q.status}
            <Select name="status" defaultValue={filter.status}>
              {statusFilters(w).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {q.kind}
            <Select name="kind" defaultValue={filter.kind}>
              {kindFilters(w).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {q.exchange}
            <Select name="exchange" defaultValue={exchange ?? ""}>
              {exchangeFilters(w).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
            {q.search}
            <TextInput name="q" type="search" defaultValue={filter.q} placeholder={q.searchPlaceholder} maxLength={100} full />
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
          // The way back is beside the search box (Clear).
          <EmptyState title={q.noMatch} />
        ) : (
          <EmptyState
            title={q.nothingWaits}
            action={
              <ButtonLink kind="secondary" href={orders}>
                {q.findOrder}
              </ButtonLink>
            }
          >
            <p>{q.empty}</p>
            <p className="mt-1">{q.byHand}</p>
          </EmptyState>
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

      <Pager
        words={pagerWords}
        label={q.pages}
        base={base}
        query={queueQuery({ ...filter, exchange })}
        page={queue.page}
        size={queue.pageSize}
        shown={queue.rows.length}
        total={queue.total}
      />
      <details className={`px-6 py-3 ${CARD_CLASS}`}>
        <summary className="flex min-h-10 cursor-pointer items-center text-body text-ink">{q.rules}</summary>
        <p className="mt-2 text-sm text-ink-2">{q.description}</p>
        <p className="mt-2 text-sm text-ink-2">{q.outside}</p>
      </details>
    </div>
  );
}
