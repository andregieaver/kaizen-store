import type { z } from "zod";

import { minorToDecimal, parseMoneyText } from "./work-calc";
import { isDay } from "./work-dates";
import { estimateStage, remainingMinutes, type EstimateStage } from "./work-estimate";
import {
  assignmentInput,
  clientInput,
  taskInput,
  timeEntryInput,
  type AssignmentInput,
  type ClientInput,
} from "./work-input";
import {
  MAX_ENTRY_MINUTES,
  MAX_ESTIMATE_MINUTES,
  formatDuration,
  parseDuration,
  type DurationResult,
} from "./work-time";

/**
 * What the Work screens do with what is typed and what is shown (docs/work.md
 * 5.2, 7.2 WP5/WP6): the forms' fields as text become the input the shared
 * schemas of `work-input.ts` check, the messages under the fields, the
 * estimate bar's colours, moving a task with the keyboard, and the filters of
 * the Time page read from its address. Pure, so the forms, the pages and the
 * tests agree; the money and time arithmetic stays in `work-calc.ts` and
 * `work-time.ts`.
 */

// --- Problems ---------------------------------------------------------------------

/** What a form found wrong: a message per field (by the input's name) and the messages that belong to none. */
export type FormProblems = { fields: Record<string, string>; general: string[] };

export const NO_PROBLEMS: FormProblems = { fields: {}, general: [] };

export const hasProblems = (problems: FormProblems): boolean =>
  Object.keys(problems.fields).length > 0 || problems.general.length > 0;

/** Every message, once, for a summary that is read out. */
export const allMessages = (problems: FormProblems): string[] => [
  ...new Set([...Object.values(problems.fields), ...problems.general]),
];

/** The schema's issues as messages per top-level field: the first for a field, and `general` for the rest. */
export function issuesToProblems(error: z.ZodError, rename: Record<string, string> = {}): FormProblems {
  const fields: Record<string, string> = {};
  const general: string[] = [];
  for (const issue of error.issues) {
    const head = issue.path[0];
    const name = typeof head === "string" ? (rename[head] ?? head) : null;
    if (name === null) general.push(issue.message);
    else if (!(name in fields)) fields[name] = issue.message;
  }
  return { fields, general };
}

// --- Durations and amounts as text --------------------------------------------------

const DURATION_MESSAGES: Record<Exclude<DurationResult, { ok: true }>["reason"], string> = {
  empty: "Enter a time such as 1h30, 1:30 or 90m.",
  unrecognised: "That is not a time. Try 1h30, 1:30, 1.5h or 90m.",
  zero: "Enter more than zero.",
  too_long: "That is more than one entry can be.",
};

/**
 * A duration typed by a person, as minutes, or the message to show. `bare`
 * says what a plain number means (an estimate is hours, logged time minutes).
 */
export function readDuration(
  text: string,
  options: { bare: "minutes" | "hours"; max: number; tooLong?: string },
): { ok: true; minutes: number } | { ok: false; message: string } {
  const result = parseDuration(text, { bare: options.bare, max: options.max });
  if (result.ok) return result;
  return {
    ok: false,
    message: result.reason === "too_long" && options.tooLong ? options.tooLong : DURATION_MESSAGES[result.reason],
  };
}

/** Time logged on one entry: a plain number is minutes, at most 24 hours. */
export const readEntryDuration = (text: string) =>
  readDuration(text, { bare: "minutes", max: MAX_ENTRY_MINUTES, tooLong: "One entry is at most 24 hours." });

/** An estimate: a plain number is hours. Blank is no estimate. */
export function readEstimate(text: string): { ok: true; minutes: number | null } | { ok: false; message: string } {
  if (text.trim() === "") return { ok: true, minutes: null };
  const result = readDuration(text, {
    bare: "hours",
    max: MAX_ESTIMATE_MINUTES,
    tooLong: "That is more than an estimate can be (100 000 hours).",
  });
  return result.ok ? result : { ok: false, message: result.message.replace("Enter a time", "Enter an estimate") };
}

/** An estimate as it is put back in its field, in a form `readEstimate` reads again ("2h 30m"). */
export const estimateField = (minutes: number | null | undefined): string =>
  minutes == null ? "" : formatDuration(minutes);

/** An amount typed in the currency's major units, as minor units; blank is none. */
export function readMoney(
  text: string,
  currency: string,
  message: string,
): { ok: true; minor: number | null } | { ok: false; message: string } {
  if (text.trim() === "") return { ok: true, minor: null };
  const minor = parseMoneyText(text, currency);
  return minor === null ? { ok: false, message } : { ok: true, minor };
}

/** An amount as it is put back in its field: "950.00". */
export const moneyField = (minor: number | null | undefined, currency: string): string =>
  minor == null ? "" : minorToDecimal(minor, currency);

/** A whole number typed in a field; blank is null, anything else that is not a whole number is NaN (the schema's message answers). */
export function readWhole(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

// --- The client form ------------------------------------------------------------------

/** The client form's fields as typed. The links to a customer are carried, not edited here. */
export type ClientFormValues = {
  name: string;
  legalName: string;
  organisationNumber: string;
  vatNumber: string;
  country: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  billingEmail: string;
  contactName: string;
  phone: string;
  locale: string;
  currency: string;
  hourlyRate: string;
  paymentDays: string;
  business: boolean;
  vatTreatment: string;
  usePrepaid: boolean;
  notes: string;
  customerCompanyId: string | null;
  customerId: string | null;
};

const CLIENT_RENAMES: Record<string, string> = {
  defaultHourlyRateMinor: "hourlyRate",
  billingAddress: "line1",
};

/** The client form as the input `clientInput` checks, or what is wrong with it. */
export function clientPayload(
  values: ClientFormValues,
): { ok: true; input: z.input<typeof clientInput>; parsed: ClientInput } | { ok: false; problems: FormProblems } {
  const problems: FormProblems = { fields: {}, general: [] };
  const rate = readMoney(values.hourlyRate, values.currency, "Enter an hourly rate such as 950 or 950,50.");
  if (!rate.ok) problems.fields.hourlyRate = rate.message;
  const days = readWhole(values.paymentDays);
  if (days !== null && Number.isNaN(days)) problems.fields.paymentDays = "Give the days to pay as a whole number.";
  const anyAddress = [values.line1, values.line2, values.postalCode, values.city].some((part) => part.trim() !== "");
  const input: z.input<typeof clientInput> = {
    name: values.name,
    legalName: values.legalName,
    organisationNumber: values.organisationNumber,
    vatNumber: values.vatNumber,
    country: values.country || null,
    billingAddress: anyAddress
      ? { line1: values.line1, line2: values.line2, postalCode: values.postalCode, city: values.city }
      : null,
    billingEmail: values.billingEmail,
    contactName: values.contactName,
    phone: values.phone,
    locale: values.locale,
    currency: values.currency,
    defaultHourlyRateMinor: rate.ok ? rate.minor : null,
    paymentDays: days === null || Number.isNaN(days) ? null : days,
    business: values.business,
    vatTreatment: values.business ? (values.vatTreatment as ClientInput["vatTreatment"]) : "domestic",
    customerCompanyId: values.customerCompanyId,
    customerId: values.customerId,
    usePrepaid: values.usePrepaid,
    notes: values.notes,
  };
  const parsed = clientInput.safeParse(input);
  if (!parsed.success) {
    const found = issuesToProblems(parsed.error, CLIENT_RENAMES);
    for (const [field, message] of Object.entries(found.fields)) problems.fields[field] ??= message;
    problems.general.push(...found.general);
  }
  if (hasProblems(problems) || !parsed.success) return { ok: false, problems };
  return { ok: true, input, parsed: parsed.data };
}

// --- The assignment form ----------------------------------------------------------------

export type AssignmentFormValues = {
  clientId: string;
  name: string;
  status: string;
  billingType: string;
  hourlyRate: string;
  fixedAmount: string;
  estimate: string;
  startDate: string;
  endDate: string;
  alertMinutes: string;
  alertPopup: boolean;
  alertSound: boolean;
};

const ASSIGNMENT_RENAMES: Record<string, string> = {
  hourlyRateMinor: "hourlyRate",
  fixedAmountMinor: "fixedAmount",
  estimatedMinutes: "estimate",
  estimateAlertMinutes: "alertMinutes",
  estimateAlertPopup: "alertPopup",
  estimateAlertSound: "alertSound",
};

/** The assignment form as the input `assignmentInput` checks, or what is wrong with it. `currency` is the client's. */
export function assignmentPayload(
  values: AssignmentFormValues,
  currency: string,
):
  | { ok: true; input: z.input<typeof assignmentInput>; parsed: AssignmentInput }
  | { ok: false; problems: FormProblems } {
  const problems: FormProblems = { fields: {}, general: [] };
  const fixed = values.billingType === "fixed_fee";
  const rate = readMoney(values.hourlyRate, currency, "Enter an hourly rate such as 950 or 950,50.");
  if (!rate.ok) problems.fields.hourlyRate = rate.message;
  const fee = readMoney(values.fixedAmount, currency, "Enter a fee such as 12 000 or 12 000,50.");
  if (!fee.ok) problems.fields.fixedAmount = fee.message;
  const estimate = readEstimate(values.estimate);
  if (!estimate.ok) problems.fields.estimate = estimate.message;
  const alert = readWhole(values.alertMinutes);
  if (alert !== null && Number.isNaN(alert))
    problems.fields.alertMinutes = "Give the minutes as a whole number, or leave it empty.";
  const input: z.input<typeof assignmentInput> = {
    clientId: values.clientId,
    name: values.name,
    status: values.status as AssignmentInput["status"],
    billingType: values.billingType as AssignmentInput["billingType"],
    // A fixed fee has no hourly rate and an hourly assignment no fee, whatever was typed before switching.
    hourlyRateMinor: fixed ? null : rate.ok ? rate.minor : null,
    fixedAmountMinor: fixed ? (fee.ok ? fee.minor : null) : null,
    estimatedMinutes: estimate.ok ? estimate.minutes : null,
    startDate: values.startDate,
    endDate: values.endDate,
    estimateAlertMinutes: alert === null || Number.isNaN(alert) ? null : alert,
    estimateAlertPopup: values.alertPopup,
    estimateAlertSound: values.alertSound,
  };
  const parsed = assignmentInput.safeParse(input);
  if (!parsed.success) {
    const found = issuesToProblems(parsed.error, ASSIGNMENT_RENAMES);
    for (const [field, message] of Object.entries(found.fields)) problems.fields[field] ??= message;
    problems.general.push(...found.general);
  }
  if (hasProblems(problems) || !parsed.success) return { ok: false, problems };
  return { ok: true, input, parsed: parsed.data };
}

// --- Tasks -----------------------------------------------------------------------------------

/** A new task: its name and, if typed, an estimate (a plain number is hours). */
export function taskPayload(
  assignmentId: string,
  title: string,
  estimateText: string,
): { ok: true; input: z.input<typeof taskInput> } | { ok: false; problems: FormProblems } {
  const problems: FormProblems = { fields: {}, general: [] };
  const estimate = readEstimate(estimateText);
  if (!estimate.ok) problems.fields.estimate = estimate.message;
  const input = {
    assignmentId,
    title,
    status: "open" as const,
    estimatedMinutes: estimate.ok ? estimate.minutes : null,
  };
  const parsed = taskInput.safeParse(input);
  if (!parsed.success) {
    const found = issuesToProblems(parsed.error, { estimatedMinutes: "estimate" });
    for (const [field, message] of Object.entries(found.fields)) problems.fields[field] ??= message;
    problems.general.push(...found.general);
  }
  return hasProblems(problems) ? { ok: false, problems } : { ok: true, input };
}

/** Moves one id in an ordered list by `delta` places (clamped), returning a new list; the same list when nothing moves. */
export function moveId<T>(ids: readonly T[], id: T, delta: number): T[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// --- Time entries ------------------------------------------------------------------------------

export type TimeFormValues = {
  assignmentId: string;
  taskId: string;
  workDate: string;
  duration: string;
  note: string;
  billable: boolean;
};

/** The log-time form as the input `timeEntryInput` checks, or what is wrong with it. */
export function timePayload(
  values: TimeFormValues,
): { ok: true; input: z.input<typeof timeEntryInput> } | { ok: false; problems: FormProblems } {
  const problems: FormProblems = { fields: {}, general: [] };
  const duration = readEntryDuration(values.duration);
  if (!duration.ok) problems.fields.duration = duration.message;
  if (!values.assignmentId) problems.fields.assignmentId = "Choose the assignment the time is for.";
  const input = {
    assignmentId: values.assignmentId,
    taskId: values.taskId || null,
    workDate: values.workDate,
    minutes: duration.ok ? duration.minutes : 0,
    billable: values.billable,
    note: values.note,
  };
  if (!hasProblems(problems)) {
    const parsed = timeEntryInput.safeParse(input);
    if (!parsed.success) {
      const found = issuesToProblems(parsed.error, { minutes: "duration", workDate: "workDate" });
      Object.assign(problems.fields, found.fields);
      problems.general.push(...found.general);
    }
  }
  return hasProblems(problems) ? { ok: false, problems } : { ok: true, input };
}

// --- Who may change an entry ---------------------------------------------------------

/** What the viewer may do with an entry: owners any, others their own; time on an invoice is fixed. */
export function entryAccess(
  entry: { accountId: string; invoiceStatus: "draft" | "sent" | "paid" | "void" | null; locked: boolean },
  viewer: { accountId: string; owner: boolean },
): { note: boolean; delete: boolean; why: string | null } {
  const mine = viewer.owner || entry.accountId === viewer.accountId;
  if (!mine) return { note: false, delete: false, why: "Logged by someone else" };
  if (entry.locked) return { note: false, delete: false, why: "On an issued invoice" };
  if (entry.invoiceStatus === "draft") return { note: true, delete: false, why: "On a draft invoice" };
  return { note: true, delete: true, why: null };
}

// --- Labels and the estimate bar ------------------------------------------------------------------------

export const ASSIGNMENT_STATUS_LABELS = { active: "Active", paused: "Paused", done: "Done" } as const;

export const BILLING_TYPE_LABELS = { hourly: "Hourly", fixed_fee: "Fixed fee" } as const;

/** What is left of an estimate, in words: "1h 30m left", "15m over", "Used up". */
export function remainingLabel(remaining: number | null): string {
  if (remaining === null) return "";
  if (remaining === 0) return "Used up";
  return remaining > 0 ? `${formatDuration(remaining)} left` : `${formatDuration(-remaining)} over`;
}

/**
 * The stage an estimate is at, for colours: `estimateStage`, except that an
 * estimate used up always shows as over, also when the owner switched the
 * warnings off (they only decide what is said aloud, not what is true).
 */
export function stageOf(remaining: number | null, thresholdMinutes: number | null): EstimateStage {
  return remaining !== null && remaining <= 0 ? "over" : estimateStage(remaining, thresholdMinutes);
}

export type ProgressView = {
  stage: EstimateStage;
  /** The bar's fill, 0 to 100 (an estimate that is over shows a full bar). */
  fill: number;
  /** How much is used, as a whole percentage; over 100 when over. Null without an estimate. */
  percent: number | null;
  remaining: number | null;
  label: string;
};

/**
 * The bar of logged time against an estimate, and the stage it is at: `near`
 * once less than the warning threshold is left, `over` when used up
 * (`estimateStage`). Without an estimate there is nothing to measure.
 */
export function progressView(
  loggedMinutes: number,
  estimatedMinutes: number | null,
  thresholdMinutes: number | null,
): ProgressView {
  const remaining = remainingMinutes(estimatedMinutes, loggedMinutes);
  const stage = stageOf(remaining, thresholdMinutes);
  if (estimatedMinutes == null || estimatedMinutes <= 0) {
    return { stage: "ok", fill: 0, percent: null, remaining: null, label: "" };
  }
  const percent = Math.floor((loggedMinutes * 100 * 2 + estimatedMinutes) / (2 * estimatedMinutes));
  return { stage, fill: Math.max(0, Math.min(100, percent)), percent, remaining, label: remainingLabel(remaining) };
}

/** The bar's colour and the label's, per stage. Colours carry no meaning alone: the label always says it too. */
export const STAGE_STYLES: Record<EstimateStage, { bar: string; text: string; name: string }> = {
  ok: { bar: "bg-emerald-600", text: "text-muted", name: "On track" },
  near: { bar: "bg-amber-500", text: "text-amber-800 dark:text-amber-300", name: "Nearly used up" },
  over: { bar: "bg-red-600", text: "text-red-700 dark:text-red-400", name: "Over the estimate" },
};

// --- The Time page's filters --------------------------------------------------------------------------

export type TimeBilling = "all" | "unbilled" | "on_draft" | "invoiced";
export type TimeBillable = "all" | "yes" | "no";

export const TIME_BILLING_OPTIONS: { value: TimeBilling; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "unbilled", label: "Not on an invoice" },
  { value: "on_draft", label: "On a draft invoice" },
  { value: "invoiced", label: "Invoiced" },
];

export type TimeFilters = {
  clientId: string;
  assignmentId: string;
  /** Who worked; owners only, and always the person's own for others. */
  accountId: string;
  from: string;
  to: string;
  billable: TimeBillable;
  billing: TimeBilling;
  query: string;
};

export const EMPTY_TIME_FILTERS: TimeFilters = {
  clientId: "",
  assignmentId: "",
  accountId: "",
  from: "",
  to: "",
  billable: "all",
  billing: "all",
  query: "",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/** The filters an address asks for. Anything that is not what a field takes is dropped, so a hand-edited address never breaks the page. */
export function parseTimeFilters(params: Params): TimeFilters {
  const id = (name: string) => {
    const value = first(params[name]).trim();
    return UUID.test(value) ? value : "";
  };
  const day = (name: string) => {
    const value = first(params[name]).trim();
    return isDay(value) ? value : "";
  };
  const billable = first(params.billable);
  const billing = first(params.billing);
  let from = day("from");
  let to = day("to");
  if (from && to && to < from) [from, to] = [to, from];
  return {
    clientId: id("client"),
    assignmentId: id("assignment"),
    accountId: id("person"),
    from,
    to,
    billable: billable === "yes" || billable === "no" ? billable : "all",
    billing: billing === "unbilled" || billing === "on_draft" || billing === "invoiced" ? billing : "all",
    query: first(params.q).trim().slice(0, 100),
  };
}

/** The filters as an address's query (empty parts left out), for links that keep them. */
export function timeFilterQuery(filters: TimeFilters, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  const put = (key: string, value: string) => {
    if (value) query.set(key, value);
  };
  put("client", filters.clientId);
  put("assignment", filters.assignmentId);
  put("person", filters.accountId);
  put("from", filters.from);
  put("to", filters.to);
  if (filters.billable !== "all") query.set("billable", filters.billable);
  if (filters.billing !== "all") query.set("billing", filters.billing);
  put("q", filters.query);
  for (const [key, value] of Object.entries(extra)) put(key, value);
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** How many filters are set, for "3 filters" and the clear link. */
export const activeFilterCount = (filters: TimeFilters): number =>
  (Object.keys(EMPTY_TIME_FILTERS) as (keyof TimeFilters)[]).filter((key) => filters[key] !== EMPTY_TIME_FILTERS[key])
    .length;

// --- The client list's filter -----------------------------------------------------------------------------

export type ClientShow = "active" | "archived" | "all";

/** The client list's address: `?show=archived&q=acme`. */
export function parseClientListParams(params: Params): { show: ClientShow; query: string } {
  const show = first(params.show);
  return {
    show: show === "archived" || show === "all" ? show : "active",
    query: first(params.q).trim().slice(0, 100),
  };
}

/** "3 active assignments · 12h 30m unbilled", the line under a client in the list. */
export function clientFigures(client: { activeAssignments: number; unbilledMinutes: number }): string {
  const assignments =
    client.activeAssignments === 0
      ? "No active assignments"
      : `${client.activeAssignments} active ${client.activeAssignments === 1 ? "assignment" : "assignments"}`;
  const unbilled =
    client.unbilledMinutes > 0 ? `${formatDuration(client.unbilledMinutes)} unbilled` : "nothing unbilled";
  return `${assignments} · ${unbilled}`;
}
