/**
 * Saved reports emailed on a schedule (wave 12 unit A, D395): when a schedule is due on the store's clock, and the form read into a
 * schedule. Pure and without zod, so the Reports page uses it as the server does. Writing and sending are `src/server/report-schedules.ts`.
 */

export const REPORT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

/** Schedules a store may keep. */
export const REPORT_SCHEDULES_MAX = 10;
/** People one schedule goes to. */
export const REPORT_RECIPIENTS_MAX = 10;
/** Rows an email shows; the attached CSV holds them all. */
export const REPORT_EMAIL_ROWS = 25;
/** A monthly schedule's day is at most the 28th, so every month has it. */
export const MONTH_DAY_MAX = 28;

export type ReportScheduleInput = {
  reportId: string;
  frequency: ReportFrequency;
  /** 1 (Monday) to 7, for a weekly schedule only. */
  weekday: number | null;
  /** 1 to 28, for a monthly schedule only. */
  monthDay: number | null;
  /** 0 to 23 on the store's clock. */
  hour: number;
  /** Account ids of the store's members it goes to. */
  recipients: string[];
  enabled: boolean;
};

export type ScheduleProblem = "report" | "frequency" | "day" | "hour" | "recipients";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const whole = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : null;
};

/** What the form sent, read into a schedule, or the first thing wrong with it. */
export function readScheduleInput(raw: unknown): { ok: true; input: ReportScheduleInput } | { ok: false; problem: ScheduleProblem } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reportId = typeof r.reportId === "string" ? r.reportId : "";
  if (!UUID.test(reportId)) return { ok: false, problem: "report" };
  const frequency = REPORT_FREQUENCIES.find((f) => f === r.frequency);
  if (!frequency) return { ok: false, problem: "frequency" };
  const weekday = frequency === "weekly" ? whole(r.weekday) : null;
  const monthDay = frequency === "monthly" ? whole(r.monthDay) : null;
  if (frequency === "weekly" && (weekday === null || weekday < 1 || weekday > 7)) return { ok: false, problem: "day" };
  if (frequency === "monthly" && (monthDay === null || monthDay < 1 || monthDay > MONTH_DAY_MAX)) return { ok: false, problem: "day" };
  const hour = whole(r.hour);
  if (hour === null || hour < 0 || hour > 23) return { ok: false, problem: "hour" };
  const recipients = [...new Set(Array.isArray(r.recipients) ? r.recipients.filter((x): x is string => typeof x === "string" && UUID.test(x)) : [])];
  if (recipients.length === 0 || recipients.length > REPORT_RECIPIENTS_MAX) return { ok: false, problem: "recipients" };
  return { ok: true, input: { reportId, frequency, weekday, monthDay, hour, recipients, enabled: r.enabled !== false } };
}

/** A local date and time on the store's clock: `YYYY-MM-DD`, 1 (Monday) to 7, and the hour. */
export type LocalClock = { date: string; weekday: number; hour: number };

/** Whether a schedule sends now: on its day, from its hour, and not yet today. */
export function scheduleDue(
  schedule: Pick<ReportScheduleInput, "frequency" | "weekday" | "monthDay" | "hour" | "enabled"> & { lastRunOn: string | null },
  local: LocalClock,
): boolean {
  if (!schedule.enabled || local.hour < schedule.hour || schedule.lastRunOn === local.date) return false;
  if (schedule.frequency === "weekly") return schedule.weekday === local.weekday;
  if (schedule.frequency === "monthly") return schedule.monthDay === Number(local.date.slice(8, 10));
  return true;
}
