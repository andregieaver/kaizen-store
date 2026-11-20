import type { z } from "zod";

import type { AssignmentInput, ClientInput } from "./work-input";
import { assignmentInput, clientInput, taskInput, timeEntryInput } from "./work-input-schema";
import {
  ASSIGNMENT_RENAMES,
  type AssignmentFormValues,
  CLIENT_RENAMES,
  type ClientFormValues,
  type FormProblems,
  type TimeFormValues,
  hasProblems,
  issuesToProblems,
  readEntryDuration,
  readEstimate,
  readMoney,
  readWhole,
} from "./work-ui";

/**
 * The Work forms' payloads (docs/work.md 5.2, bloat review step 2.46): each form's fields as the input its schema checks, or the
 * problems to show. They run the schemas of work-input-schema.ts in the browser, so a screen imports them only where it saves a form;
 * the labels, durations, amounts and filters stay in work-ui.ts, which loads no zod.
 */

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
