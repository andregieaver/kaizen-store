import { z } from "zod";

import { ibanValid } from "./dac7";
import { isCurrency } from "./money";
import { MAX_DISCOUNT_BP, MAX_QUANTITY_HUNDREDTHS, MAX_UNIT_PRICE_MINOR, lineDescription } from "./work-calc";
import { DEFAULT_PAYMENT_DAYS, MAX_PAYMENT_DAYS, MIN_PAYMENT_DAYS } from "./work-dates";
import { MAX_ESTIMATE_ALERT_MINUTES, MIN_ESTIMATE_ALERT_MINUTES } from "./work-estimate";
import { RECURRENCE_PERIODS } from "./work-recurrence";
import { MAX_ENTRY_MINUTES, MAX_ESTIMATE_MINUTES, TIME_NOTE_MAX } from "./work-time";
import { VAT_LINE_CATEGORIES, VAT_TREATMENTS, normaliseVatNumber } from "./work-vat";

/**
 * What the Work forms send, shared by the browser (which builds it and shows
 * the messages) and the server (which checks it again before anything is
 * written), as the product editor's `productInput` is (docs/work.md 4.2, 7.2
 * WP2). Field names are the columns of 4.2 in camelCase; money is integer
 * minor units and time integer minutes, never text. Typed text ("1h30",
 * "1 249,50") is read first with `parseDuration`, `parseMoneyText` and
 * `parseQuantityText`, so these schemas only ever see numbers.
 *
 * What a document freezes (numbers, seller and buyer snapshots, VAT rates,
 * totals) is never an input: the server works those out.
 */

const text = (max: number) => z.string().trim().max(max);
/** Text that may be left out or empty: "", null and undefined all become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

const int = (min: number, max: number, message: string) => z.number().int(message).min(min, message).max(max, message);

const day = (message: string) => z.iso.date(message);
const optionalDay = (message: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null)
    .pipe(z.iso.date(message).nullable());

const uuid = z.uuid();
const optionalUuid = z
  .string()
  .nullish()
  .transform((value) => value || null)
  .pipe(z.uuid().nullable());

const currency = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine(isCurrency, "Choose a currency.");

const country = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, "Choose a country."));

/** A language tag such as `nb`, `nb-NO` or `sv-SE`: the language of a client's documents. */
const locale = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Choose a language.");

const moneyMinor = (message: string) => int(0, MAX_UNIT_PRICE_MINOR, message);
const rate = (message: string) => moneyMinor(message).nullable();
const paymentDays = int(
  MIN_PAYMENT_DAYS,
  MAX_PAYMENT_DAYS,
  `Payment terms are ${MIN_PAYMENT_DAYS} to ${MAX_PAYMENT_DAYS} days.`,
);
const alertMinutes = int(
  MIN_ESTIMATE_ALERT_MINUTES,
  MAX_ESTIMATE_ALERT_MINUTES,
  `Warn ${MIN_ESTIMATE_ALERT_MINUTES} to ${MAX_ESTIMATE_ALERT_MINUTES} minutes before, or switch warnings off.`,
);

/** Where the second day may not come before the first. */
function notBefore<T extends Record<string, unknown>>(from: keyof T, to: keyof T, message: string) {
  return (value: T, ctx: z.RefinementCtx) => {
    const a = value[from];
    const b = value[to];
    if (typeof a === "string" && typeof b === "string" && b < a)
      ctx.addIssue({ code: "custom", path: [to as string], message });
  };
}

// --- Clients -------------------------------------------------------------------

export const CLIENT_NAME_MAX = 120;
export const NOTES_MAX = 4000;

/** The billing address as it is printed under Bill to; the country is its own field. */
export const billingAddressInput = z.object({
  line1: text(200),
  line2: text(200).default(""),
  postalCode: text(20),
  city: text(100),
});
export type BillingAddress = z.infer<typeof billingAddressInput>;

/** An address as one text for the readiness check and the document: `Street, 0150 Oslo, NO`. */
export function addressText(address: Partial<BillingAddress> | null | undefined, countryCode?: string | null): string {
  if (!address) return "";
  const town = [address.postalCode, address.city]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return [address.line1, address.line2, town, countryCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export const clientInput = z
  .object({
    name: text(CLIENT_NAME_MAX).min(1, "Give the client a name."),
    legalName: optionalText(200),
    organisationNumber: optionalText(40),
    vatNumber: optionalText(40).transform((value) => (value ? normaliseVatNumber(value) : null)),
    country: country.nullish().transform((value) => value ?? null),
    billingAddress: billingAddressInput.nullish().transform((value) => value ?? null),
    billingEmail: z
      .string()
      .trim()
      .max(200)
      .nullish()
      .transform((value) => value || null)
      .pipe(z.email("That email address is not right.").nullable()),
    contactName: optionalText(120),
    phone: optionalText(40),
    locale: locale.default("en"),
    currency,
    defaultHourlyRateMinor: rate("Enter an hourly rate of 0 or more.")
      .nullish()
      .transform((value) => value ?? null),
    paymentDays: paymentDays.nullish().transform((value) => value ?? null),
    /** A business, as opposed to a private customer: only businesses may have reverse charge (4.5). */
    business: z.boolean().default(true),
    vatTreatment: z.enum(VAT_TREATMENTS).default("domestic"),
    customerCompanyId: optionalUuid,
    customerId: optionalUuid,
    /** Draw billable time from the client's prepaid hours first (6.2). */
    usePrepaid: z.boolean().default(true),
    notes: optionalText(NOTES_MAX),
  })
  .superRefine((client, ctx) => {
    if (!client.business && client.vatTreatment !== "domestic") {
      ctx.addIssue({
        code: "custom",
        path: ["vatTreatment"],
        message: "A private customer is always charged VAT at the domestic rate.",
      });
    }
  });
export type ClientInput = z.infer<typeof clientInput>;

// --- Assignments, tasks, time ----------------------------------------------------

export const ASSIGNMENT_STATUSES = ["active", "paused", "done"] as const;
export const BILLING_TYPES = ["hourly", "fixed_fee"] as const;

const estimateMinutes = int(1, MAX_ESTIMATE_MINUTES, "Enter an estimate of at least a minute.");

export const assignmentInput = z
  .object({
    clientId: uuid,
    name: text(200).min(1, "Give the assignment a name."),
    status: z.enum(ASSIGNMENT_STATUSES).default("active"),
    billingType: z.enum(BILLING_TYPES).default("hourly"),
    /** Its own hourly rate; blank uses the client's default. */
    hourlyRateMinor: rate("Enter an hourly rate of 0 or more.")
      .nullish()
      .transform((value) => value ?? null),
    fixedAmountMinor: rate("Enter a fee of 0 or more.")
      .nullish()
      .transform((value) => value ?? null),
    estimatedMinutes: estimateMinutes.nullish().transform((value) => value ?? null),
    startDate: optionalDay("Give the start as a date."),
    endDate: optionalDay("Give the end as a date."),
    /** Minutes before the estimate to warn; null switches warnings off (Life's rule). */
    estimateAlertMinutes: alertMinutes.nullable().default(null),
    estimateAlertPopup: z.boolean().default(true),
    estimateAlertSound: z.boolean().default(false),
  })
  .superRefine((a, ctx) => {
    if (a.billingType === "fixed_fee" && !a.fixedAmountMinor) {
      ctx.addIssue({ code: "custom", path: ["fixedAmountMinor"], message: "A fixed fee needs an amount." });
    }
    notBefore<{ startDate: string | null; endDate: string | null }>(
      "startDate",
      "endDate",
      "The end comes before the start.",
    )(a, ctx);
  });
export type AssignmentInput = z.infer<typeof assignmentInput>;

export const taskInput = z.object({
  assignmentId: uuid,
  title: text(200).min(1, "Give the task a name."),
  status: z.enum(["open", "done"]).default("open"),
  estimatedMinutes: estimateMinutes.nullish().transform((value) => value ?? null),
});
export type TaskInput = z.infer<typeof taskInput>;

export const timeEntryInput = z.object({
  assignmentId: uuid,
  taskId: optionalUuid,
  workDate: day("Give the date the work was done."),
  minutes: int(1, MAX_ENTRY_MINUTES, "Log between 1 minute and 24 hours."),
  billable: z.boolean().default(true),
  note: optionalText(TIME_NOTE_MAX),
});
export type TimeEntryInput = z.infer<typeof timeEntryInput>;

/** The only thing changed on an entry after it is logged: its note (changing minutes means delete and log again). */
export const timeEntryNoteInput = z.object({ note: optionalText(TIME_NOTE_MAX) });

export const startTimerInput = z.object({ assignmentId: uuid, taskId: optionalUuid });
export type StartTimerInput = z.infer<typeof startTimerInput>;

// --- Invoices ---------------------------------------------------------------------

export const MAX_INVOICE_LINES = 300;
export const LINE_DESCRIPTION_MAX = 500;
export const REFERENCE_MAX = 100;
export const LINE_UNITS = ["hour", "unit"] as const;

export const invoiceLineInput = z.object({
  /** Kept when the line already exists, so the editor's saves are upserts by id and pairings survive. */
  id: uuid.nullish().transform((value) => value ?? null),
  assignmentId: optionalUuid,
  taskId: optionalUuid,
  description: text(LINE_DESCRIPTION_MAX).transform(lineDescription),
  unit: z.enum(LINE_UNITS).default("hour"),
  quantityHundredths: int(0, MAX_QUANTITY_HUNDREDTHS, "Enter a quantity up to 100 000 hours."),
  unitPriceMinor: moneyMinor("Enter a price of 0 or more, up to 10 000 000."),
  discountBp: int(0, MAX_DISCOUNT_BP, "A discount is 0 to 100 %."),
  /** A category, never a free percentage: the rate is taken from the country's rates when the invoice is issued. */
  vatCategory: z.enum(VAT_LINE_CATEGORIES).default("standard"),
  /** Set when the owner typed or rounded the quantity, so logged time no longer rewrites it. */
  quantityManual: z.boolean().default(false),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

const invoiceHeaderShape = {
  clientId: uuid,
  assignmentId: optionalUuid,
  currency,
  /** Overrides the client's and the store's payment terms. */
  paymentDays: paymentDays.nullish().transform((value) => value ?? null),
  serviceFrom: optionalDay("Give the start of the period as a date."),
  serviceTo: optionalDay("Give the end of the period as a date."),
  notes: optionalText(NOTES_MAX),
  /** The client's own reference, such as an order number; printed on the invoice. */
  reference: optionalText(REFERENCE_MAX),
};

/** A draft's header. Its number, dates and totals are the server's (`issue_work_invoice`). */
export const invoiceDraftInput = z
  .object(invoiceHeaderShape)
  .superRefine(
    notBefore<{ serviceFrom: string | null; serviceTo: string | null }>(
      "serviceFrom",
      "serviceTo",
      "The period ends before it starts.",
    ),
  );
export type InvoiceDraftInput = z.infer<typeof invoiceDraftInput>;

/** A draft saved whole: the header and every line, in order (the editor's 600 ms autosave sends this). */
export const invoiceInput = z
  .object({
    ...invoiceHeaderShape,
    lines: z.array(invoiceLineInput).max(MAX_INVOICE_LINES, `An invoice has at most ${MAX_INVOICE_LINES} lines.`),
  })
  .superRefine((invoice, ctx) => {
    notBefore<{ serviceFrom: string | null; serviceTo: string | null }>(
      "serviceFrom",
      "serviceTo",
      "The period ends before it starts.",
    )(invoice, ctx);
    const seen = new Set<string>();
    invoice.lines.forEach((line, index) => {
      if (line.id === null) return;
      if (seen.has(line.id))
        ctx.addIssue({ code: "custom", path: ["lines", index, "id"], message: "A line appears twice." });
      seen.add(line.id);
    });
  });
export type InvoiceInput = z.infer<typeof invoiceInput>;

/** Issuing: the day is today in the store's time zone unless the owner backdates it within what settings allow (4.4). */
export const issueInvoiceInput = z.object({
  invoiceId: uuid,
  issuedOn: optionalDay("Give the issue date as a date."),
  /** The owner has seen that the date is earlier than the previous document's and confirms. */
  confirmEarlierDate: z.boolean().default(false),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceInput>;

// --- Recurring templates ----------------------------------------------------------

export const recurringInvoiceInput = z
  .object({
    clientId: uuid,
    name: text(120).min(1, "Give the template a name."),
    /** The line's text; the name when empty. */
    description: optionalText(LINE_DESCRIPTION_MAX),
    unit: z.enum(LINE_UNITS).default("unit"),
    quantityHundredths: int(1, MAX_QUANTITY_HUNDREDTHS, "Enter a quantity of at least 0.01."),
    /** Net, unlike Life's templates, which were VAT-inclusive. */
    unitPriceMinor: moneyMinor("Enter a price of 0 or more, up to 10 000 000."),
    discountBp: int(0, MAX_DISCOUNT_BP, "A discount is 0 to 100 %.").default(0),
    vatCategory: z.enum(VAT_LINE_CATEGORIES).default("standard"),
    currency,
    recurrenceInterval: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    recurrencePeriod: z.enum(RECURRENCE_PERIODS),
    startDate: day("Give the first period as a date."),
    endDate: optionalDay("Give the end as a date."),
    paymentDays: paymentDays.nullish().transform((value) => value ?? null),
    /** Issue and email each invoice by itself. Off unless switched on (open question 2). */
    autoIssue: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine(
    notBefore<{ startDate: string; endDate: string | null }>("startDate", "endDate", "The end comes before the start."),
  );
export type RecurringInvoiceInput = z.infer<typeof recurringInvoiceInput>;

// --- Settings ---------------------------------------------------------------------

const bankAccount = z
  .string()
  .trim()
  .max(60)
  .nullish()
  .transform((value) => value || null)
  .refine((value) => {
    if (!value) return true;
    const compact = normaliseVatNumber(value);
    return !/^[A-Z]{2}\d{2}/.test(compact) || ibanValid(compact);
  }, "The IBAN is not right. Check it against your bank's.");

/** Work settings (`work_settings`): VAT registration, payment details and defaults. Numbering is `numberSeriesInput`. */
export const workSettingsInput = z.object({
  vatRegistered: z.boolean(),
  vatNumber: optionalText(40).transform((value) => (value ? normaliseVatNumber(value) : null)),
  defaultPaymentDays: paymentDays.default(DEFAULT_PAYMENT_DAYS),
  defaultCurrency: currency.nullish().transform((value) => value ?? null),
  bankAccount,
  bic: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^([A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?)?$/, "A BIC is 8 or 11 letters and digits."))
    .nullish()
    .transform((value) => value || null),
  paymentNote: optionalText(500),
  invoiceFooter: optionalText(1000),
  latePaymentNote: optionalText(1000),
  estimateAlertMinutes: alertMinutes.nullable().default(10),
  estimateAlertPopup: z.boolean().default(true),
  estimateAlertSound: z.boolean().default(false),
  /** Show clients the notes on their time entries (off by default). */
  showTimeNotesToClients: z.boolean().default(false),
});
export type WorkSettingsInput = z.infer<typeof workSettingsInput>;

export const NUMBER_SERIES = ["work_invoice", "work_credit_note"] as const;

/**
 * A document series' prefix and next number (4.4). The server refuses a
 * number at or below the highest one issued: numbers are only ever raised.
 */
export const numberSeriesInput = z.object({
  series: z.enum(NUMBER_SERIES),
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9\-_/.]{0,12}$/, "A prefix is up to 12 letters, digits and - _ / . characters."),
  nextNumber: int(1, 999_999_999, "Give the next number as a whole number from 1."),
});
export type NumberSeriesInput = z.infer<typeof numberSeriesInput>;

// --- Payments and credit notes ------------------------------------------------------

/** How an owner records a payment by hand; `stripe` and `prepaid` are written only by the system. */
export const MANUAL_PAYMENT_METHODS = ["bank", "card", "cash", "other"] as const;

export const recordPaymentInput = z.object({
  invoiceId: uuid,
  amountMinor: int(1, Number.MAX_SAFE_INTEGER, "Enter the amount received."),
  receivedOn: day("Give the date it was received."),
  method: z.enum(MANUAL_PAYMENT_METHODS).default("bank"),
  reference: optionalText(200),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;

/** Undoing a payment adds a reversing row; the original stays. */
export const reversePaymentInput = z.object({ paymentId: uuid, reason: optionalText(500) });
export type ReversePaymentInput = z.infer<typeof reversePaymentInput>;

/**
 * A credit note (4.6): the whole invoice (which voids it) or chosen lines and
 * how much of each. The reason is required: it is printed on the document.
 */
export const creditNoteInput = z
  .object({
    invoiceId: uuid,
    reason: text(500).min(1, "Say why the invoice is credited."),
    kind: z.enum(["full", "partial"]),
    lines: z
      .array(
        z.object({
          lineId: uuid,
          quantityHundredths: int(1, MAX_QUANTITY_HUNDREDTHS, "Enter the quantity to credit."),
        }),
      )
      .max(MAX_INVOICE_LINES)
      .default([]),
  })
  .superRefine((note, ctx) => {
    if (note.kind === "partial" && note.lines.length === 0) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Choose the lines to credit." });
    }
    if (note.kind === "full" && note.lines.length > 0) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "A full credit note credits every line." });
    }
    const seen = new Set<string>();
    note.lines.forEach((line, index) => {
      if (seen.has(line.lineId))
        ctx.addIssue({ code: "custom", path: ["lines", index, "lineId"], message: "A line appears twice." });
      seen.add(line.lineId);
    });
  });
export type CreditNoteInput = z.infer<typeof creditNoteInput>;
