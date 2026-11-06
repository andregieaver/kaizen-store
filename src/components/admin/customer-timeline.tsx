import Link from "next/link";
import type { ReactNode } from "react";

import { Chip, List, ListRow, RowAmount, RowDate, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { CustomersMessages } from "@/lib/admin-messages/customers.en";
import { byDay, kindOf, kindsPresent, type TimelineEvent, type TimelineKind, type TimelineRead } from "@/lib/customer-timeline";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_SIGNAL } from "@/lib/order-status";

type Words = CustomersMessages["timeline"];
type OrderStatus = keyof typeof ORDER_STATUS_SIGNAL;

/**
 * A person's or a company's timeline (D462), drawn on the server: newest first under the days they fell on in the store's time zone. For
 * Homer the latest few and one link to the rest; the filter by kind appears once there are two kinds to tell apart, as plain links, so
 * nothing on the page needs JavaScript. What someone typed (a note, a quote request's message) is shown as text.
 */
export function CustomerTimeline({
  read,
  full,
  path,
  words,
  orderStatuses,
  locale,
  timeZone,
  people,
  company = false,
}: {
  read: TimelineRead;
  /** Whether everything is shown (`?full=1`). */
  full: boolean;
  /** The page's own address, which the filter's and *Show everything*'s links add to. */
  path: string;
  words: Words;
  orderStatuses: Record<OrderStatus, string>;
  locale: string;
  timeZone: string;
  /** On a company's timeline: each of its people by address, with their page. */
  people?: Readonly<Record<string, { name: string; href: string }>>;
  company?: boolean;
}) {
  const link = (show: TimelineKind | null, everything: boolean) => {
    const query = new URLSearchParams();
    if (show) query.set("show", show);
    if (everything) query.set("full", "1");
    const qs = query.toString();
    return `${path}${qs ? `?${qs}` : ""}#timeline`;
  };
  const kinds = read.shown ? [read.shown] : kindsPresent(read.events);
  const filtered = read.shown !== null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  // A day is `YYYY-MM-DD` in the store's zone already: drawn at noon UTC in UTC, it is that day in any locale.
  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <section aria-labelledby="timeline" className="rounded-lg border border-line bg-card p-5">
      <h2 id="timeline" className="mb-3 text-title text-ink">
        {words.title}
      </h2>

      {(filtered || kinds.length >= 2) && (
        <nav aria-label={words.filter} className="mb-3 flex flex-wrap gap-2">
          {[null, ...kinds].map((kind) => {
            const current = read.shown === kind;
            return (
              <Link
                key={kind ?? "all"}
                href={link(kind, false)}
                aria-current={current ? "true" : undefined}
                className={`rounded-pill border px-3 py-1 text-caption ${current ? "border-edge bg-sunken text-ink" : "border-line text-ink-2"}`}
              >
                {kind ? words.kinds[kind] : words.all}
              </Link>
            );
          })}
        </nav>
      )}

      {read.events.length === 0 ? (
        <p className="text-sm text-muted">{filtered ? words.emptyKind : company ? words.emptyCompany : words.empty}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {byDay(read.events, timeZone).map(({ day, events }) => (
            <div key={day}>
              <h3 className="text-caption text-muted">{dayLabel(day)}</h3>
              <List>
                {events.map((event) => (
                  <ListRow key={event.key}>
                    {/* The time first, so it keeps its place when a narrow column wraps the chip and the amount under the title. */}
                    <RowDate>{time(event.at)}</RowDate>
                    <RowLead
                      title={fillWords(words.events[event.what], { label: event.label })}
                      href={event.href ?? undefined}
                      sub={subLine(event, words, when, people)}
                    />
                    {chipOf(event, words, orderStatuses)}
                    {event.amount && <RowAmount>{formatMoney(event.amount.minor, event.amount.currency, locale)}</RowAmount>}
                  </ListRow>
                ))}
              </List>
            </div>
          ))}
        </div>
      )}

      {(read.more || full) && (
        <p className="mt-3 text-sm">
          <Link href={link(read.shown, !full)} className="underline">
            {full ? words.showFewer : words.showAll}
          </Link>
        </p>
      )}
    </section>
  );
}

/** The line under an event: whose it is on a company's timeline, then what the event itself carries. */
function subLine(
  event: TimelineEvent,
  words: Words,
  when: (iso: string) => string,
  people: Readonly<Record<string, { name: string; href: string }>> | undefined,
): ReactNode {
  const parts: ReactNode[] = [];
  const person = people && event.email ? people[event.email] : undefined;
  if (person) {
    parts.push(
      <Link key="person" href={person.href} className="underline">
        {person.name}
      </Link>,
    );
  }
  const kind = kindOf(event);
  if (kind === "quote" && event.what === "quote_requested" && event.label) parts.push(event.label);
  if ((kind === "email" || kind === "conversation") && event.label) parts.push(event.label);
  if (event.what === "conversation_started" && event.status && event.status in words.sources) {
    parts.push(words.sources[event.status as keyof Words["sources"]]);
  }
  if (event.excerpt) parts.push(`“${event.excerpt}”`);
  if (event.author) parts.push(fillWords(words.noteBy, { author: event.author }));
  if (event.rating) parts.push(fillWords(words.stars, { rating: event.rating }));
  if (event.startsAt) parts.push(fillWords(words.startsAt, { date: when(event.startsAt) }));
  if (parts.length === 0) return undefined;
  return parts.flatMap((part, i) => (i === 0 ? [part] : [" · ", part]));
}

/** A chip only where the event's state needs one: an order's status, an email that did not arrive, a cancelled booking, a void invoice. */
function chipOf(event: TimelineEvent, words: Words, orderStatuses: Record<OrderStatus, string>): ReactNode {
  if (event.what === "order_placed" && event.status && event.status in ORDER_STATUS_SIGNAL) {
    const status = event.status as OrderStatus;
    return (
      <Chip signal={ORDER_STATUS_SIGNAL[status]} dot>
        {orderStatuses[status]}
      </Chip>
    );
  }
  if (event.what === "email_failed") return <Chip signal="warning" dot>{words.notDelivered}</Chip>;
  if (event.what === "booking_made" && event.status === "cancelled") return <Chip dot>{words.cancelled}</Chip>;
  if (kindOf(event) === "work_invoice" && event.status === "void") return <Chip dot>{words.void}</Chip>;
  return null;
}
