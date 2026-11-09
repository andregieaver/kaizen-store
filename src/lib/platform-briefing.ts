/**
 * The platform's own figures, targets, alerts and morning briefing (C2 of `docs/platform-parity-plan.md`, D513): the twin of a store's
 * targets, alerts and briefing (D348) for Kaizena Flow's business of plans. Pure: what a target's progress is, which alerts the figures
 * raise, and when a briefing is due. Worked out in code; nothing here is a model's.
 */

export const TARGET_METRICS = ["mrr", "sales", "paying", "new_stores"] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];
export const isTargetMetric = (value: unknown): value is TargetMetric => (TARGET_METRICS as readonly unknown[]).includes(value);

/** Money in a currency (recurring revenue, sales before VAT) or a count (paying stores, new stores). */
export const isMoneyMetric = (metric: TargetMetric): boolean => metric === "mrr" || metric === "sales";

/** A sum over the month (sales, new stores) grows through it; a level (recurring revenue, paying stores) is where it stands. */
export const isSumMetric = (metric: TargetMetric): boolean => metric === "sales" || metric === "new_stores";

export type PlatformTarget = { id: string; metric: TargetMetric; month: string; currency: string | null; targetValue: number };

export type TargetStatus = "reached" | "ahead" | "on_track" | "behind" | "to_go";

export type TargetProgress = { actual: number; pct: number; expected: number; status: TargetStatus };

/** Within 3 % of what was expected by today is on track. */
const TOLERANCE = 0.03;

const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/**
 * How a month's target stands on a day: reached once met; a sum held against an even share of the month by today (the whole month once
 * it is over); a level against the target itself, *to go* until it is met.
 */
export function targetProgress(target: Pick<PlatformTarget, "metric" | "month" | "targetValue">, actual: number, today: string): TargetProgress {
  const pct = target.targetValue > 0 ? Math.round((actual / target.targetValue) * 100) : 0;
  if (actual >= target.targetValue) return { actual, pct, expected: target.targetValue, status: "reached" };
  if (!isSumMetric(target.metric)) return { actual, pct, expected: target.targetValue, status: "to_go" };
  const days = daysIn(target.month);
  const monthOf = today.slice(0, 7);
  const elapsed = monthOf > target.month.slice(0, 7) ? days : monthOf < target.month.slice(0, 7) ? 0 : Number(today.slice(8, 10));
  const expected = Math.round((target.targetValue * elapsed) / days);
  if (expected === 0) return { actual, pct, expected, status: "on_track" };
  const ratio = actual / expected;
  return { actual, pct, expected, status: ratio >= 1 + TOLERANCE ? "ahead" : ratio >= 1 - TOLERANCE ? "on_track" : "behind" };
}

/** What the platform's figures are now, as the home, the alerts and the briefing read them. Money in minor units per currency. */
export type PlatformSnapshot = {
  today: string;
  /** Recurring revenue per currency now, and what it moved since the month began and in the last seven days. */
  mrr: { currency: string; minor: number; monthMovedMinor: number; weekMovedMinor: number }[];
  paying: number;
  trialing: number;
  late: number;
  /** Trials that end in the next three days. */
  trialsEnding: number;
  /** Sales before VAT this month so far, and last month to the same day, per currency. */
  sales: { currency: string; monthMinor: number; lastMonthToDateMinor: number }[];
  /** Stores that opened this month, and people who asked for a store and stores that opened today. */
  newStores: number;
  signUpsToday: { asked: number; opened: number };
  requests: { waiting: number; oldestHours: number | null };
  targets: { target: PlatformTarget; progress: TargetProgress }[];
};

export type AlertId = "requests_old" | "late_payments" | "mrr_down" | "target_behind" | "trials_ending";
export type PlatformAlert = { id: AlertId; severity: "urgent" | "warning" | "info"; values: Record<string, string | number>; href: string };

/** A request older than two days waits too long. */
export const REQUEST_HOURS = 48;

/** What the figures raise, the most pressing first: a request waiting too long, stores not paying, revenue falling, a target behind, trials ending. */
export function platformAlertsFor(s: PlatformSnapshot): PlatformAlert[] {
  const alerts: PlatformAlert[] = [];
  if (s.requests.oldestHours !== null && s.requests.oldestHours >= REQUEST_HOURS) {
    alerts.push({ id: "requests_old", severity: "urgent", values: { n: s.requests.waiting, days: Math.floor(s.requests.oldestHours / 24) }, href: "/admin/platform/requests" });
  }
  if (s.late > 0) alerts.push({ id: "late_payments", severity: s.late >= 3 ? "urgent" : "warning", values: { n: s.late }, href: "/admin/platform/stores" });
  for (const m of s.mrr) {
    if (m.weekMovedMinor < 0) alerts.push({ id: "mrr_down", severity: "warning", values: { currency: m.currency, minor: -m.weekMovedMinor }, href: "/admin/platform/plans/analytics" });
  }
  for (const t of s.targets) {
    if (t.progress.status === "behind") {
      alerts.push({ id: "target_behind", severity: "warning", values: { metric: t.target.metric, currency: t.target.currency ?? "", pct: t.progress.pct }, href: "/admin/platform/plans/analytics" });
    }
  }
  if (s.trialsEnding > 0) alerts.push({ id: "trials_ending", severity: "info", values: { n: s.trialsEnding }, href: "/admin/platform/stores" });
  const order = { urgent: 0, warning: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export const BRIEFING_KINDS = ["off", "daily", "weekly"] as const;
export type BriefingKind = (typeof BRIEFING_KINDS)[number];
export const isBriefingKind = (value: unknown): value is BriefingKind => (BRIEFING_KINDS as readonly unknown[]).includes(value);

/** The briefing comes at seven in the morning in Oslo; a weekly one on Mondays. */
export const BRIEFING_HOUR = 7;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The period a briefing is due for now (yesterday, or the week to yesterday on a Monday), or none: not on, too early, or sent. */
export function briefingDue(kind: BriefingKind, lastPeriod: string | null, now: { date: string; hour: number; weekday: number }): { key: string; from: string; to: string } | null {
  if (kind === "off" || now.hour < BRIEFING_HOUR) return null;
  if (kind === "weekly" && now.weekday !== 1) return null;
  const to = addDays(now.date, -1);
  const from = kind === "daily" ? to : addDays(to, -6);
  const key = `${kind}:${to}`;
  return lastPeriod === key ? null : { key, from, to };
}

/** The first day of a day's month. */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
