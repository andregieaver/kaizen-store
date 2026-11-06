/**
 * A customer's timeline (S1 of `docs/own-books-and-sales.md`, D462): what happened with a person, or with a company's people, newest
 * first, read from what the store already keeps. Nothing is stored for it. Pure: the kinds and their events, which kinds a viewer may
 * see, the merge of the sources' events, the filter a page asks for, the days they fall on, and the short excerpt of words someone typed.
 */

/** The kinds, in the order the filter offers them. */
export const TIMELINE_KINDS = ["order", "quote", "conversation", "email", "note", "return", "review", "booking", "work_invoice"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const isTimelineKind = (value: unknown): value is TimelineKind =>
  typeof value === "string" && (TIMELINE_KINDS as readonly string[]).includes(value);

/** What happened, each of one kind. */
export const TIMELINE_KIND_OF = {
  order_placed: "order",
  quote_requested: "quote",
  quote_sent: "quote",
  quote_declined: "quote",
  conversation_started: "conversation",
  email_sent: "email",
  email_failed: "email",
  note_added: "note",
  return_opened: "return",
  withdrawal_requested: "return",
  review_written: "review",
  booking_made: "booking",
  work_invoice_issued: "work_invoice",
  work_invoice_paid: "work_invoice",
} as const satisfies Record<string, TimelineKind>;

export type TimelineWhat = keyof typeof TIMELINE_KIND_OF;

/** An email's statuses that mean it did not reach the person (`commerce.email_status`). */
export const EMAIL_NOT_DELIVERED: readonly string[] = ["failed", "bounced", "complained"];

/**
 * One thing that happened. Everything but `what` is data read from the store, never words: the page puts the words around it in the
 * viewer's language, and anything a person typed (`excerpt`) is shown as text.
 */
export type TimelineEvent = {
  /** Unique within a timeline: what happened and to which row. */
  key: string;
  what: TimelineWhat;
  /** When, as an ISO timestamp. */
  at: string;
  /** The person it concerns, lower case; null for what belongs to a company as a whole (a Work invoice to it). */
  email: string | null;
  /** The thing's own name: an order's or document's number, an email's subject, a product's title. */
  label: string;
  /** A short excerpt of what someone typed: a note, a quote request's message. */
  excerpt?: string | null;
  amount?: { minor: number; currency: string } | null;
  /** An order's status, a conversation's source, a booking's or review's state, as the source keeps it. */
  status?: string | null;
  /** A review's stars, 1 to 5. */
  rating?: number | null;
  /** When a booking starts. */
  startsAt?: string | null;
  /** Who wrote a note. */
  author?: string | null;
  /** The thing's own page, when the viewer may open it. */
  href: string | null;
};

export const kindOf = (event: Pick<TimelineEvent, "what">): TimelineKind => TIMELINE_KIND_OF[event.what];

/** A timeline as read for one viewer: the events, whether there are more, the kinds the viewer may see and the one shown (null for all). */
export type TimelineRead = { events: TimelineEvent[]; more: boolean; visible: TimelineKind[]; shown: TimelineKind | null };

/**
 * What the viewer holds and what the store has on. The timeline lives on the customer page (`customers:read`), which already lists a
 * person's orders and emails and holds staff's notes; everything else is shown only to someone who may open its own page.
 */
export type TimelineGates = {
  /** `orders:read`: quote requests, returns and withdrawals. */
  orders: boolean;
  /** `support:read`: conversations. */
  support: boolean;
  /** `products:read`, with the reviews feature on: reviews. */
  products: boolean;
  reviewsOn: boolean;
  /** `bookings:read`, with appointments or bookings on: bookings. */
  bookings: boolean;
  bookingsOn: boolean;
  /** `settings:read`, with Work on (D123): Work invoices. */
  settings: boolean;
  workOn: boolean;
};

/** The kinds this viewer may see on this store, in the filter's order. */
export function visibleKinds(gates: TimelineGates): TimelineKind[] {
  const shown: Record<TimelineKind, boolean> = {
    order: true,
    email: true,
    note: true,
    quote: gates.orders,
    return: gates.orders,
    conversation: gates.support,
    review: gates.products && gates.reviewsOn,
    booking: gates.bookings && gates.bookingsOn,
    work_invoice: gates.settings && gates.workOn,
  };
  return TIMELINE_KINDS.filter((kind) => shown[kind]);
}

/** The kind a page's `?show=` asks for, if the viewer may see it; anything else shows every kind. */
export function askedKind(param: string | string[] | undefined, visible: readonly TimelineKind[]): TimelineKind | null {
  const value = Array.isArray(param) ? param[0] : param;
  return isTimelineKind(value) && visible.includes(value) ? value : null;
}

/** How many events a page shows at first (Homer's), and with *Show everything* (Lisa's). */
export const TIMELINE_SHORT = 12;
export const TIMELINE_FULL = 200;

/** Newest first; at the same moment, by key, so the order never changes between two reads. */
export const newestFirst = (a: TimelineEvent, b: TimelineEvent): number =>
  a.at === b.at ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.at < b.at ? 1 : -1;

/**
 * The sources' events as one timeline: only the kinds asked for, each event once, newest first, at most `limit`; `more` says some were
 * left out. Each source reads one more row than the limit, so a source that had more shows here as more.
 */
export function mergeTimeline(
  sources: readonly (readonly TimelineEvent[])[],
  { kinds, limit }: { kinds: readonly TimelineKind[]; limit: number },
): { events: TimelineEvent[]; more: boolean } {
  const wanted = new Set(kinds);
  const seen = new Set<string>();
  const all: TimelineEvent[] = [];
  for (const source of sources) {
    for (const event of source) {
      if (!wanted.has(kindOf(event)) || seen.has(event.key) || Number.isNaN(Date.parse(event.at))) continue;
      seen.add(event.key);
      all.push(event);
    }
  }
  all.sort(newestFirst);
  const cap = Math.max(0, Math.floor(limit));
  return { events: all.slice(0, cap), more: all.length > cap };
}

/** The kinds that have an event, in the filter's order: the filter is offered once there are two. */
export function kindsPresent(events: readonly TimelineEvent[]): TimelineKind[] {
  const present = new Set(events.map(kindOf));
  return TIMELINE_KINDS.filter((kind) => present.has(kind));
}

/** The calendar day an instant falls on in a time zone, as `YYYY-MM-DD`. */
export function dayOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Events under the day they fall on in the store's time zone, newest day first, keeping the events' order. */
export function byDay(events: readonly TimelineEvent[], timeZone: string): { day: string; events: TimelineEvent[] }[] {
  const days: { day: string; events: TimelineEvent[] }[] = [];
  for (const event of events) {
    const day = dayOf(event.at, timeZone);
    const last = days[days.length - 1];
    if (last && last.day === day) last.events.push(event);
    else days.push({ day, events: [event] });
  }
  return days;
}

/** How long an excerpt may be, in characters as a person counts them. */
export const EXCERPT_MAX = 140;

/** What someone typed, on one line and cut to `max` characters with an ellipsis; null when there is nothing. */
export function excerptOf(text: string | null | undefined, max: number = EXCERPT_MAX): string | null {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  if (line === "") return null;
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  return `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
}
