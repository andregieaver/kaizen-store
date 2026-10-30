/**
 * The status page's rules (wave 9 unit G, D360, `docs/wave-9-platform.md` section 3, G), pure: the components, a day's bar from its checks,
 * the uptime over the days measured, when a component's state needs an email to platform admins, and the incidents' words. A check that did
 * not run is missing, never counted as up.
 */

export const STATUS_COMPONENTS = ["website", "sign_in", "payments", "email", "jobs"] as const;
export type StatusComponent = (typeof STATUS_COMPONENTS)[number];

export const INCIDENT_IMPACTS = ["minor", "major", "maintenance"] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Days the page's bars and uptime cover; checks older than this are deleted. */
export const STATUS_DAYS = 90;
/** Checks in a row that must fail before platform admins are emailed. */
export const ALERT_AFTER = 2;

export const isStatusComponent = (value: unknown): value is StatusComponent => (STATUS_COMPONENTS as readonly unknown[]).includes(value);

/** One day of a component's bar: how many of its checks passed, of how many ran. */
export type DayCount = { day: string; ok: number; total: number };
export type DayState = "ok" | "partial" | "down" | "none";
export type DayBar = DayCount & { state: DayState };

/** A day's state: none ran, all passed, most failed (`down`), else some failed (`partial`). */
export function dayState({ ok, total }: Pick<DayCount, "ok" | "total">): DayState {
  if (total === 0) return "none";
  if (ok === total) return "ok";
  return ok * 2 < total ? "down" : "partial";
}

/** The ISO dates of the `days` days up to and including `today` (UTC), oldest first. */
export function lastDays(today: Date, days = STATUS_DAYS): string[] {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** A component's bar over the last days: each day from its counts, a day with none `none`. */
export function dayBars(counts: readonly DayCount[], today: Date, days = STATUS_DAYS): DayBar[] {
  const byDay = new Map(counts.map((c) => [c.day, c]));
  return lastDays(today, days).map((day) => {
    const count = byDay.get(day) ?? { day, ok: 0, total: 0 };
    return { ...count, day, state: dayState(count) };
  });
}

/** The share of checks that passed over the bars, in hundredths of a percent; null when none ran. */
export function uptimeBasisPoints(bars: readonly DayCount[]): number | null {
  const total = bars.reduce((n, b) => n + b.total, 0);
  if (total === 0) return null;
  const ok = bars.reduce((n, b) => n + b.ok, 0);
  return Math.floor((ok * 10_000) / total);
}

/** Minutes between two runs of the checks: a failed check stands for this long. */
export const CHECK_MINUTES = 5;

/** Days a service level objective is measured over (REL-09): the last 30, today included. */
export const SLO_DAYS = 30;

/**
 * Each part's objective, the share of its checks that pass over `SLO_DAYS`, in hundredths of a percent: what shoppers and owners meet
 * first is held to 99.9 % (about 43 minutes a month), email and background work, which retry by themselves, to 99.5 %.
 */
export const SLO_TARGETS: Record<StatusComponent, number> = { website: 9_990, sign_in: 9_990, payments: 9_990, email: 9_950, jobs: 9_950 };

export type Slo = {
  targetBps: number;
  /** The share that passed over the days measured; null when no check ran. */
  actualBps: number | null;
  met: boolean | null;
  /** Minutes of failed checks the objective still allows (negative once missed); null when no check ran. */
  minutesLeft: number | null;
};

/** A part's objective against its last `SLO_DAYS` bars: met while the failed checks are within what the target allows. */
export function sloOf(id: StatusComponent, bars: readonly DayCount[]): Slo {
  const targetBps = SLO_TARGETS[id];
  const recent = bars.slice(-SLO_DAYS);
  const total = recent.reduce((n, b) => n + b.total, 0);
  if (total === 0) return { targetBps, actualBps: null, met: null, minutesLeft: null };
  const ok = recent.reduce((n, b) => n + b.ok, 0);
  const allowed = Math.floor((total * (10_000 - targetBps)) / 10_000);
  return { targetBps, actualBps: Math.floor((ok * 10_000) / total), met: total - ok <= allowed, minutesLeft: (allowed - (total - ok)) * CHECK_MINUTES };
}

/** The uptime as people read it (`99.95 %`), never rounded up to 100 while a check failed. */
export function uptimeText(basisPoints: number | null, locale: string): string | null {
  if (basisPoints === null) return null;
  const percent = basisPoints / 100;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(percent)} %`;
}

/**
 * Whether the newest checks (newest first) are the moment to email platform admins: exactly `ALERT_AFTER` failed in a row, so a component
 * that stays down is said once, and again only after it was up in between.
 */
export function alertDue(newestFirst: readonly boolean[]): boolean {
  if (newestFirst.length < ALERT_AFTER) return false;
  const run = newestFirst.slice(0, ALERT_AFTER);
  if (run.some((ok) => ok)) return false;
  return newestFirst.length === ALERT_AFTER || newestFirst[ALERT_AFTER] === true;
}

/**
 * Whether Stripe's events are reaching Kaizena Flow, beside whether Stripe answers (consolidation 8): the webhooks drill once found 13 days
 * without an event while the status page said Payments was up. Fails, most telling first, on an endpoint Stripe sends to that is not at
 * this site (the webhooks drill's check, PSI REL-09), on a checkout Stripe says is complete that is still pending here after a quarter of an
 * hour (its event never came), on payments taken in the last hours with no Stripe event heard at all (`silent`, PSI REL-02), or on an event
 * received but not processed after half an hour. Null: nothing wrong.
 */
export function eventsProblem({
  unprocessed,
  unheard,
  endpointsElsewhere = 0,
  silent = false,
}: {
  unprocessed: number;
  unheard: number;
  endpointsElsewhere?: number;
  silent?: boolean;
}): "endpoints_elsewhere" | "events_missing" | "events_silent" | "events_unprocessed" | null {
  if (endpointsElsewhere > 0) return "endpoints_elsewhere";
  if (unheard > 0) return "events_missing";
  if (silent) return "events_silent";
  if (unprocessed > 0) return "events_unprocessed";
  return null;
}

/** Payments taken in the window, at least this many, with no Stripe event heard in it, is silence (`eventsProblem`). */
export const SILENT_AFTER_PAYMENTS = 2;

/** Whether Stripe has gone quiet: enough payments taken in the window and not one event received in it. */
export function stripeSilent({ payments, events }: { payments: number; events: number }): boolean {
  return payments >= SILENT_AFTER_PAYMENTS && events === 0;
}

/** A component's state now: its newest check, or not measured. */
export function currentState(newest: { ok: boolean } | null): "ok" | "degraded" | "unknown" {
  return newest === null ? "unknown" : newest.ok ? "ok" : "degraded";
}

/** The page's headline: every measured component up and no open incident, else what is wrong. */
export function overallState(states: readonly ("ok" | "degraded" | "unknown")[], openIncidents: readonly { impact: IncidentImpact }[]): "ok" | "maintenance" | "degraded" | "major" {
  if (openIncidents.some((i) => i.impact === "major")) return "major";
  if (states.includes("degraded") || openIncidents.some((i) => i.impact === "minor")) return "degraded";
  if (openIncidents.some((i) => i.impact === "maintenance")) return "maintenance";
  return "ok";
}

/** An incident's words in a language: Norwegian where given, else English. */
export function incidentWords<T extends { title: string; titleNb: string | null }>(incident: T, lang: "en" | "nb"): string {
  return lang === "nb" && incident.titleNb ? incident.titleNb : incident.title;
}

export function updateWords<T extends { body: string; bodyNb: string | null }>(update: T, lang: "en" | "nb"): string {
  return lang === "nb" && update.bodyNb ? update.bodyNb : update.body;
}
