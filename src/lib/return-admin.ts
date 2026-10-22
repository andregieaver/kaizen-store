import { formatMoney } from "./money";
import type { Refund, WorkingRow } from "./return-refund";
import type { ReturnAction, ReturnKind, ReturnOutcome, ReturnStatus } from "./return-status";
import type { ReturnCondition, ReturnQueueFilter } from "./return-input";
import type { RefundDue, ReturnReason } from "./withdrawal";
import { countWords, fillWords } from "./admin-fill";
import { returnsEn, type ReturnsMessages } from "./admin-messages/returns.en";

/**
 * The words of the returns screens in the admin (D153, `docs/returns.md`): labels, the "refund due" and "overdue" marks,
 * the timeline's sentences and the queue's addresses. Pure; the words are the `returns` catalogue (D312 A4), English
 * unless another language's is passed. The shopper's texts are in `i18n.ts` and `email-text.ts`.
 */

/** The English words; another language's are its catalogue (`returnsNb`), passed where a function takes `w`. */
const EN = returnsEn;

export const STATUS_LABELS: Record<ReturnStatus, string> = EN.labels.status;

/** What each status means for the person who works the return, a line under the status. */
export const STATUS_HINTS: Record<ReturnStatus, string> = EN.labels.statusHints;

export const KIND_LABELS: Record<ReturnKind, string> = EN.labels.kind;

export const KIND_HINTS: Record<ReturnKind, string> = EN.labels.kindHints;

export const OUTCOME_LABELS: Record<ReturnOutcome, string> = EN.labels.outcome;

export const REASON_LABELS: Record<ReturnReason, string> = EN.labels.reason;

export const CONDITION_LABELS: Record<ReturnCondition, string> = EN.labels.condition;

export const ACTION_LABELS: Record<ReturnAction, string> = EN.labels.action;

/** The reason a line the law excludes gives, as words (`order_lines.withdrawal_exclusion`). */
export const EXCLUSION_LABELS: Record<string, string> = EN.labels.exclusion;

/** Why a line was declined: a code the system wrote (`excluded_by_law`, the withdrawal function's) or the words of the person who declined it. */
export const DECLINE_REASON_LABELS: Record<string, string> = EN.labels.declineReason;

const lookup = (table: Record<string, string>, key: string): string | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

export const declineReasonText = (reason: string | null, w: ReturnsMessages = EN): string =>
  reason ? (lookup(w.labels.declineReason, reason) ?? reason) : w.labels.declined;

export const exclusionLabel = (value: string, w: ReturnsMessages = EN): string => lookup(w.labels.exclusion, value) ?? value.replaceAll("_", " ");

const STATUS_FILTER_ORDER = ["open", "requested", "approved", "in_transit", "received", "inspected", "closed", "declined", "cancelled", "all"] as const;

/** The queue's status choices in a language. */
export const statusFilters = (w: ReturnsMessages = EN): { value: ReturnQueueFilter["status"]; label: string }[] =>
  STATUS_FILTER_ORDER.map((value) => ({ value, label: w.labels.statusFilters[value] }));

export const STATUS_FILTERS = statusFilters();

/** The queue's kind choices in a language. */
export const kindFilters = (w: ReturnsMessages = EN): { value: ReturnQueueFilter["kind"]; label: string }[] =>
  (["all", "withdrawal", "return"] as const).map((value) => ({ value, label: w.labels.kindFilters[value] }));

export const KIND_FILTERS = kindFilters();

/** The queue's address for a filter: only what differs from the defaults is in it. */
export function queueHref(base: string, filter: Partial<ReturnQueueFilter> & { page?: number; /** The exchange mark filter (D239). */ exchange?: string | null } = {}): string {
  const query = new URLSearchParams();
  if (filter.status && filter.status !== "open") query.set("status", filter.status);
  if (filter.kind && filter.kind !== "all") query.set("kind", filter.kind);
  if (filter.q && filter.q.trim()) query.set("q", filter.q.trim());
  if (filter.overdue) query.set("overdue", "1");
  if (filter.exchange) query.set("exchange", filter.exchange);
  if (filter.page && filter.page > 1) query.set("page", String(filter.page));
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** The queue's filter from the address: anything unknown falls back to the default (`returnQueueFilter` does the same). */
export function pageNumber(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** A day in the store's own time zone, as people write it: "12 Oct 2026". */
export const dayText = (at: Date | string, timeZone: string, locale = "en-GB"): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(at));

/** A day and time in the store's zone: "12 Oct 2026, 14:05". */
export const timeText = (at: Date | string, timeZone: string, locale = "en-GB"): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(at));

/** Today in the store's time zone as `YYYY-MM-DD`: the latest day a step (goods sent, goods received) can be dated. */
export const todayIn = (timeZone: string, now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);

export type DueTone = "urgent" | "warn" | "calm";

/**
 * The refund's mark in the queue and on the detail page: what to do about the money and by when, or null when there is
 * nothing to say (a return that has ended without a refund, or one not yet approved). `urgent` is past the legal
 * deadline, `warn` is the last days, `calm` is the rest.
 */
export function dueMark(due: RefundDue, timeZone: string, w: ReturnsMessages = EN, locale = "en-GB"): { text: string; tone: DueTone } | null {
  const m = w.marks;
  const by = due.deadline ? dayText(due.deadline, timeZone, locale) : null;
  const left = due.daysToDeadline;
  const days = (n: number) => countWords(n, m.days);
  switch (due.state) {
    case "not_applicable":
      return null;
    case "done":
      return { text: m.refunded, tone: "calm" };
    case "overdue":
      return {
        text: fillWords(m.overdue, {
          by: left !== null && left < 0 ? fillWords(m.overdueBy, { days: days(-left) }) : "",
          was: by ? fillWords(m.wasDue, { day: by }) : "",
        }),
        tone: "urgent",
      };
    case "waiting_late":
      return { text: fillWords(m.waitingLate, { by: by ? fillWords(m.waitingLateBy, { day: by }) : "" }), tone: "urgent" };
    case "due":
      return {
        text: by
          ? left === 0
            ? m.dueToday
            : fillWords(m.dueBy, { day: by, left: left !== null && left > 0 ? fillWords(m.left, { days: days(left) }) : "" })
          : m.ready,
        tone: left !== null && left <= 2 ? "warn" : "calm",
      };
    case "waiting":
      return { text: fillWords(m.waiting, { by: by ? fillWords(m.waitingBy, { day: by }) : "" }), tone: left !== null && left <= 2 ? "warn" : "calm" };
  }
}

/** A mark's colours, in the admin's own tokens plus the two alert colours it already uses. */
export const TONE_CLASS: Record<DueTone, string> = {
  urgent: "text-danger-text",
  warn: "text-warning-text",
  calm: "text-muted",
};

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

/** One event of a return as a sentence. Money is written by `formatMoney` in the order's currency; unknown types are named, never hidden. */
export function eventSentence(type: string, data: Record<string, unknown>, currency: string, locale = "en-GB", w: ReturnsMessages = EN): string {
  const e = w.events;
  const money = (minor: number | null) => (minor === null ? e.anAmount : formatMoney(minor, currency, locale));
  const reasoned = (sentence: string, reason: unknown) => (text(reason) ? fillWords(e.withReason, { text: sentence, reason: text(reason) }) : sentence);
  switch (type) {
    case "return.requested":
      return e.requested;
    case "return.confirmed":
      return e.confirmed;
    case "return.approved":
      return data.automatic === true ? e.approvedAutomatic : e.approved;
    case "return.declined":
      return reasoned(data.scope === "line" ? e.lineDeclined : e.declined, data.reason);
    case "return.in_transit":
      return e.inTransit;
    case "return.received":
      return e.received;
    case "return.inspected":
      return e.inspected;
    case "return.refunded":
      if (typeof data.exchange === "string") {
        const back = whole(data.refundMinor) ?? 0;
        return fillWords(e.exchanged, { credit: money(whole(data.transferMinor)), back: back > 0 ? fillWords(e.exchangedBack, { amount: money(back) }) : "" });
      }
      return fillWords(e.refunded, { amount: money(whole(data.amountMinor)), outside: data.outside === true ? e.refundedOutside : "" });
    case "return.refund_overridden":
      return reasoned(fillWords(e.overridden, { from: money(whole(data.computedMinor)), to: money(whole(data.requestedMinor)) }), data.reason);
    case "return.closed":
      return data.outcome === "no_refund" ? e.closedNoRefund : e.closed;
    case "return.cancelled":
      return e.cancelled;
    // Exchanges and return labels (D239).
    case "return.exchange_wished":
      return e.exchangeWished;
    case "return.exchange_proposed":
      return fillWords(e.exchangeProposed, { credit: money(whole(data.creditMinor)), total: money(whole(data.totalMinor)) });
    case "return.exchange_confirmed":
      return data.confirmedBy === "staff"
        ? reasoned(
            fillWords(e.agreementRecorded, {
              channel: lookup(w.labels.channels, text(data.channel)) ?? w.labels.channels.other,
              day: text(data.day) ? fillWords(e.agreementDay, { day: text(data.day) }) : "",
            }),
            data.note,
          )
        : e.exchangeConfirmed;
    case "return.exchange_declined":
      return e.exchangeDeclined;
    case "return.exchange_cancelled":
      return data.replaced === true ? e.proposalReplaced : e.exchangeCancelled;
    case "return.exchange_expired":
      return e.exchangeExpired;
    case "return.exchange_processed":
      return fillWords(e.exchangeProcessed, { order: text(data.order) || e.orderMade });
    case "return.label_booked":
      return fillWords(e.labelBooked, { test: data.test === true ? e.labelTest : "" });
    case "return.label_failed":
      return e.labelFailed;
    case "return.label_given_up":
      return e.labelGivenUp;
    case "exchange.refund_failed":
      return e.exchangeRefundFailed;
    case "exchange.payment_refunded":
      return fillWords(e.latePaymentRefunded, { amount: money(whole(data.amount)) });
    default:
      return type;
  }
}

/** Whether an order event belongs to the returns timeline. */
export const isReturnEvent = (type: string): boolean => type.startsWith("return.") || type.startsWith("exchange.");

// ---------------------------------------------------------------------------
// The refund's working
// ---------------------------------------------------------------------------

export const WORKING_LABELS: Record<WorkingRow["key"], string> = EN.labels.working;

export const CAPPED_WORDS: Record<"zero" | "refundable", string> = EN.labels.capped;

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** A short sentence on what the numbers say, for the queue's header; empty when there is nothing to do. */
export function countsSentence(counts: { open: number; requested: number; overdue: number; acknowledgementPending: number }, w: ReturnsMessages = EN): string {
  const c = w.counts;
  const parts: string[] = [];
  if (counts.overdue > 0) parts.push(fillWords(c.overdue, { n: counts.overdue }));
  if (counts.acknowledgementPending > 0) parts.push(countWords(counts.acknowledgementPending, c.unacknowledged));
  if (counts.requested > 0) parts.push(fillWords(c.toApprove, { n: counts.requested }));
  if (parts.length === 0) return counts.open > 0 ? fillWords(c.openNoneWaiting, { n: counts.open }) : c.none;
  return `${parts.join(", ")}.`;
}

/** The refund as the screen holds it: plain data, so it crosses to the browser and back (`previewRefund()` makes it from `refundFor()`). */
export type RefundPreviewData = {
  amountMinor: number;
  working: WorkingRow[];
  cappedBy: Refund["cappedBy"];
  wholeOrder: boolean;
  /** What may be refunded at most. */
  refundableMinor: number;
  /** Refunded through Kaizen's Stripe; false records the refund as made outside. */
  canRefund: boolean;
  returnShippingMinor: number;
};

export function previewData(preview: { refund: Refund; refundableMinor: number; canRefund: boolean }): RefundPreviewData {
  const { refund } = preview;
  return {
    amountMinor: refund.amountMinor,
    working: refund.working,
    cappedBy: refund.cappedBy,
    wholeOrder: refund.wholeOrder,
    refundableMinor: preview.refundableMinor,
    canRefund: preview.canRefund,
    returnShippingMinor: refund.returnShippingMinor,
  };
}

// ---------------------------------------------------------------------------
// Exchanges and return labels (D239, docs/wave-3-exchanges.md 2.2, 2.3)
// ---------------------------------------------------------------------------

/** A return's outcome in words, `exchanged` (D239) included. */
export const outcomeLabel = (outcome: string, w: ReturnsMessages = EN): string => lookup(w.labels.outcome, outcome) ?? outcome.replaceAll("_", " ");

/** How a customer's agreement reached staff (`STAFF_EXCHANGE_CHANNELS`, and `web` for the customer's own press). */
export const CHANNEL_LABELS: Record<string, string> = EN.labels.channels;

/** The queue's exchange marks (`EXCHANGE_QUEUE_MARKS`). */
export const EXCHANGE_MARK_LABELS = EN.labels.exchangeMarks;
export type ExchangeMark = keyof typeof returnsEn.labels.exchangeMarks;

/** The queue's exchange choices in a language. */
export const exchangeFilters = (w: ReturnsMessages = EN): { value: ExchangeMark | ""; label: string }[] => [
  { value: "", label: w.labels.exchangeFilters.any },
  ...(["wished", "proposed", "confirmed", "waiting_payment"] as const).map((value) => ({ value, label: w.labels.exchangeFilters[value] })),
];

export const EXCHANGE_FILTERS = exchangeFilters();

/** The queue's `exchange=` value, or null for anything else. */
export function exchangeFilterOf(value: string | string[] | undefined): ExchangeMark | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && Object.hasOwn(EXCHANGE_MARK_LABELS, v) ? (v as ExchangeMark) : null;
}

/** The outcome of an exchange (`exchangeOutcome()`), in the order's currency, as staff read it. */
export function outcomeSentence(
  outcome: { kind: "refund_due" | "even" | "to_pay"; refundMinor: number; toPayMinor: number },
  currency: string,
  locale = "en-GB",
  w: ReturnsMessages = EN,
): string {
  if (outcome.kind === "refund_due") return fillWords(w.outcome.refundDue, { amount: formatMoney(outcome.refundMinor, currency, locale) });
  if (outcome.kind === "to_pay") return fillWords(w.outcome.toPay, { amount: formatMoney(outcome.toPayMinor, currency, locale) });
  return w.outcome.even;
}

/** Where an exchange stands, in one sentence for the return's page (D239 2.2). */
export function exchangeSentence(
  x: { status: string; outcome: { kind: "refund_due" | "even" | "to_pay"; refundMinor: number; toPayMinor: number }; expiresAt: string | null; exchangeOrderNumber: string | null; confirmedBy?: "customer" | "staff" | null },
  currency: string,
  timeZone: string,
  locale = "en-GB",
  w: ReturnsMessages = EN,
): string {
  const s = w.exchangeState;
  const until = x.expiresAt ? fillWords(s.until, { time: timeText(x.expiresAt, timeZone, locale) }) : "";
  const order = x.exchangeOrderNumber ?? "";
  switch (x.status) {
    case "draft":
      return s.draft;
    case "proposed":
      return fillWords(s.proposed, { until });
    case "confirmed":
      return x.confirmedBy === "staff" ? s.confirmedStaff : s.confirmedCustomer;
    case "processed":
      return x.outcome.kind === "to_pay"
        ? fillWords(s.processedToPay, { order, amount: formatMoney(x.outcome.toPayMinor, currency, locale), until })
        : fillWords(s.processedNotSettled, { order });
    case "settled":
      return fillWords(s.settled, { order });
    case "declined_by_customer":
      return s.declined;
    case "cancelled":
      return s.cancelled;
    case "expired":
      return s.expired;
    case "superseded":
      return s.superseded;
    default:
      return x.status;
  }
}

/** A return label in one sentence (D239 2.3): booked, pasted, or none; and who pays for it. */
export function labelSentence(
  label: { source: "pasted" | "carrier" | null; test: boolean; costMinor: number | null; tries: number },
  payer: "shopper" | "store" | null,
  currency: string,
  carrierName: string | null,
  locale = "en-GB",
  w: ReturnsMessages = EN,
): string {
  const l = w.labelState;
  if (label.source === "pasted") return l.pasted;
  if (label.source === "carrier") {
    const who =
      payer === "shopper"
        ? label.costMinor === null
          ? l.notPriced
          : fillWords(l.takenOff, { amount: formatMoney(label.costMinor, currency, locale) })
        : l.storePays;
    return fillWords(l.booked, { test: label.test ? l.testBooked : "", carrier: carrierName ?? l.theCarrier, who });
  }
  return label.tries > 0 ? l.failed : l.none;
}
