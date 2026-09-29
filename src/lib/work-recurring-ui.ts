import type { z } from "zod";

import { parsePercentText } from "./work-calc";
import { formatDay, type Day } from "./work-dates";
import { recurringInvoiceInput } from "./work-input";
import { QUANTITY_MESSAGE, readQuantity } from "./work-invoice-ui";
import { hasProblems, issuesToProblems, readMoney, readWhole, type FormProblems } from "./work-ui";
import { nextOccurrences, type RecurrenceRule } from "./work-recurrence";

/**
 * What the repeating-invoice screens do with what is typed and what is shown (docs/work.md 5.2, 7.2
 * WP8): the form's fields as text become the input `recurringInvoiceInput` checks, the words for a
 * schedule and a period, and the span of time a period's invoice covers. Pure, so the form, the panel
 * and the server (which writes the period's service dates) agree.
 */

// --- What a period covers -----------------------------------------------------------------------------------

/**
 * The service period of the invoice made for `period`: from that day to the day before the next one
 * (a month's invoice for 15 Sep covers 15 Sep to 14 Oct), so the document says what it bills. The
 * last period of a template with an end date covers a whole period all the same. `to` is null only
 * when no next period can be found (which a valid rule never does).
 */
export function servicePeriod(rule: RecurrenceRule, period: Day): { from: Day; to: Day | null } {
  const [next] = nextOccurrences(rule, period, 1, null);
  if (!next) return { from: period, to: null };
  const [y, m, d] = next.split("-").map(Number);
  const before = new Date(Date.UTC(y, m - 1, d - 1));
  return { from: period, to: before.toISOString().slice(0, 10) };
}

// --- Words -----------------------------------------------------------------------------------------------------

export const PERIOD_LABELS = { week: "week", month: "month", year: "year" } as const;

/** "Every month", "Every 2 weeks", "Every 3 months". */
export function scheduleLabel(interval: number, period: keyof typeof PERIOD_LABELS): string {
  return interval === 1 ? `Every ${PERIOD_LABELS[period]}` : `Every ${interval} ${PERIOD_LABELS[period]}s`;
}

/** "Every month from 01/09/2026 until 01/09/2027". */
export function scheduleSummary(
  t: { recurrenceInterval: number; recurrencePeriod: keyof typeof PERIOD_LABELS; startDate: Day; endDate: Day | null },
  locale: string,
): string {
  return `${scheduleLabel(t.recurrenceInterval, t.recurrencePeriod)} from ${formatDay(t.startDate, locale)}${
    t.endDate ? ` until ${formatDay(t.endDate, locale)}` : ""
  }`;
}

// --- The form ----------------------------------------------------------------------------------------------------

/** The form's fields as typed. */
export type RecurringFormValues = {
  name: string;
  description: string;
  unit: string;
  quantity: string;
  price: string;
  discount: string;
  vatCategory: string;
  currency: string;
  interval: string;
  period: string;
  startDate: string;
  endDate: string;
  paymentDays: string;
  autoIssue: boolean;
};

const RENAMES: Record<string, string> = {
  quantityHundredths: "quantity",
  unitPriceMinor: "price",
  discountBp: "discount",
  recurrenceInterval: "interval",
  recurrencePeriod: "period",
};

/** The form as the input `recurringInvoiceInput` checks, or what is wrong with it. */
export function recurringPayload(
  values: RecurringFormValues,
  clientId: string,
  isActive = true,
):
  | { ok: true; input: z.input<typeof recurringInvoiceInput> }
  | { ok: false; problems: FormProblems } {
  const problems: FormProblems = { fields: {}, general: [] };
  const unit = values.unit === "hour" ? "hour" : "unit";
  const quantity = readQuantity(values.quantity, unit);
  if (quantity === null) problems.fields.quantity = QUANTITY_MESSAGE[unit];
  const price = readMoney(values.price, values.currency, "Enter a price such as 950 or 950,50.");
  if (!price.ok) problems.fields.price = price.message;
  else if (price.minor === null) problems.fields.price = "Enter the price without VAT.";
  const discount = values.discount.trim() === "" ? 0 : parsePercentText(values.discount);
  if (discount === null) problems.fields.discount = "Enter a discount from 0 to 100 %.";
  const days = readWhole(values.paymentDays);
  if (days !== null && Number.isNaN(days)) problems.fields.paymentDays = "Give the days as a whole number, or leave it empty.";
  const interval = readWhole(values.interval);
  const input = {
    clientId,
    name: values.name,
    description: values.description,
    unit,
    quantityHundredths: quantity ?? 0,
    unitPriceMinor: price.ok ? (price.minor ?? 0) : 0,
    discountBp: discount ?? 0,
    vatCategory: values.vatCategory,
    currency: values.currency,
    recurrenceInterval: interval === null || Number.isNaN(interval) ? 0 : interval,
    recurrencePeriod: values.period,
    startDate: values.startDate,
    endDate: values.endDate,
    paymentDays: days === null || Number.isNaN(days) ? null : days,
    autoIssue: values.autoIssue,
    isActive,
  } as z.input<typeof recurringInvoiceInput>;
  const parsed = recurringInvoiceInput.safeParse(input);
  if (!parsed.success) {
    const found = issuesToProblems(parsed.error, RENAMES);
    for (const [field, message] of Object.entries(found.fields)) problems.fields[field] ??= message;
    problems.general.push(...found.general);
  }
  if (hasProblems(problems) || !parsed.success) return { ok: false, problems };
  return { ok: true, input };
}
