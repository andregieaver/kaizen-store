/**
 * A task's estimate against the time spent on it, and when to say something
 * (docs/work.md 1.8, from Life's `estimate-alerts.ts`).
 *
 * Pure, so the row that shows "1,5 h left", the page that raises the warning,
 * the action that stores the settings and the tests all agree on the
 * arithmetic without importing each other. Estimates are integer minutes
 * here (Life kept hours with two decimals).
 */

/** How far ahead of the estimate the first warning comes, unless changed. */
export const DEFAULT_ESTIMATE_ALERT_MINUTES = 10;
export const MIN_ESTIMATE_ALERT_MINUTES = 1;
export const MAX_ESTIMATE_ALERT_MINUTES = 480;

export type EstimateAlertSettings = {
  /** Null: no warnings. */
  minutes: number | null;
  popup: boolean;
  sound: boolean;
};

export const DEFAULT_ESTIMATE_ALERTS: EstimateAlertSettings = {
  minutes: DEFAULT_ESTIMATE_ALERT_MINUTES,
  popup: true,
  sound: false,
};

/**
 * Minutes left on an estimate after `spentMinutes`. Negative when over. Null
 * when the task has no estimate: there is nothing to be left of.
 */
export function remainingMinutes(estimatedMinutes: number | null | undefined, spentMinutes: number): number | null {
  if (estimatedMinutes == null || !Number.isFinite(estimatedMinutes)) return null;
  return Math.round(estimatedMinutes) - spentMinutes;
}

export type EstimateStage = "ok" | "near" | "over";

/**
 * Which warning, if any, applies right now.
 *
 *  - over: the estimate is used up (remaining <= 0);
 *  - near: less than the threshold left;
 *  - ok: otherwise, or no estimate, or warnings off.
 *
 * "near" is strictly less than the threshold, so a 10-minute threshold on a
 * task with exactly 10 minutes left has not fired yet: it fires on the next
 * minute, which is what "less than" means.
 */
export function estimateStage(remaining: number | null, thresholdMinutes: number | null): EstimateStage {
  if (remaining == null || thresholdMinutes == null) return "ok";
  if (remaining <= 0) return "over";
  if (remaining < thresholdMinutes) return "near";
  return "ok";
}

/** Whole minutes a running timer has run; the fraction of a minute is not counted (Life's alert rule). */
export const elapsedWholeMinutes = (elapsedMs: number): number => Math.max(0, Math.floor(elapsedMs / 60_000));

/**
 * The warning to raise now, if any: the stage the running timer has reached
 * on a task with an estimate, unless it has been raised already for this
 * timer. Armed only while a timer runs on a task with an estimate, warnings
 * are on and a popup or a sound is wanted. Time spent counts the minutes
 * already logged on the task, billable or not, plus the whole minutes of
 * the running timer. Each stage fires once per running timer, so the caller
 * remembers `fired` (Life kept it in `localStorage`, `timerAlertStorageKey`).
 * Jumping straight to "over" raises only that one.
 */
export function alertToRaise(args: {
  estimatedMinutes: number | null;
  loggedMinutes: number;
  elapsedMs: number;
  settings: EstimateAlertSettings;
  fired: ReadonlySet<EstimateStage>;
}): "near" | "over" | null {
  const { settings } = args;
  if (settings.minutes == null || (!settings.popup && !settings.sound)) return null;
  const stage = estimateStage(
    remainingMinutes(args.estimatedMinutes, args.loggedMinutes + elapsedWholeMinutes(args.elapsedMs)),
    settings.minutes,
  );
  if (stage === "ok" || args.fired.has(stage)) return null;
  return stage;
}

/** Where a page remembers which stages it has raised for a timer. */
export const timerAlertStorageKey = (timerId: string): string => `work-estimate-alert:${timerId}`;

/** Notes in the chime (Web Audio): two rising notes for "near", three for "over". */
export const ALERT_CHIME_NOTES: Record<"near" | "over", number> = { near: 2, over: 3 };

/** Alert minutes as typed: blank switches warnings off; otherwise a whole number from 1 to 480. Undefined if it is not that. */
export function parseEstimateAlertMinutes(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n >= MIN_ESTIMATE_ALERT_MINUTES && n <= MAX_ESTIMATE_ALERT_MINUTES ? n : undefined;
}

/**
 * How much of an estimate is used, as a whole percentage (rounded half up):
 * null without an estimate. Over 100 when over. Exact where Life first
 * rounded the hours to two decimals.
 */
export function utilisationPercent(loggedMinutes: number, estimatedMinutes: number | null | undefined): number | null {
  if (!estimatedMinutes || estimatedMinutes <= 0) return null;
  return Math.floor((loggedMinutes * 100 * 2 + estimatedMinutes) / (2 * estimatedMinutes));
}
