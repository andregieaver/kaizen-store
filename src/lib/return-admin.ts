import { formatMoney } from "./money";
import type { Refund, WorkingRow } from "./return-refund";
import type { ReturnAction, ReturnKind, ReturnOutcome, ReturnStatus } from "./return-status";
import type { ReturnCondition, ReturnQueueFilter } from "./return-input";
import type { RefundDue, ReturnReason } from "./withdrawal";

/**
 * The words of the returns screens in the admin (D153, `docs/returns.md`): labels, the "refund due" and "overdue" marks,
 * the timeline's sentences and the queue's addresses. Pure and English only (the admin is English only); the shopper's
 * texts are in `i18n.ts` and `email-text.ts`.
 */

export const STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  in_transit: "On its way back",
  received: "Received",
  inspected: "Inspected",
  closed: "Closed",
  declined: "Declined",
  cancelled: "Cancelled",
};

/** What each status means for the person who works the return, a line under the status. */
export const STATUS_HINTS: Record<ReturnStatus, string> = {
  requested: "The customer asks to return goods the law does not require you to take back. Approve or decline.",
  approved: "Waiting for the goods. Tell the customer where to send them.",
  in_transit: "The customer says the goods are on their way, or has shown proof of sending.",
  received: "The goods are back. Inspect them, then refund.",
  inspected: "The goods are checked. Refund, then close.",
  closed: "Done.",
  declined: "Not accepted. The customer was told why.",
  cancelled: "The return did not go ahead.",
};

export const KIND_LABELS: Record<ReturnKind, string> = { withdrawal: "Withdrawal", return: "Return request" };

export const KIND_HINTS: Record<ReturnKind, string> = {
  withdrawal: "The customer withdrew from the contract inside the legal period. You cannot refuse it.",
  return: "The customer asks to return goods inside your own longer window. You may approve or decline.",
};

export const OUTCOME_LABELS: Record<ReturnOutcome, string> = {
  refunded: "Refunded",
  declined: "Declined",
  no_refund: "Closed with no refund",
  cancelled: "Cancelled",
};

export const REASON_LABELS: Record<ReturnReason, string> = {
  changed_mind: "Changed their mind",
  too_big: "Too big",
  too_small: "Too small",
  defective: "Defective",
  not_as_described: "Not as described",
  damaged_in_transit: "Damaged in transit",
  wrong_item: "Wrong item",
  arrived_late: "Arrived late",
  other: "Other",
};

export const CONDITION_LABELS: Record<ReturnCondition, string> = {
  as_new: "As new",
  opened: "Opened, not used",
  used: "Used",
  damaged: "Damaged",
};

export const ACTION_LABELS: Record<ReturnAction, string> = {
  approve: "Approve",
  decline: "Decline",
  set_instructions: "Return instructions",
  mark_in_transit: "Mark in transit",
  mark_received: "Mark received",
  inspect: "Inspect the goods",
  refund: "Refund",
  close: "Close",
  cancel: "Cancel the return",
  send_acknowledgement: "Send the acknowledgement again",
};

/** The reason a line the law excludes gives, as words (`order_lines.withdrawal_exclusion`). */
export const EXCLUSION_LABELS: Record<string, string> = {
  none: "The right of withdrawal applies",
  custom_made: "Made to the customer's order or personalised",
  perishable: "Goes off or expires quickly",
  sealed_hygiene: "Sealed for health or hygiene, and unsealed",
  sealed_media: "Sealed audio, video or software, and unsealed",
  mixed_inseparably: "Mixed with other items after delivery",
  price_fluctuation: "Price depends on financial markets",
  alcohol_future_delivery: "Alcohol priced at sale, delivered after 30 days",
  periodicals: "A newspaper, periodical or magazine",
  digital_content: "Digital content delivered with the customer's consent",
  dated_service: "A service for a set date or period",
};

/** Why a line was declined: a code the system wrote (`excluded_by_law`, the withdrawal function's) or the words of the person who declined it. */
export const DECLINE_REASON_LABELS: Record<string, string> = {
  excluded_by_law: "The law excludes this line from the right of withdrawal",
  order_not_paid: "The order was not paid",
  copied_order: "The order is history copied from another store",
  already_returned: "Already returned",
  digital_content: "Digital content delivered with the customer's consent",
  booking: "A booking, which is cancelled from the booking itself",
  business_order: "Companies have no statutory right of withdrawal",
  period_over: "The period is over",
};

export const declineReasonText = (reason: string | null): string => (reason ? (DECLINE_REASON_LABELS[reason] ?? reason) : "Declined");

export const exclusionLabel = (value: string): string => EXCLUSION_LABELS[value] ?? value.replaceAll("_", " ");

export const STATUS_FILTERS: { value: ReturnQueueFilter["status"]; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "requested", label: "To approve" },
  { value: "approved", label: "Approved" },
  { value: "in_transit", label: "On their way" },
  { value: "received", label: "Received" },
  { value: "inspected", label: "Inspected" },
  { value: "closed", label: "Closed" },
  { value: "declined", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export const KIND_FILTERS: { value: ReturnQueueFilter["kind"]; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "withdrawal", label: "Withdrawals" },
  { value: "return", label: "Return requests" },
];

/** The queue's address for a filter: only what differs from the defaults is in it. */
export function queueHref(base: string, filter: Partial<ReturnQueueFilter> & { page?: number } = {}): string {
  const query = new URLSearchParams();
  if (filter.status && filter.status !== "open") query.set("status", filter.status);
  if (filter.kind && filter.kind !== "all") query.set("kind", filter.kind);
  if (filter.q && filter.q.trim()) query.set("q", filter.q.trim());
  if (filter.overdue) query.set("overdue", "1");
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
export const dayText = (at: Date | string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(at));

/** A day and time in the store's zone: "12 Oct 2026, 14:05". */
export const timeText = (at: Date | string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(at));

/** Today in the store's time zone as `YYYY-MM-DD`: the latest day a step (goods sent, goods received) can be dated. */
export const todayIn = (timeZone: string, now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now);

export type DueTone = "urgent" | "warn" | "calm";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The refund's mark in the queue and on the detail page: what to do about the money and by when, or null when there is
 * nothing to say (a return that has ended without a refund, or one not yet approved). `urgent` is past the legal
 * deadline, `warn` is the last days, `calm` is the rest.
 */
export function dueMark(due: RefundDue, timeZone: string): { text: string; tone: DueTone } | null {
  const by = due.deadline ? dayText(due.deadline, timeZone) : null;
  const left = due.daysToDeadline;
  switch (due.state) {
    case "not_applicable":
      return null;
    case "done":
      return { text: "Refunded", tone: "calm" };
    case "overdue":
      return { text: `Refund overdue${left !== null && left < 0 ? ` by ${days(-left)}` : ""}${by ? ` (was due ${by})` : ""}`, tone: "urgent" };
    case "waiting_late":
      return { text: `Past the refund deadline${by ? ` (${by})` : ""}, still waiting for the goods`, tone: "urgent" };
    case "due":
      return {
        text: by ? `Refund due ${left === 0 ? "today" : `by ${by}`}${left !== null && left > 0 ? ` (${days(left)} left)` : ""}` : "Ready to refund",
        tone: left !== null && left <= 2 ? "warn" : "calm",
      };
    case "waiting":
      return { text: `Waiting for the goods${by ? `, refund due by ${by}` : ""}`, tone: left !== null && left <= 2 ? "warn" : "calm" };
  }
}

/** A mark's colours, in the admin's own tokens plus the two alert colours it already uses. */
export const TONE_CLASS: Record<DueTone, string> = {
  urgent: "text-red-700 dark:text-red-400",
  warn: "text-amber-800 dark:text-amber-300",
  calm: "text-muted",
};

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

/** One event of a return as a sentence. Money is written by `formatMoney` in the order's currency; unknown types are named, never hidden. */
export function eventSentence(type: string, data: Record<string, unknown>, currency: string, locale = "en-GB"): string {
  const money = (minor: number | null) => (minor === null ? "an amount" : formatMoney(minor, currency, locale));
  switch (type) {
    case "return.requested":
      return "Return requested by the customer";
    case "return.confirmed":
      return "Withdrawal confirmed by the customer";
    case "return.approved":
      return data.automatic === true ? "Approved automatically: the right of withdrawal is not the store's to refuse" : "Approved";
    case "return.declined":
      return data.scope === "line" ? `A line was declined${text(data.reason) ? `: ${text(data.reason)}` : ""}` : `Declined${text(data.reason) ? `: ${text(data.reason)}` : ""}`;
    case "return.in_transit":
      return "Goods marked as on their way back";
    case "return.received":
      return "Goods received";
    case "return.inspected":
      return "Goods inspected";
    case "return.refunded":
      return `Refunded ${money(whole(data.amountMinor))}${data.outside === true ? ", outside Kaizen's Stripe" : ""}`;
    case "return.refund_overridden":
      return `The refund was changed from ${money(whole(data.computedMinor))} to ${money(whole(data.requestedMinor))}${text(data.reason) ? `: ${text(data.reason)}` : ""}`;
    case "return.closed":
      return data.outcome === "no_refund" ? "Closed with no refund" : "Closed";
    case "return.cancelled":
      return "Cancelled";
    default:
      return type;
  }
}

/** Whether an order event belongs to the returns timeline. */
export const isReturnEvent = (type: string): boolean => type.startsWith("return.");

// ---------------------------------------------------------------------------
// The refund's working
// ---------------------------------------------------------------------------

export const WORKING_LABELS = {
  goods: "What the customer paid for the returned goods",
  deductions: "Deduction for handling beyond what was needed to inspect the goods",
  shipping: "Original standard delivery (the whole order is withdrawn)",
  return_shipping: "Return shipping the customer pays",
} as const;

export const CAPPED_WORDS = {
  zero: "The sum is below zero, so nothing is refunded.",
  refundable: "The sum is more than is left to refund, so the refund is held to what is left.",
} as const;

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** A short sentence on what the numbers say, for the queue's header; empty when there is nothing to do. */
export function countsSentence(counts: { open: number; requested: number; overdue: number; acknowledgementPending: number }): string {
  const parts: string[] = [];
  if (counts.overdue > 0) parts.push(`${counts.overdue} past the refund deadline`);
  if (counts.acknowledgementPending > 0) parts.push(`${counts.acknowledgementPending} ${counts.acknowledgementPending === 1 ? "acknowledgement was" : "acknowledgements were"} not sent`);
  if (counts.requested > 0) parts.push(`${counts.requested} to approve`);
  if (parts.length === 0) return counts.open > 0 ? `${counts.open} open, none waiting on you.` : "No returns are open.";
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
