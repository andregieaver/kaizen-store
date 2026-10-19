/**
 * Staff alerts (wave 3, D238, `docs/wave-3-notifications.md` 2.4 and 4.7): the events staff can be emailed about, the permission each needs, who gets
 * them by default and while the owner has chosen, the summary's periods and the emails' idempotency keys. Pure: `src/server/staff-alerts.ts` reads the
 * members, the settings and the recipients and asks here who receives what, checked at sending. Only relative type imports (`src/db/schema.ts` reads
 * `STAFF_ALERT_EVENTS` for its checks, and drizzle-kit loads this file without the app's path aliases). English, as every staff email.
 */
import type { PermissionKey } from "./permission-keys";

export const STAFF_ALERT_EVENTS = ["new_order", "return_requested", "refund_overdue", "low_stock", "summary", "automation", "dispute"] as const;
export type StaffAlertEvent = (typeof STAFF_ALERT_EVENTS)[number];
export const isStaffAlertEvent = (value: unknown): value is StaffAlertEvent => (STAFF_ALERT_EVENTS as readonly unknown[]).includes(value);

/** What a member's role must hold to receive an event's email: the email shows what the key reads (4.7). */
export const ALERT_NEEDS: Record<StaffAlertEvent, PermissionKey> = {
  new_order: "orders:read",
  return_requested: "orders:read",
  refund_overdue: "orders:read",
  low_stock: "products:read",
  summary: "analytics:read",
  automation: "orders:read",
  dispute: "orders:read",
};

/** The columns of the staff alerts page. */
export const ALERT_LABELS: Record<StaffAlertEvent, string> = {
  new_order: "New order",
  return_requested: "Return requested",
  refund_overdue: "Refund overdue",
  low_stock: "Low stock",
  summary: "Summary",
  automation: "Automation",
  dispute: "Dispute",
};

/** The area named in *Needs {area} access* when a member's role does not hold the key. */
export const ALERT_AREA_WORDS: Record<StaffAlertEvent, string> = {
  new_order: "Orders",
  return_requested: "Orders",
  refund_overdue: "Orders",
  low_stock: "Products",
  summary: "Analytics",
  automation: "Orders",
  dispute: "Orders",
};

/** A member as the server read them: active, not expired, in an open store (anyone else is not passed in), with what their role holds. */
export type AlertMember = { accountId: string; owner: boolean; permissions: readonly string[] };

/** The store's choices (`staff_alert_settings` and `staff_alert_recipients`); `configuredAt` null means the defaults hold. */
export type AlertChoices = {
  configuredAt: string | null;
  /** `staff_alert_recipients`: an account and its events. */
  recipients: readonly { accountId: string; events: readonly string[] }[];
  /** The events the store's contact address receives. */
  contactEvents: readonly string[];
  /** Whether the store has a contact address. */
  hasContact: boolean;
};

export type AlertRecipient = { kind: "account"; accountId: string } | { kind: "contact" };

/** May this member receive the event's email at all (the box on the page is offered only then)? Owners hold every key. */
export const memberMayReceive = (member: AlertMember, event: StaffAlertEvent): boolean =>
  member.owner || member.permissions.includes(ALERT_NEEDS[event]);

/**
 * The defaults while the owner has not saved the page (4.7): owners get new orders, returns requested, low stock and disputes (D288); refunds overdue go to the contact
 * address, or to the owners when there is none (today's behaviour of D153 and D172); nobody gets the summary or automation emails.
 */
export function defaultRecipients(members: readonly AlertMember[], hasContact: boolean): { accounts: Map<string, StaffAlertEvent[]>; contact: StaffAlertEvent[] } {
  const accounts = new Map<string, StaffAlertEvent[]>();
  for (const m of members) {
    if (!m.owner) continue;
    const events: StaffAlertEvent[] = ["new_order", "return_requested", "low_stock", "dispute"];
    if (!hasContact) events.push("refund_overdue");
    accounts.set(m.accountId, events);
  }
  return { accounts, contact: hasContact ? ["refund_overdue"] : [] };
}

/**
 * Who receives an event's email now: the chosen (or default) accounts whose membership still lets them read it, and the contact address when it is
 * chosen and set. Each account once; members not passed in (removed, disabled, expired) receive nothing.
 */
export function recipientsFor(event: StaffAlertEvent, members: readonly AlertMember[], choices: AlertChoices): AlertRecipient[] {
  const byId = new Map(members.map((m) => [m.accountId, m]));
  const out: AlertRecipient[] = [];
  if (choices.configuredAt === null) {
    const d = defaultRecipients(members, choices.hasContact);
    for (const [accountId, events] of d.accounts) {
      const m = byId.get(accountId);
      if (m && events.includes(event) && memberMayReceive(m, event)) out.push({ kind: "account", accountId });
    }
    if (d.contact.includes(event)) out.push({ kind: "contact" });
    return out;
  }
  const seen = new Set<string>();
  for (const r of choices.recipients) {
    const m = byId.get(r.accountId);
    if (!m || seen.has(r.accountId) || !r.events.includes(event) || !memberMayReceive(m, event)) continue;
    seen.add(r.accountId);
    out.push({ kind: "account", accountId: r.accountId });
  }
  if (choices.hasContact && choices.contactEvents.includes(event)) out.push({ kind: "contact" });
  return out;
}

/** `{recipient}` of the keys of 2.8: the account id, or `contact`. */
export const recipientKey = (r: AlertRecipient): string => (r.kind === "contact" ? "contact" : r.accountId);

/** The idempotency keys of the staff emails (2.8). */
export const ALERT_KEYS = {
  newOrder: (orderId: string, r: AlertRecipient) => `staff-order:${orderId}:${recipientKey(r)}`,
  returnRequested: (returnId: string, r: AlertRecipient) => `staff-return:${returnId}:${recipientKey(r)}`,
  /** The contact address keeps today's key, so an overdue reminder already sent is not sent again. */
  refundOverdue: (returnId: string, r: AlertRecipient) => (r.kind === "contact" ? `return.${returnId}.overdue` : `return.${returnId}.overdue:${r.accountId}`),
  lowStock: (digestKey: string, r: AlertRecipient) => `${digestKey}:${recipientKey(r)}`,
  summary: (storeId: string, period: string, r: AlertRecipient) => `staff-summary:${storeId}:${period}:${recipientKey(r)}`,
  ruleNotify: (runId: string, r: AlertRecipient) => `rule-notify:${runId}:${recipientKey(r)}`,
  /** A dispute opened, and its deadline near (D288): once each per recipient. */
  disputeOpened: (disputeId: string, r: AlertRecipient) => `staff-dispute:${disputeId}:${recipientKey(r)}`,
  disputeDue: (disputeId: string, r: AlertRecipient) => `staff-dispute-due:${disputeId}:${recipientKey(r)}`,
} as const;

// ---------------------------------------------------------------------------
// The summary (2.4 point 2, 2.8)
// ---------------------------------------------------------------------------

export const SUMMARY_KINDS = ["off", "daily", "weekly"] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];
export const SUMMARY_DEFAULTS = { summary: "off" as SummaryKind, weekday: 1, hour: 8 };
/** ISO weekdays, Monday 1. */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** A store-local date and time. */
export type LocalNow = { date: string; weekday: number; hour: number };

/** The store's local date (YYYY-MM-DD), ISO weekday and hour at an instant. */
export function localNow(at: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: days.indexOf(get("weekday")) + 1, hour: Number(get("hour")) % 24 };
}

/** A calendar date moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type SummaryPeriod = {
  /** `summary_last_period` and the email's key: `daily:{yesterday}` or `weekly:{yesterday}`. */
  key: string;
  /** The first and last store days it covers (both included). */
  from: string;
  to: string;
};

/**
 * The period a summary is due for now, or null (4.7): daily once the store's local hour has reached the chosen hour, for yesterday; weekly on the chosen
 * weekday from that hour, for the seven store days ending yesterday. Null when it is off or this period was already sent (`lastPeriod`).
 */
export function summaryDue(input: {
  summary: SummaryKind;
  weekday: number;
  hour: number;
  lastPeriod: string | null;
  now: LocalNow;
}): SummaryPeriod | null {
  if (input.summary === "off") return null;
  if (input.now.hour < input.hour) return null;
  if (input.summary === "weekly" && input.now.weekday !== input.weekday) return null;
  const to = addDays(input.now.date, -1);
  const from = input.summary === "daily" ? to : addDays(to, -6);
  const key = `${input.summary}:${to}`;
  if (input.lastPeriod === key) return null;
  return { key, from, to };
}

/** What the page's summary field may hold. */
export function summaryChoiceProblem(input: { summary: string; weekday: number; hour: number }): string | null {
  if (!(SUMMARY_KINDS as readonly string[]).includes(input.summary)) return "Choose Off, Daily or Weekly.";
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) return "Choose a day of the week.";
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) return "Choose an hour between 0 and 23.";
  return null;
}
