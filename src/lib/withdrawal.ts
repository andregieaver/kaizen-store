import { addCalendarDays, daysBetween, dayIn } from "./work-dates";

/**
 * The right of withdrawal and the store's own returns window (D153, `docs/returns.md`): who can withdraw from which
 * line, until when, how much is left, and when a refund is due. Pure: the server reads the order and passes what it
 * says. Days are the store's calendar days (`stores.time_zone`), never UTC days and never 24-hour blocks.
 *
 * Nothing here is legal advice, and the texts built on it need human review before real use. A line that cannot be
 * withdrawn is never left out: `lineEligibility()` says why in a code, and `REFUSAL_KEYS` names the message.
 */

/** The statutory period, in days (Consumer Rights Directive Art. 9; Norway's angrerettloven § 21). Never shortened by a store. */
export const LEGAL_WITHDRAWAL_DAYS = 14;
/** The store may take up to this many days to refund after it was informed (Art. 13(1)). */
export const LEGAL_REFUND_DAYS = 14;
/** Goods are sent back within this many days of the declaration (Art. 14(1)). */
export const LEGAL_SEND_BACK_DAYS = 14;
/** A pending withdrawal request lapses after this many hours unconfirmed. */
export const REQUEST_LIFETIME_HOURS = 24;
export const MAX_REASON_NOTE = 500;

/** Why a shopper withdraws or returns: optional, never asked first, never a reason to refuse a withdrawal. */
export const RETURN_REASONS = [
  "changed_mind",
  "too_big",
  "too_small",
  "defective",
  "not_as_described",
  "damaged_in_transit",
  "wrong_item",
  "arrived_late",
  "other",
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const isReturnReason = (value: unknown): value is ReturnReason =>
  typeof value === "string" && (RETURN_REASONS as readonly string[]).includes(value);
/** The message under `m.returns.reasons.{key}` for a reason (the texts are in `i18n.ts`). */
export const reasonKey = (reason: ReturnReason): ReturnReason => reason;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ReturnAddress = { name: string; street: string; postalCode: string; city: string; country: string };

/** A store's rules for returns (`commerce.return_settings`); a store with no row has the legal defaults. */
export type ReturnSettings = {
  /** The store's own window in days: 14 to 100. The part beyond 14 is a return the store may decline. */
  windowDays: number;
  /**
   * Days the store reckons a parcel takes, 0 to 14. Only an estimate for staff to read: the statutory period starts when
   * the consumer receives the goods (CRD Art. 9(2)(b)), never from the date they were sent, so this never closes a right.
   */
  transitDays: number;
  whoPaysReturn: "shopper" | "store";
  refundWhen: "received" | "request";
  acceptExcluded: boolean;
  instructions: string;
  /** Where returns go; null is the store's postal address. */
  returnAddress: ReturnAddress | null;
  b2bReturns: boolean;
};

export const DEFAULT_RETURN_SETTINGS: ReturnSettings = {
  windowDays: LEGAL_WITHDRAWAL_DAYS,
  transitDays: 3,
  whoPaysReturn: "shopper",
  refundWhen: "received",
  acceptExcluded: false,
  instructions: "",
  returnAddress: null,
  b2bReturns: false,
};

export const MIN_WINDOW_DAYS = LEGAL_WITHDRAWAL_DAYS;
export const MAX_WINDOW_DAYS = 100;
export const MAX_TRANSIT_DAYS = 14;
export const MAX_INSTRUCTIONS = 2000;

// ---------------------------------------------------------------------------
// The order and its lines, as the rules read them
// ---------------------------------------------------------------------------

type Instant = Date | string | number;

export type WithdrawalOrder = {
  /** `orders.status`. */
  status: string;
  /** `orders.copied_from is not null`: history copied from another store (D129). */
  copied: boolean;
  /** An order placed for a company (`company_name`): no statutory right. */
  business: boolean;
  /** `orders.delivered_at`: when the goods (the last of them) reached the customer, as staff or a carrier recorded it. */
  deliveredAt: Instant | null;
  /** The last shipment's date: goods sent in parts are received when the last part is, so the last shipment counts. */
  lastShippedAt: Instant | null;
  /** `orders.subscription_id is not null`: accepted like any other, the subscription is ended separately. */
  subscription?: boolean;
  /** The shopper's tick for digital content delivered at once (`digital_consent_at is not null`). */
  digitalConsent?: boolean;
};

export type WithdrawalLine = {
  id: string;
  /** Units bought. */
  quantity: number;
  /** `order_lines.withdrawal_exclusion`. */
  withdrawalExclusion: string;
  /** `order_lines.delivery`: `physical`, `digital` or `service` (a booking). */
  delivery: string;
  /** Units already on withdrawals and returns that are not declined or cancelled (`taken()`). */
  takenQuantity: number;
};

export type WithdrawalWindow = {
  /**
   * `before_delivery`: nothing sent, the right is open; `statutory`: inside the 14 days, or sent and not yet recorded as
   * received (the right is open: the period has not started); `voluntary`: past them, inside the store's window; `closed`.
   */
  state: "before_delivery" | "statutory" | "voluntary" | "closed";
  /** What the period counts from: the goods received, or (when only sent) nothing yet, or nothing sent. */
  basis: "delivered" | "sent" | "not_sent";
  /** The store's calendar day the period counts from (day 0): the day the goods were received. Null until they are recorded as received. */
  startDay: string | null;
  /** The last store day of the statutory period (day 14), when the receipt is known. */
  statutoryEndDay: string | null;
  /** The last store day of the store's own window (at least the statutory one), when the receipt is known. */
  voluntaryEndDay: string | null;
  /** Whole days left in the period now in force; null when it is open without an end, or over. */
  daysLeft: number | null;
  /**
   * Goods sent and receipt not recorded: the day the 14 days would end if the parcel took the store's usual transit
   * time. An estimate for staff to read, never a deadline and never used to refuse a withdrawal.
   */
  estimatedEndDay?: string | null;
};

/**
 * Where an order stands in time. The statutory period counts from the day the consumer received the goods, the last of
 * them when they come in parts (CRD Art. 9(2)(b)): day 0 is that day, and the last day to withdraw is 14 days later, to
 * the end of the store's day. The date a parcel was sent is not the date it was received, so with the receipt not
 * recorded (`deliveredAt`) the right stays open: the period has not started, and nothing is refused on an estimate.
 * Before anything is sent the right is open as well (a consumer may withdraw before delivery). The store's own longer
 * window counts from the same receipt.
 */
export function withdrawalWindow(
  order: Pick<WithdrawalOrder, "deliveredAt" | "lastShippedAt">,
  settings: Pick<ReturnSettings, "windowDays" | "transitDays">,
  timeZone: string,
  now: Instant,
): WithdrawalWindow {
  const today = dayIn(now, timeZone);
  if (!order.deliveredAt) {
    if (order.lastShippedAt) {
      const estimatedEndDay = addCalendarDays(
        addCalendarDays(dayIn(order.lastShippedAt, timeZone), clampInt(settings.transitDays, 0, MAX_TRANSIT_DAYS)),
        LEGAL_WITHDRAWAL_DAYS,
      );
      return { state: "statutory", basis: "sent", startDay: null, statutoryEndDay: null, voluntaryEndDay: null, daysLeft: null, estimatedEndDay };
    }
    return { state: "before_delivery", basis: "not_sent", startDay: null, statutoryEndDay: null, voluntaryEndDay: null, daysLeft: null, estimatedEndDay: null };
  }
  const startDay = dayIn(order.deliveredAt, timeZone);
  const windowDays = Math.max(LEGAL_WITHDRAWAL_DAYS, clampInt(settings.windowDays, MIN_WINDOW_DAYS, MAX_WINDOW_DAYS));
  const statutoryEndDay = addCalendarDays(startDay, LEGAL_WITHDRAWAL_DAYS);
  const voluntaryEndDay = addCalendarDays(startDay, windowDays);
  const state = today <= statutoryEndDay ? "statutory" : today <= voluntaryEndDay ? "voluntary" : "closed";
  const daysLeft = state === "statutory" ? daysBetween(today, statutoryEndDay) : state === "voluntary" ? daysBetween(today, voluntaryEndDay) : null;
  return { state, basis: "delivered", startDay, statutoryEndDay, voluntaryEndDay, daysLeft, estimatedEndDay: null };
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

/** What counts against a line: accepted units on a return that is not declined or cancelled (the SQL's `returned_quantity()`). */
export function countsAgainstLine(returnStatus: string, lineDecision: string): boolean {
  return lineDecision === "accept" && returnStatus !== "declined" && returnStatus !== "cancelled";
}

/** Units taken from a line by returns, as the database counts them. */
export function takenQuantity(rows: { quantity: number; returnStatus: string; decision: string }[]): number {
  return rows.reduce((sum, r) => sum + (countsAgainstLine(r.returnStatus, r.decision) ? r.quantity : 0), 0);
}

/** What is left of a line to withdraw or return. */
export function remainingQuantity(ordered: number, taken: number): number {
  return Math.max(0, Math.trunc(ordered) - Math.max(0, Math.trunc(taken)));
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** Why a line cannot be withdrawn or returned: each has a plain message under `m.returns.refusal.{code}`. */
export const REFUSALS = [
  "order_not_paid",
  "copied_order",
  "already_returned",
  "excluded_by_law",
  "digital_content",
  "booking",
  "business_order",
  "period_over",
] as const;
export type Refusal = (typeof REFUSALS)[number];
export const REFUSAL_KEYS: Record<Refusal, Refusal> = Object.fromEntries(REFUSALS.map((r) => [r, r])) as Record<Refusal, Refusal>;

/** What the shopper can do with a line: `withdrawal` (the statutory right), `return` (the store's own window), or `none`. */
export type LineRight = "withdrawal" | "return" | "none";

export type LineEligibility = {
  lineId: string;
  right: LineRight;
  /** The most that can be declared now: what is left when there is a right, else 0. */
  maxQuantity: number;
  remaining: number;
  /** Set exactly when `right` is `none`. */
  refusal: Refusal | null;
  /** For `excluded_by_law`: the exclusion (`custom_made`, …), so the screen can name it. */
  exclusion: string | null;
  /**
   * Sealed goods (hygiene, audio, video, software): the right is lost only once they are unsealed after delivery
   * (Art. 16(e), (i)), so it is open now, on the condition that the seal is unbroken. Inspection decides if it was.
   */
  sealed: boolean;
  /** The store's own window may be asked for instead (true when the right is `return`, or when it would be offered later). */
  voluntaryOffered: boolean;
};

const PAID_STATUSES = ["paid", "fulfilled", "closed"];
/** Exclusions that are a kind of goods: a store may accept these back inside its own window (`accept_excluded`). */
const NEVER_RETURNED = new Set(["digital_content", "dated_service"]);
/** Goods whose right is lost only once they are unsealed (Art. 16(e), (i)): the withdrawal is taken, the seal is checked on inspection. */
export const SEALED_GOODS = new Set(["sealed_hygiene", "sealed_media"]);

/**
 * What a shopper can do with one line of an order, and when not, why. A pure function of the order, the line, the
 * store's settings and the time.
 *
 * - An order not paid, or copied from another store, has no right; a line with nothing left has none.
 * - Sealed goods (`sealed_hygiene`, `sealed_media`) keep the right until they are unsealed: they are treated like any other
 *   line, marked `sealed` so the screens say the right lasts while the seal is unbroken.
 * - A line the law excludes (`withdrawal_exclusion` other than `none` and not sealed), digital content the shopper consented to lose the
 *   right for, and a booking (cancelled through the booking tools) have no right. A store that accepts excluded goods
 *   (`acceptExcluded`) takes goods back inside its own window, as a return; never digital content or a dated service.
 * - A company has no statutory right; with `b2bReturns` it can return inside the store's own window.
 * - Otherwise the right is a withdrawal inside the 14 days (or before the goods are sent), a return inside the store's
 *   longer window, and nothing after.
 */
export function lineEligibility(
  line: WithdrawalLine,
  order: WithdrawalOrder,
  settings: ReturnSettings,
  timeZone: string,
  now: Instant,
): LineEligibility {
  const remaining = remainingQuantity(line.quantity, line.takenQuantity);
  const none = (refusal: Refusal, exclusion: string | null = null, voluntaryOffered = false): LineEligibility => ({
    lineId: line.id,
    right: "none",
    maxQuantity: 0,
    remaining,
    refusal,
    exclusion,
    sealed: false,
    voluntaryOffered,
  });
  const exclusion = line.withdrawalExclusion && line.withdrawalExclusion !== "none" ? line.withdrawalExclusion : null;
  const sealed = exclusion !== null && SEALED_GOODS.has(exclusion);
  const some = (right: Exclude<LineRight, "none">): LineEligibility => ({
    lineId: line.id,
    right,
    maxQuantity: remaining,
    remaining,
    refusal: null,
    exclusion: null,
    sealed,
    voluntaryOffered: right === "return",
  });

  if (order.copied) return none("copied_order");
  if (!PAID_STATUSES.includes(order.status)) return none("order_not_paid");
  if (remaining <= 0) return none("already_returned");

  const window = withdrawalWindow(order, settings, timeZone, now);
  // What the shopper's own tick or the kind of line takes away, whatever the product says.
  const digitalLost = line.delivery === "digital" && Boolean(order.digitalConsent);

  if (line.delivery === "service") return none("booking", exclusion);
  if (exclusion === "digital_content" || digitalLost) return none("digital_content", exclusion);
  if (exclusion === "dated_service") return none("booking", exclusion);
  if (exclusion && !sealed) {
    // Goods the law leaves out: back only inside the store's own window, and only if the store says so.
    if (settings.acceptExcluded && !NEVER_RETURNED.has(exclusion)) {
      return window.state === "closed" ? none("period_over", exclusion) : some("return");
    }
    return none("excluded_by_law", exclusion);
  }
  if (order.business) {
    if (settings.b2bReturns) return window.state === "closed" ? none("period_over") : some("return");
    return none("business_order");
  }
  switch (window.state) {
    case "before_delivery":
    case "statutory":
      return some("withdrawal");
    case "voluntary":
      return some("return");
    default:
      return none("period_over");
  }
}

/** Every line of an order with its eligibility, the lines that cannot be withdrawn listed with their reason. */
export function orderEligibility(
  lines: WithdrawalLine[],
  order: WithdrawalOrder,
  settings: ReturnSettings,
  timeZone: string,
  now: Instant,
): LineEligibility[] {
  return lines.map((line) => lineEligibility(line, order, settings, timeZone, now));
}

/** What a shopper can do with the order as a whole: a withdrawal if any line has the right, else a return, else nothing. */
export function orderRight(eligible: LineEligibility[]): LineRight {
  if (eligible.some((l) => l.right === "withdrawal")) return "withdrawal";
  if (eligible.some((l) => l.right === "return")) return "return";
  return "none";
}

export type QuantityProblem = { lineId: string; code: "unknown_line" | "no_right" | "too_many" | "not_positive" | "duplicate" };

/**
 * Checks what the shopper declared against the eligibility: only lines of the order, only lines with the kind of
 * right asked for, never more than is left, each line once. Returns the problems, none when it is fine.
 */
export function declaredProblems(
  declared: { lineId: string; quantity: number }[],
  eligible: LineEligibility[],
  asking: Exclude<LineRight, "none">,
): QuantityProblem[] {
  const problems: QuantityProblem[] = [];
  const seen = new Set<string>();
  for (const item of declared) {
    const line = eligible.find((e) => e.lineId === item.lineId);
    if (!line) problems.push({ lineId: item.lineId, code: "unknown_line" });
    else if (seen.has(item.lineId)) problems.push({ lineId: item.lineId, code: "duplicate" });
    else if (!Number.isInteger(item.quantity) || item.quantity <= 0) problems.push({ lineId: item.lineId, code: "not_positive" });
    else if (line.right !== asking) problems.push({ lineId: item.lineId, code: "no_right" });
    else if (item.quantity > line.maxQuantity) problems.push({ lineId: item.lineId, code: "too_many" });
    seen.add(item.lineId);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ms = (instant: Instant) => (instant instanceof Date ? instant.getTime() : new Date(instant).getTime());

/**
 * The latest moment the store may refund a withdrawal: 14 days after it was informed (the confirmation), the same
 * clock time. The database holds the same figure in `returns.refund_deadline`.
 */
export function refundDeadline(confirmedAt: Instant): Date {
  return new Date(ms(confirmedAt) + LEGAL_REFUND_DAYS * DAY_MS);
}

/** The last store day for the shopper to send the goods back: 14 days after the declaration (Art. 14(1)). */
export function sendBackDay(confirmedAt: Instant, timeZone: string): string {
  return addCalendarDays(dayIn(confirmedAt, timeZone), LEGAL_SEND_BACK_DAYS);
}

export type RefundClockInput = {
  kind: "withdrawal" | "return";
  /** The return's status. */
  status: string;
  /** When the store was informed of the withdrawal (`withdrawal_requests.confirmed_at`); null for a voluntary return. */
  confirmedAt: Instant | null;
  /** `returns.refund_deadline`, when the database has set it. */
  refundDeadline?: Instant | null;
  /** The shopper's proof of sending (`returns.shipped_at`). */
  shippedAt: Instant | null;
  receivedAt: Instant | null;
  /** The refund is recorded (`returns.refund_minor is not null`). */
  refunded: boolean;
  /**
   * The withdrawal was made before the goods were sent, so there is nothing to send back: the store may hold a refund
   * only against goods or proof of sending (Art. 13(3)), and with neither to wait for it holds nothing.
   */
  nothingToSendBack?: boolean;
};

export type RefundDue = {
  /**
   * `not_applicable`: ended without a refund or not approved yet; `done`; `waiting`: the store may hold the refund until the
   * goods or proof of sending arrive, deadline not passed; `due`: it can be refunded now; `overdue`: it can be and
   * the deadline has passed; `waiting_late`: the deadline passed while the goods are still awaited (a lawful hold, but
   * one that needs a look).
   */
  state: "not_applicable" | "done" | "waiting" | "due" | "overdue" | "waiting_late";
  /** The legal deadline (a withdrawal's); null for a voluntary return, which has none. */
  deadline: Date | null;
  /** Whole store days to the deadline, negative when passed. */
  daysToDeadline: number | null;
  /** Whether the goods (or proof of sending) are what the refund waits for. */
  waitingFor: "goods" | null;
  /** When the refund became possible: the earlier of received and proof of sending, or the request when it does not wait. */
  clockStart: Date | null;
};

/**
 * Whether a refund is due, and by when. The deadline is `refundDeadline(confirmedAt)`. With *refund when received* (the
 * default for goods) the store may withhold the refund until it has the goods back or proof of sending (Art. 13(3)): the
 * clock for being able to refund is the earlier of the two, and never later than the deadline stated in the
 * acknowledgement. A withdrawal made before anything was sent has nothing to wait for, so its refund is due at once.
 * Nothing is refunded automatically.
 */
export function refundDue(input: RefundClockInput, settings: Pick<ReturnSettings, "refundWhen">, timeZone: string, now: Instant): RefundDue {
  const nothing = (state: RefundDue["state"]): RefundDue => ({ state, deadline: null, daysToDeadline: null, waitingFor: null, clockStart: null });
  if (input.refunded) return nothing("done");
  if (["requested", "declined", "cancelled", "closed"].includes(input.status)) return nothing("not_applicable");

  const deadline = input.refundDeadline ? new Date(ms(input.refundDeadline)) : input.kind === "withdrawal" && input.confirmedAt ? refundDeadline(input.confirmedAt) : null;
  const proofs = [input.receivedAt, input.shippedAt].filter((x): x is Instant => x != null).map(ms);
  const waits = settings.refundWhen === "received" && !input.nothingToSendBack;
  const clockStart = waits ? (proofs.length ? new Date(Math.min(...proofs)) : null) : input.confirmedAt ? new Date(ms(input.confirmedAt)) : null;
  const canRefund = !waits || proofs.length > 0;
  const nowMs = ms(now);
  const pastDeadline = deadline ? nowMs > deadline.getTime() : false;
  const daysToDeadline = deadline ? daysBetween(dayIn(now, timeZone), dayIn(deadline, timeZone)) : null;
  const state: RefundDue["state"] = canRefund ? (pastDeadline ? "overdue" : "due") : pastDeadline ? "waiting_late" : "waiting";
  return { state, deadline, daysToDeadline, waitingFor: canRefund ? null : "goods", clockStart };
}
