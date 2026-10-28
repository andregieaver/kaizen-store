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
