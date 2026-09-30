import { timeAmountMinor, type BillingType } from "./work-calc";
import { addCalendarDays, daysBetween, dueState, monthOf, type Day } from "./work-dates";
import { formatDuration, invoiceableMinutes } from "./work-time";

/**
 * The Work overview (docs/work.md 6.5): what is unbilled, what is drafted, what
 * is owed and by when, what was paid this month, and what needs the owner,
 * counted in code from plain rows. The useful residue of Life's Finances and
 * Revenue view, without its budget projections.
 *
 * Everything is per currency and amounts of different currencies are never
 * added (as `controlCenter()` does); counts and minutes are. The server reads
 * the rows (`src/server/work-overview.ts`), this decides what they mean.
 */

export type OverviewInvoice = {
  id: string;
  clientId: string;
  status: "draft" | "sent" | "paid" | "void";
  currency: string;
  totalMinor: number;
  /** Payments received so far, refunds taken off. */
  paidMinor: number;
  /** Credit notes issued against it. */
  creditedMinor: number;
  /** Null for a draft. */
  dueOn: Day | null;
  /** The day the invoice became paid, in the store's time zone. */
  paidOn: Day | null;
  /** The day the draft was last changed, in the store's time zone. */
  updatedOn: Day;
  /** The period of the recurring template that made it, when one did. */
  recurringPeriod: Day | null;
};

export type OverviewEntry = {
  clientId: string;
  assignmentId: string;
  billingType: BillingType;
  currency: string;
  /** The assignment's effective net hourly rate (`effectiveRate`). */
  rateMinor: number;
  workDate: Day;
  minutes: number;
  billable: boolean;
  prepaidMinutes: number;
  invoiceLineId: string | null;
};

export type OverviewTimer = { accountId: string; assignmentId: string; startedAt: number };

export type OverviewBalance = { clientId: string; minutes: number; lowBelowMinutes: number };

/** A timer left running this long is worth a word. */
export const LONG_TIMER_HOURS = 12;
/** Unbilled time this old, or a draft this old, is worth a word. */
export const STALE_UNBILLED_DAYS = 30;
export const STALE_DRAFT_DAYS = 7;
/** An invoice this far overdue is urgent. */
export const URGENT_OVERDUE_DAYS = 14;

export type Bucket = { count: number; minor: number };

export type CurrencyFigures = {
  currency: string;
  /** Billable time no invoice has taken and prepaid hours did not cover, at the rates (fixed fees are left out). */
  unbilled: { minutes: number; amountMinor: number; oldestWorkDate: Day | null };
  drafts: Bucket;
  receivables: {
    notYetDue: Bucket;
    dueSoon: Bucket;
    overdue: Bucket & { oldestDueOn: Day | null };
    outstandingMinor: number;
  };
  paidThisMonth: Bucket;
};

export type AttentionItem = { text: string; href: string; action: string; urgent?: boolean };

export type WorkOverview = {
  currencies: CurrencyFigures[];
  unbilledByClient: { clientId: string; currency: string; minutes: number; amountMinor: number }[];
  /** Overdue invoices, the oldest first. */
  overdueInvoices: {
    invoiceId: string;
    clientId: string;
    currency: string;
    dueOn: Day;
    daysOverdue: number;
    outstandingMinor: number;
  }[];
  runningTimers: (OverviewTimer & { elapsedMinutes: number })[];
  lowBalances: { clientId: string; minutes: number }[];
  counts: {
    overdue: number;
    drafts: number;
    staleDrafts: number;
    recurringReady: number;
    longTimers: number;
    staleUnbilledMinutes: number;
    lowBalances: number;
  };
  attention: AttentionItem[];
};

/** What is still owed on an issued invoice: total less payments and credit notes, never below zero. */
export const outstandingMinor = (i: Pick<OverviewInvoice, "totalMinor" | "paidMinor" | "creditedMinor">): number =>
  Math.max(0, i.totalMinor - i.paidMinor - i.creditedMinor);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The overview's figures and the things that need attention, from plain
 * rows and the store's today. `base` is the Work area's address
 * (`/admin/account/work/s/{store}`, D123), where the attention items point; `label` names the
 * store in the control center's list across stores.
 */
export function workOverview(args: {
  today: Day;
  now: number;
  invoices: readonly OverviewInvoice[];
  entries: readonly OverviewEntry[];
  timers: readonly OverviewTimer[];
  balances?: readonly OverviewBalance[];
  base: string;
  label?: string;
}): WorkOverview {
  const { today } = args;
  const perCurrency = new Map<string, CurrencyFigures>();
  const figures = (currency: string): CurrencyFigures => {
    let f = perCurrency.get(currency);
    if (!f) {
      f = {
        currency,
        unbilled: { minutes: 0, amountMinor: 0, oldestWorkDate: null },
        drafts: { count: 0, minor: 0 },
        receivables: {
          notYetDue: { count: 0, minor: 0 },
          dueSoon: { count: 0, minor: 0 },
          overdue: { count: 0, minor: 0, oldestDueOn: null },
          outstandingMinor: 0,
        },
        paidThisMonth: { count: 0, minor: 0 },
      };
      perCurrency.set(currency, f);
    }
    return f;
  };

  const overdueInvoices: WorkOverview["overdueInvoices"] = [];
  let staleDrafts = 0;
  let recurringReady = 0;
  for (const inv of args.invoices) {
    const f = figures(inv.currency);
    if (inv.status === "draft") {
      f.drafts.count += 1;
      f.drafts.minor += inv.totalMinor;
      if (daysBetween(inv.updatedOn, today) >= STALE_DRAFT_DAYS) staleDrafts += 1;
      if (inv.recurringPeriod && inv.recurringPeriod <= today) recurringReady += 1;
    } else if (inv.status === "sent" && inv.dueOn) {
      const owed = outstandingMinor(inv);
      if (owed === 0) continue;
      f.receivables.outstandingMinor += owed;
      const state = dueState(inv.dueOn, today);
      if (state === "overdue") {
        f.receivables.overdue.count += 1;
        f.receivables.overdue.minor += owed;
        const oldest = f.receivables.overdue.oldestDueOn;
        if (oldest === null || inv.dueOn < oldest) f.receivables.overdue.oldestDueOn = inv.dueOn;
        overdueInvoices.push({
          invoiceId: inv.id,
          clientId: inv.clientId,
          currency: inv.currency,
          dueOn: inv.dueOn,
          daysOverdue: daysBetween(inv.dueOn, today),
          outstandingMinor: owed,
        });
      } else {
        const bucket = state === "due_soon" ? f.receivables.dueSoon : f.receivables.notYetDue;
        bucket.count += 1;
        bucket.minor += owed;
      }
    } else if (inv.status === "paid" && inv.paidOn && monthOf(inv.paidOn) === monthOf(today)) {
      f.paidThisMonth.count += 1;
      f.paidThisMonth.minor += inv.totalMinor;
    }
  }
  overdueInvoices.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  // Unbilled time is priced per assignment, as a line would be: hours rounded to hundredths once, at the rate.
  const perAssignment = new Map<string, { entries: OverviewEntry[]; minutes: number }>();
  let staleUnbilledMinutes = 0;
  const staleBefore = addCalendarDays(today, -STALE_UNBILLED_DAYS);
  for (const e of args.entries) {
    if (e.billingType !== "hourly") continue;
    const minutes = invoiceableMinutes([e], { onlyUnbilled: true });
    if (minutes === 0) continue;
    if (e.workDate < staleBefore) staleUnbilledMinutes += minutes;
    const entry = perAssignment.get(e.assignmentId) ?? { entries: [], minutes: 0 };
    entry.entries.push(e);
    entry.minutes += minutes;
    perAssignment.set(e.assignmentId, entry);
  }
  const byClient = new Map<string, { clientId: string; currency: string; minutes: number; amountMinor: number }>();
  for (const { entries, minutes } of perAssignment.values()) {
    const first = entries[0];
    const amountMinor = timeAmountMinor(minutes, first.rateMinor);
    const f = figures(first.currency);
    f.unbilled.minutes += minutes;
    f.unbilled.amountMinor += amountMinor;
    for (const e of entries) {
      if (f.unbilled.oldestWorkDate === null || e.workDate < f.unbilled.oldestWorkDate)
        f.unbilled.oldestWorkDate = e.workDate;
    }
    const key = `${first.clientId}:${first.currency}`;
    const c = byClient.get(key) ?? { clientId: first.clientId, currency: first.currency, minutes: 0, amountMinor: 0 };
    c.minutes += minutes;
    c.amountMinor += amountMinor;
    byClient.set(key, c);
  }

  const runningTimers = args.timers.map((t) => ({
    ...t,
    elapsedMinutes: Math.max(0, Math.floor((args.now - t.startedAt) / 60_000)),
  }));
  const longTimers = runningTimers.filter((t) => t.elapsedMinutes >= LONG_TIMER_HOURS * 60);
  const lowBalances = (args.balances ?? [])
    .filter((b) => b.minutes < b.lowBelowMinutes)
    .map((b) => ({ clientId: b.clientId, minutes: b.minutes }));

  const counts = {
    overdue: overdueInvoices.length,
    drafts: [...perCurrency.values()].reduce((s, f) => s + f.drafts.count, 0),
    staleDrafts,
    recurringReady,
    longTimers: longTimers.length,
    staleUnbilledMinutes,
    lowBalances: lowBalances.length,
  };

  const prefix = args.label ? `${args.label}: ` : "";
  const attention: AttentionItem[] = [];
  if (counts.overdue > 0) {
    const oldest = overdueInvoices[0].daysOverdue;
    attention.push({
      text: `${prefix}${plural(counts.overdue, "invoice is", "invoices are")} overdue, the oldest by ${plural(oldest, "day", "days")}.`,
      href: `${args.base}/invoices?show=overdue`,
      action: "Open invoices",
      urgent: oldest >= URGENT_OVERDUE_DAYS,
    });
  }
  if (recurringReady > 0) {
    attention.push({
      text: `${prefix}${plural(recurringReady, "recurring invoice is", "recurring invoices are")} ready to issue.`,
      href: `${args.base}/invoices?show=drafts`,
      action: "Review",
    });
  }
  if (staleUnbilledMinutes > 0) {
    attention.push({
      text: `${prefix}${formatDuration(staleUnbilledMinutes)} of time has been unbilled for over ${STALE_UNBILLED_DAYS} days.`,
      href: `${args.base}/invoices/new`,
      action: "Invoice time",
    });
  }
  if (staleDrafts > 0) {
    attention.push({
      text: `${prefix}${plural(staleDrafts, "invoice draft has", "invoice drafts have")} been waiting for over ${STALE_DRAFT_DAYS} days.`,
      href: `${args.base}/invoices?show=drafts`,
      action: "Open drafts",
    });
  }
  if (counts.longTimers > 0) {
    attention.push({
      text: `${prefix}${plural(counts.longTimers, "timer has", "timers have")} been running for over ${LONG_TIMER_HOURS} hours.`,
      href: args.base,
      action: "Open Work",
    });
  }
  if (counts.lowBalances > 0) {
    attention.push({
      text: `${prefix}${plural(counts.lowBalances, "client is", "clients are")} low on prepaid hours.`,
      href: `${args.base}/hours`,
      action: "Open hours",
    });
  }

  return {
    currencies: [...perCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    unbilledByClient: [...byClient.values()].sort((a, b) => b.amountMinor - a.amountMinor),
    overdueInvoices,
    runningTimers,
    lowBalances,
    counts,
    attention: attention.sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent))),
  };
}
